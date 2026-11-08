import { test } from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeClient } from "../knowledge.mjs";
const env = { KNOWLEDGE_SOURCE: "sanity", KB_ID: "main", SANITY_PROJECT_ID: "k5950b3w" };
const command = {
  input: { knowledgeBaseId: "main", retrievalQuery: { text: "Which AWS certifications does Christian have?" } },
};
test("published knowledge matches relevant entries and caches bounded CMS results", async () => {
  let calls = 0;
  const client = createKnowledgeClient(
    {},
    {
      env,
      fetchImpl: async (url) => {
        calls++;
        assert.equal(url.searchParams.get("perspective"), "published");
        assert.match(url.searchParams.get("query"), /isActive == true/);
        assert.match(url.searchParams.get("query"), /drafts/);
        return Response.json({
          result: [
            { title: "AWS Certifications", content: "Solutions Architect Professional" },
            { title: "Book", content: "Leadership" },
          ],
        });
      },
    },
  );
  assert.equal(
    (await client.send(command)).retrievalResults[0].content.text,
    "AWS Certifications\nSolutions Architect Professional",
  );
  assert.equal((await client.send(command)).retrievalResults.length, 1);
  assert.equal(calls, 1);
});
test("podcast lookups retain their transcript backend and cannot receive biography matches", async () => {
  const native = {
    async send(c) {
      assert.equal(c.input.knowledgeBaseId, "podcast");
      return { retrievalResults: [] };
    },
  };
  const client = createKnowledgeClient(native, {
    env,
    fetchImpl: async () => {
      assert.fail("wrong backend");
    },
  });
  assert.deepEqual(await client.send({ input: { knowledgeBaseId: "podcast" } }), { retrievalResults: [] });
  assert.equal(createKnowledgeClient(native, { env: {} }), native);
});
test("invalid configuration and failed CMS requests do not produce invented context", async () => {
  assert.throws(() => createKnowledgeClient({}, { env: { ...env, SANITY_PROJECT_ID: "bad/path" } }));
  const client = createKnowledgeClient({}, { env, fetchImpl: async () => Response.json({}, { status: 500 }) });
  await assert.rejects(client.send(command), /unavailable/);
});
