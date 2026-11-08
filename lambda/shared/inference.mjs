import { randomUUID } from "node:crypto";

export const CLOUDFLARE_MODEL_ID = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** @param {Response} response */
export async function readInferenceJson(response) {
  if (!response.body) throw new Error("Inference response is empty");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Inference response is too large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
  }
}

/** @param {any} input */
export function toChatCompletion(input) {
  const messages = [];
  const system = (input.system || []).map((/** @type {any} */ block) => block.text || "").join("\n");
  if (system) messages.push({ role: "system", content: system });
  for (const message of input.messages || []) {
    const text = [];
    const calls = [];
    const results = [];
    for (const block of message.content || []) {
      if (typeof block.text === "string") text.push(block.text);
      else if (block.guardContent?.text?.text) text.push(block.guardContent.text.text);
      else if (block.toolUse) {
        calls.push({
          id: block.toolUse.toolUseId,
          type: "function",
          function: { name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input) },
        });
      } else if (block.toolResult) {
        results.push({
          role: "tool",
          tool_call_id: block.toolResult.toolUseId,
          content: JSON.stringify(block.toolResult.content),
        });
      } else if (!block.cachePoint) throw new Error("Unsupported inference content");
    }
    messages.push(...results);
    if (text.length || calls.length) {
      messages.push({
        role: message.role,
        content: text.join("\n") || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    }
  }
  const tools = (input.toolConfig?.tools || [])
    .filter((/** @type {any} */ t) => t.toolSpec)
    .map((/** @type {any} */ t) => ({
      type: "function",
      function: { name: t.toolSpec.name, description: t.toolSpec.description, parameters: t.toolSpec.inputSchema.json },
    }));
  const choice = input.toolConfig?.toolChoice;
  const toolChoice = choice?.tool
    ? { type: "function", function: { name: choice.tool.name } }
    : choice?.any
      ? "required"
      : "auto";
  return {
    model: CLOUDFLARE_MODEL_ID,
    messages,
    max_tokens: Math.min(input.inferenceConfig?.maxTokens || 500, 8192),
    temperature: input.inferenceConfig?.temperature ?? 0.3,
    ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
  };
}

/** @param {any} result @param {any} request */
export function fromChatCompletion(result, request) {
  const choice = result?.choices?.[0];
  if (!choice?.message || choice.message.role !== "assistant") throw new Error("Invalid inference response");
  const content = [];
  if (typeof choice.message.content === "string" && choice.message.content)
    content.push({ text: choice.message.content });
  const tools = new Set((request.tools || []).map((/** @type {any} */ t) => t.function.name));
  for (const call of choice.message.tool_calls || []) {
    if (!tools.has(call.function?.name)) throw new Error("Unknown inference tool");
    const args = JSON.parse(call.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid inference tool arguments");
    content.push({ toolUse: { toolUseId: call.id || randomUUID(), name: call.function.name, input: args } });
  }
  if (!content.length) throw new Error("Inference response is empty");
  return {
    output: { message: { role: "assistant", content } },
    stopReason: content.some((b) => b.toolUse)
      ? "tool_use"
      : choice.finish_reason === "length"
        ? "max_tokens"
        : "end_turn",
    usage: {
      inputTokens: result.usage?.prompt_tokens || 0,
      outputTokens: result.usage?.completion_tokens || 0,
      totalTokens: result.usage?.total_tokens || 0,
    },
  };
}

/** @param {any} result */
async function* converseEvents(result) {
  yield { messageStart: { role: "assistant" } };
  for (const [contentBlockIndex, block] of result.output.message.content.entries()) {
    if (block.toolUse) {
      yield {
        contentBlockStart: {
          contentBlockIndex,
          start: { toolUse: { toolUseId: block.toolUse.toolUseId, name: block.toolUse.name } },
        },
      };
      yield {
        contentBlockDelta: { contentBlockIndex, delta: { toolUse: { input: JSON.stringify(block.toolUse.input) } } },
      };
    } else yield { contentBlockDelta: { contentBlockIndex, delta: { text: block.text } } };
    yield { contentBlockStop: { contentBlockIndex } };
  }
  yield { messageStop: { stopReason: result.stopReason } };
  yield { metadata: { usage: result.usage } };
}

/**
 * Keep Converse-shaped application contracts while explicitly selecting a provider.
 * Guardrails still run on AWS before inference and before any output is released.
 * @param {any} bedrockClient
 * @param {any} ApplyGuardrailCommand
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {any}
 */
export function createInferenceClient(
  bedrockClient,
  ApplyGuardrailCommand,
  { env = process.env, fetchImpl = fetch, timeoutMs = 20000 } = {},
) {
  if (!env.AI_PROVIDER || env.AI_PROVIDER === "bedrock") return bedrockClient;
  if (env.AI_PROVIDER !== "cloudflare") throw new Error("Unsupported AI_PROVIDER");
  const endpoint = new URL(env.CLOUDFLARE_AI_GATEWAY_URL || "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !env.CLOUDFLARE_AI_GATEWAY_KEY
  ) {
    throw new Error("Invalid Cloudflare inference configuration");
  }

  /** @param {any} config @param {string} source @param {string} text @param {AbortSignal} signal */
  async function screen(config, source, text, signal) {
    if (!config) return;
    if (!config.guardrailIdentifier || !config.guardrailVersion || !text || text.length > 50000)
      throw new Error("Guardrail input is invalid");
    const check = await bedrockClient.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier: config.guardrailIdentifier,
        guardrailVersion: config.guardrailVersion,
        source,
        content: [{ text: { text } }],
      }),
      { abortSignal: signal },
    );
    if (check.action !== "NONE") {
      const error = new Error("Guardrail intervention");
      error.name = "ValidationException";
      throw error;
    }
  }

  return {
    provider: "cloudflare",
    modelId: CLOUDFLARE_MODEL_ID,
    /** @param {any} command @param {{ abortSignal?: AbortSignal }} [options] */
    async send(command, options = {}) {
      const name = command.constructor.name;
      if (name !== "ConverseCommand" && name !== "ConverseStreamCommand") return bedrockClient.send(command, options);
      const signal = AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(options.abortSignal ? [options.abortSignal] : []),
      ]);
      const input = command.input;
      const request = toChatCompletion(input);
      const inputText = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => m.content || "")
        .join("\n");
      await screen(input.guardrailConfig, "INPUT", inputText, signal);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CLOUDFLARE_AI_GATEWAY_KEY}` },
        body: JSON.stringify(request),
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error("Inference service unavailable");
        error.name = response.status === 429 ? "ThrottlingException" : "InferenceError";
        throw error;
      }
      const result = fromChatCompletion(await readInferenceJson(response), request);
      const outputText = result.output.message.content
        .map((b) => b.text || JSON.stringify(b.toolUse?.input))
        .join("\n");
      await screen(input.guardrailConfig, "OUTPUT", outputText, signal);
      return name === "ConverseStreamCommand" ? { stream: converseEvents(result) } : result;
    },
  };
}
