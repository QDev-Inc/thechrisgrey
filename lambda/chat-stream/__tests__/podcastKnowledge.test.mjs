import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPodcastKnowledgeClient, requiresPodcastSearch } from "../podcastKnowledge.mjs";
import { retrievePodcastChunks } from "../podcastRetrieve.mjs";
import { buildSearchPodcastTool } from "../tools/searchPodcast.mjs";

const env = { KNOWLEDGE_SOURCE: "sanity", PODCAST_KB_ID: "podcast" };
const archive = JSON.parse(readFileSync(new URL("../podcast-index.json", import.meta.url), "utf8"));
class Command {
  constructor(input) {
    this.input = input;
  }
}
const forbidden = {
  send() {
    throw new Error("Native retrieval must not run in transcript mode");
  },
};
const search = (query, limit = 8) =>
  new Command({
    knowledgeBaseId: "podcast",
    retrievalQuery: { text: query },
    retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: limit } },
  });

describe("published timestamped podcast search", () => {
  it("requires grounding for explicit podcast searches while preserving outreach and navigation", () => {
    for (const query of [
      "What did Jay say on the podcast?",
      "Find an episode about women veterans",
      "Search the podcast for AI in defense",
      "Show timestamped passages from the podcast",
    ]) {
      assert.equal(requiresPodcastSearch(query), true);
    }
    for (const query of [
      "What is Christian's favorite color?",
      "Where can I listen to the podcast?",
      "Draft an invitation to my podcast",
      "Find his book",
      "I'd like to invite him onto my podcast",
    ]) {
      assert.equal(requiresPodcastSearch(query), false);
    }
  });
  for (const [query, videoId] of [
    ["women veterans", "ndX9SkIY7Mc"],
    ["neurodiversity mental health", "WRqF36FRSgk"],
    ["ethics education empathy", "Khql4OoR2wY"],
    ["VA disability rating", "ZdUQtZYEJok"],
  ]) {
    it(`grounds ${query} in the published transcript`, async () => {
      const client = createPodcastKnowledgeClient(forbidden, { env });
      const rows = await retrievePodcastChunks(client, Command, query, {
        knowledgeBaseId: "podcast",
        requestId: "corpus-test",
        numberOfResults: 8,
      });
      assert.ok(rows.length > 0);
      assert.equal(rows[0].videoId, videoId);
      for (const row of rows) {
        const episode = archive.episodes.find((entry) => entry.videoId === row.videoId);
        assert.ok(episode.chunks.some((chunk) => chunk.startSeconds === row.startSeconds && chunk.text === row.text));
        assert.equal(row.episodeTitle, episode.episodeTitle);
      }
    });
  }

  it("emits playable timestamp cards through the actual tool", async () => {
    const events = [];
    const tool = buildSearchPodcastTool({
      agentClient: createPodcastKnowledgeClient(forbidden, { env }),
      RetrieveCommand: Command,
      podcastKbId: "podcast",
      responseStream: { write: (value) => events.push(value) },
      metrics: { record() {} },
      requestId: "citation-test",
    });
    const result = await tool.invoke({ query: "women veterans" });
    assert.ok(result);
    const frames = events.join("");
    assert.match(frames, /podcast_citation/);
    assert.match(frames, /youtube\.com\/watch\?v=ndX9SkIY7Mc&t=\d+s/);
  });

  it("keeps native retrieval and other knowledge bases unchanged", async () => {
    let calls = 0;
    const native = {
      send: async () => {
        calls++;
        return "native";
      },
    };
    assert.equal(createPodcastKnowledgeClient(native, { env: {} }), native);
    assert.equal(createPodcastKnowledgeClient(native, { env: { ...env, KNOWLEDGE_SOURCE: "bedrock" } }), native);
    assert.equal(createPodcastKnowledgeClient(native, { env: { KNOWLEDGE_SOURCE: "sanity" } }), native);
    assert.equal(
      await createPodcastKnowledgeClient(native, { env }).send(new Command({ knowledgeBaseId: "bio" })),
      "native",
    );
    assert.equal(calls, 1);
  });

  it("returns genuine no-match and respects cancellation and result bounds", async () => {
    const client = createPodcastKnowledgeClient(forbidden, { env });
    for (const query of ["", "the and what", "xylophones volcanology"]) {
      assert.deepEqual((await client.send(search(query))).retrievalResults, []);
    }
    assert.equal((await client.send(search("AI", 999))).retrievalResults.length, 10);
    assert.equal((await client.send(search("AI", 0))).retrievalResults.length, 1);
    assert.equal((await client.send(search("AI", "bad"))).retrievalResults.length, 4);
    await assert.rejects(client.send(search("AI"), { abortSignal: AbortSignal.abort() }), { name: "AbortError" });
  });

  it("rejects corrupt or unsafe archives instead of reporting no matches", () => {
    const first = archive.episodes[0];
    for (const invalid of [
      null,
      {},
      { version: 2, episodes: [] },
      { version: 1, episodes: [] },
      { version: 1, episodes: [{ ...first, videoId: "video&x=1" }] },
      { version: 1, episodes: [first, first] },
      { version: 1, episodes: [{ ...first, episodeTitle: "" }] },
      ...[-1, null, 1.5, 86401].map((startSeconds) => ({
        version: 1,
        episodes: [{ ...first, chunks: [{ text: "hello", startSeconds }] }],
      })),
      { version: 1, episodes: [{ ...first, chunks: [{ text: "", startSeconds: 1 }] }] },
      {
        version: 1,
        episodes: [{ ...first, chunks: Array.from({ length: 5001 }, (_, i) => ({ text: "hello", startSeconds: i })) }],
      },
    ]) {
      assert.throws(() => createPodcastKnowledgeClient(forbidden, { env, archive: invalid === null ? {} : invalid }));
    }
  });

  it("covers exactly the published episode catalog", () => {
    const published = JSON.parse(
      readFileSync(new URL("../../../src/data/generatedEpisodes.json", import.meta.url), "utf8"),
    ).episodes;
    assert.deepEqual(archive.episodes.map((e) => e.videoId).sort(), published.map((e) => e.videoId).sort());
  });
});
