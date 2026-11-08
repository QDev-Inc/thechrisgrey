import { Model } from "@strands-agents/sdk";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { CLOUDFLARE_MODEL_ID } from "lambda-shared/inference";

/** @param {any} block @returns {any} */
function contentBlock(block) {
  if (block.type === "textBlock" || typeof block.text === "string") return { text: block.text };
  if (block.type === "jsonBlock") return { json: block.json };
  if (block.type === "toolUseBlock")
    return { toolUse: { toolUseId: block.toolUseId, name: block.name, input: block.input } };
  if (block.type === "toolResultBlock")
    return {
      toolResult: { toolUseId: block.toolUseId, status: block.status, content: block.content.map(contentBlock) },
    };
  throw new Error("Unsupported Cloudflare model content");
}

export class CloudflareModel extends Model {
  /** @param {{ client: any, guardrailId: string, guardrailVersion: string, maxTokens?: number, temperature?: number, initialToolName?: string }} options */
  constructor({ client, guardrailId, guardrailVersion, maxTokens = 500, temperature = 0.6, initialToolName }) {
    super();
    this.client = client;
    this.initialToolName = initialToolName;
    this.config = { modelId: CLOUDFLARE_MODEL_ID, maxTokens, temperature, contextWindowLimit: 128000 };
    if (!guardrailId || !guardrailVersion) throw new Error("Cloudflare chat requires guardrails");
    this.guardrailConfig = { guardrailIdentifier: guardrailId, guardrailVersion };
  }

  /** @param {any} config */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
  getConfig() {
    return this.config;
  }

  /** @param {any[]} messages @param {any} [options] @returns {AsyncGenerator<any>} */
  async *stream(messages, options = {}) {
    const requiredTool = this.initialToolName;
    if (requiredTool && !options.toolSpecs?.some((/** @type {any} */ spec) => spec.name === requiredTool)) {
      throw new Error("Required grounding tool is unavailable");
    }
    const system =
      typeof options.systemPrompt === "string"
        ? [{ text: options.systemPrompt }]
        : (options.systemPrompt || []).map(contentBlock);
    const result = await this.client.send(
      new ConverseCommand({
        modelId: this.config.modelId,
        system,
        messages: messages.map((message) => ({ role: message.role, content: message.content.map(contentBlock) })),
        inferenceConfig: { maxTokens: this.config.maxTokens, temperature: this.config.temperature },
        guardrailConfig: this.guardrailConfig,
        ...(options.toolSpecs?.length
          ? {
              toolConfig: {
                tools: options.toolSpecs.map((/** @type {any} */ spec) => ({
                  toolSpec: {
                    name: spec.name,
                    description: spec.description,
                    inputSchema: { json: spec.inputSchema || { type: "object", properties: {} } },
                  },
                })),
                toolChoice: requiredTool ? { tool: { name: requiredTool } } : options.toolChoice || { auto: {} },
              },
            }
          : {}),
      }),
    );
    if (
      requiredTool &&
      !result.output.message.content.some((/** @type {any} */ block) => block.toolUse?.name === requiredTool)
    ) {
      throw new Error("Model did not call the required grounding tool");
    }
    this.initialToolName = undefined;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    for (const block of result.output.message.content) {
      if (requiredTool && !block.toolUse) continue;
      if (block.toolUse) {
        yield {
          type: "modelContentBlockStartEvent",
          start: { type: "toolUseStart", toolUseId: block.toolUse.toolUseId, name: block.toolUse.name },
        };
        yield {
          type: "modelContentBlockDeltaEvent",
          delta: { type: "toolUseInputDelta", input: JSON.stringify(block.toolUse.input) },
        };
      } else {
        yield { type: "modelContentBlockStartEvent" };
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: block.text } };
      }
      yield { type: "modelContentBlockStopEvent" };
    }
    yield { type: "modelMetadataEvent", usage: result.usage };
    const stopReason =
      result.stopReason === "tool_use" ? "toolUse" : result.stopReason === "max_tokens" ? "maxTokens" : "endTurn";
    yield { type: "modelMessageStopEvent", stopReason };
  }
}
