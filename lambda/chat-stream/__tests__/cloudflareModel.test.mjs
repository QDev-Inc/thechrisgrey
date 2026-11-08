import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, tool } from "@strands-agents/sdk";
import { z } from "zod";
import { CloudflareModel } from "../cloudflareModel.mjs";

test("the real Strands agent completes a tool cycle through the provider adapter", async () => {
  let calls = 0;
  const model = new CloudflareModel({
    guardrailId: "guard",
    guardrailVersion: "1",
    client: {
      async send(command) {
        assert.equal(command.input.guardrailConfig.guardrailIdentifier, "guard");
        calls++;
        if (calls === 1) {
          assert.equal(command.input.toolConfig.tools[0].toolSpec.name, "lookup");
          return {
            output: {
              message: { content: [{ toolUse: { toolUseId: "test-call", name: "lookup", input: { query: "AWS" } } }] },
            },
            stopReason: "tool_use",
            usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
          };
        }
        assert.equal(command.input.messages.at(-1).content[0].toolResult.toolUseId, "test-call");
        return {
          output: { message: { content: [{ text: "Found the AWS article." }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20 },
        };
      },
    },
  });
  const lookup = tool({
    name: "lookup",
    description: "Look up an article",
    inputSchema: z.object({ query: z.string() }),
    callback: ({ query }) => ({ title: `${query} article` }),
  });
  const agent = new Agent({ model, tools: [lookup], systemPrompt: "Use lookup", printer: false });
  const result = await agent.invoke("Find an AWS article");
  assert.equal(calls, 2);
  assert.equal(result.stopReason, "endTurn");
  assert.match(result.toString(), /Found the AWS article/);
});

test("Cloudflare chat cannot start without a configured guardrail", () => {
  assert.throws(
    () => new CloudflareModel({ client: {}, guardrailId: "", guardrailVersion: "" }),
    /requires guardrails/,
  );
});

test("a required grounding tool runs once before a follow-up answer", async () => {
  let calls = 0;
  const model = new CloudflareModel({
    guardrailId: "guard",
    guardrailVersion: "1",
    initialToolName: "search_podcast",
    client: {
      async send(command) {
        calls++;
        if (calls === 1) {
          assert.deepEqual(command.input.toolConfig.toolChoice, { tool: { name: "search_podcast" } });
          return {
            output: {
              message: {
                content: [
                  { text: "Discard this ungrounded preface" },
                  { toolUse: { toolUseId: "grounded", name: "search_podcast", input: { query: "neurodiversity" } } },
                ],
              },
            },
            stopReason: "tool_use",
          };
        }
        assert.deepEqual(command.input.toolConfig.toolChoice, { auto: {} });
        assert.equal(command.input.messages.at(-1).content[0].toolResult.toolUseId, "grounded");
        return {
          output: { message: { content: [{ text: "Grounded in the actual episode." }] } },
          stopReason: "end_turn",
        };
      },
    },
  });
  const search = tool({
    name: "search_podcast",
    description: "Search transcripts",
    inputSchema: z.object({ query: z.string() }),
    callback: () => ({ results: [{ quote: "An actual passage" }] }),
  });
  const agent = new Agent({
    model,
    tools: [search],
    printer: false,
    messages: [
      { role: "user", content: [{ text: "What did Brittinie say?" }] },
      { role: "assistant", content: [{ text: "Previous answer" }] },
    ],
  });
  const result = await agent.invoke("What did Jay say on the podcast?");
  assert.equal(calls, 2);
  assert.match(result.toString(), /Grounded in the actual episode/);
  assert.doesNotMatch(result.toString(), /ungrounded preface/);
});

test("required grounding fails closed if a tool is missing or the provider ignores tool choice", async () => {
  const model = new CloudflareModel({
    guardrailId: "guard",
    guardrailVersion: "1",
    initialToolName: "search_podcast",
    client: { send: async () => ({ output: { message: { content: [{ text: "An invented answer" }] } } }) },
  });
  await assert.rejects(async () => {
    for await (const _event of model.stream([], {})) {
      assert.fail("Ungrounded content must not be emitted");
    }
  }, /unavailable/);
  await assert.rejects(async () => {
    for await (const _event of model.stream([], { toolSpecs: [{ name: "search_podcast" }] })) {
      assert.fail("Ungrounded content must not be emitted");
    }
  }, /did not call/);
});
