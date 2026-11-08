import { test } from "node:test";
import assert from "node:assert/strict";
import { createInferenceClient, toChatCompletion, fromChatCompletion, CLOUDFLARE_MODEL_ID } from "../inference.mjs";

class ConverseCommand {
  constructor(input) {
    this.input = input;
  }
}
class ConverseStreamCommand extends ConverseCommand {}
class ApplyGuardrailCommand extends ConverseCommand {}
const env = {
  AI_PROVIDER: "cloudflare",
  CLOUDFLARE_AI_GATEWAY_URL: "https://inference.example/v1/chat/completions",
  CLOUDFLARE_AI_GATEWAY_KEY: "a".repeat(64),
};
const input = {
  messages: [{ role: "user", content: [{ text: "Hello" }] }],
  guardrailConfig: { guardrailIdentifier: "guardrail", guardrailVersion: "1" },
};
const response = {
  choices: [{ message: { role: "assistant", content: "Hello there" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
};

test("Bedrock remains the default and invalid provider configuration fails closed", () => {
  const native = { send() {} };
  assert.equal(createInferenceClient(native, ApplyGuardrailCommand, { env: {} }), native);
  assert.throws(() => createInferenceClient(native, ApplyGuardrailCommand, { env: { AI_PROVIDER: "unknown" } }));
  assert.throws(() =>
    createInferenceClient(native, ApplyGuardrailCommand, {
      env: { ...env, CLOUDFLARE_AI_GATEWAY_URL: "http://example.com" },
    }),
  );
  assert.throws(() =>
    createInferenceClient(native, ApplyGuardrailCommand, { env: { ...env, CLOUDFLARE_AI_GATEWAY_KEY: "" } }),
  );
});

test("input and output guardrails complete before a model response is released", async () => {
  const calls = [];
  const native = {
    async send(command) {
      calls.push(command.input.source);
      return { action: "NONE" };
    },
  };
  const client = createInferenceClient(native, ApplyGuardrailCommand, {
    env,
    fetchImpl: async (_url, init) => {
      calls.push("inference");
      assert.equal(init.redirect, "error");
      assert.equal(JSON.parse(init.body).model, CLOUDFLARE_MODEL_ID);
      return Response.json(response);
    },
  });
  const result = await client.send(new ConverseCommand(input));
  assert.deepEqual(calls, ["INPUT", "inference", "OUTPUT"]);
  assert.equal(result.output.message.content[0].text, "Hello there");
  assert.equal(result.usage.totalTokens, 13);
});

for (const source of ["INPUT", "OUTPUT"]) {
  test(`${source} intervention blocks the entire response`, async () => {
    let inferenceCalls = 0;
    const client = createInferenceClient(
      {
        async send(command) {
          return { action: command.input.source === source ? "GUARDRAIL_INTERVENED" : "NONE" };
        },
      },
      ApplyGuardrailCommand,
      {
        env,
        fetchImpl: async () => {
          inferenceCalls++;
          return Response.json(response);
        },
      },
    );
    await assert.rejects(client.send(new ConverseCommand(input)), { name: "ValidationException" });
    assert.equal(inferenceCalls, source === "INPUT" ? 0 : 1);
  });
}

test("a guardrail outage cannot initiate inference", async () => {
  const client = createInferenceClient(
    {
      async send() {
        throw new Error("unavailable");
      },
    },
    ApplyGuardrailCommand,
    {
      env,
      fetchImpl: async () => {
        assert.fail("inference must not run");
      },
    },
  );
  await assert.rejects(client.send(new ConverseCommand(input)), /unavailable/);
});

test("native guardrail operations are delegated to AWS", async () => {
  const command = new ApplyGuardrailCommand({ source: "INPUT" });
  const client = createInferenceClient(
    {
      async send(c) {
        assert.equal(c, command);
        return { action: "NONE" };
      },
    },
    ApplyGuardrailCommand,
    { env },
  );
  assert.deepEqual(await client.send(command), { action: "NONE" });
});

test("forced tools and multi-turn tool results preserve identifiers and schemas", () => {
  const request = toChatCompletion({
    system: [{ text: "Be helpful" }],
    messages: [
      {
        role: "assistant",
        content: [{ toolUse: { toolUseId: "call-1", name: "search_blog", input: { query: "AI" } } }],
      },
      { role: "user", content: [{ toolResult: { toolUseId: "call-1", content: [{ json: { title: "An essay" } }] } }] },
    ],
    toolConfig: {
      tools: [{ toolSpec: { name: "search_blog", inputSchema: { json: { type: "object" } } } }],
      toolChoice: { tool: { name: "search_blog" } },
    },
  });
  assert.equal(request.messages[1].tool_calls[0].id, "call-1");
  assert.equal(request.messages[2].tool_call_id, "call-1");
  assert.equal(request.tool_choice.function.name, "search_blog");
  const result = fromChatCompletion(
    {
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [{ id: "call-2", function: { name: "search_blog", arguments: '{"query":"cloud"}' } }],
          },
        },
      ],
    },
    request,
  );
  assert.equal(result.stopReason, "tool_use");
  assert.deepEqual(result.output.message.content[0].toolUse.input, { query: "cloud" });
  assert.throws(
    () =>
      fromChatCompletion(
        {
          choices: [
            { message: { role: "assistant", tool_calls: [{ function: { name: "unregistered", arguments: "{}" } }] } },
          ],
        },
        request,
      ),
    /Unknown inference tool/,
  );
});

test("stream compatibility emits a complete ordered Converse response", async () => {
  const client = createInferenceClient({}, ApplyGuardrailCommand, {
    env,
    fetchImpl: async () => Response.json(response),
  });
  const result = await client.send(new ConverseStreamCommand({ ...input, guardrailConfig: undefined }));
  const events = [];
  for await (const event of result.stream) events.push(event);
  assert.equal(events[0].messageStart.role, "assistant");
  assert.equal(events[1].contentBlockDelta.delta.text, "Hello there");
  assert.equal(events.at(-2).messageStop.stopReason, "end_turn");
  assert.equal(events.at(-1).metadata.usage.totalTokens, 13);
});

test("provider errors and redirect attempts cannot leak credentials or response bodies", async () => {
  const client = createInferenceClient({}, ApplyGuardrailCommand, {
    env,
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      return new Response("internal-provider-secret", { status: 429 });
    },
  });
  await assert.rejects(
    client.send(new ConverseCommand({ ...input, guardrailConfig: undefined })),
    (error) => error.name === "ThrottlingException" && !error.message.includes("internal-provider-secret"),
  );
});

test("oversized provider bodies and unsupported content fail closed", async () => {
  const client = createInferenceClient({}, ApplyGuardrailCommand, {
    env,
    fetchImpl: async () => new Response("x".repeat(1024 * 1024 + 1)),
  });
  await assert.rejects(client.send(new ConverseCommand({ ...input, guardrailConfig: undefined })), /too large/);
  assert.throws(() => toChatCompletion({ messages: [{ content: [{ image: {} }] }] }), /Unsupported/);
});
