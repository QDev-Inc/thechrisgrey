import { readInferenceJson } from "./inference.mjs";

const QUERY =
  '*[_type == "kbEntry" && isActive == true && !(_id in path("drafts.**"))] | order(sortOrder asc)[0...100]{title, category, content}';
const STOP_WORDS = new Set(
  "who what when where why how the and with from about tell does have this that his her are was for you can your me".split(
    " ",
  ),
);

/**
 * Published CMS entries provide bounded keyword retrieval while embeddings are unavailable.
 * Podcast retrieval keeps its original backend because timestamps require transcript chunks.
 * @param {any} nativeClient
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [options]
 * @returns {any}
 */
export function createKnowledgeClient(nativeClient, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.KNOWLEDGE_SOURCE || env.KNOWLEDGE_SOURCE === "bedrock") return nativeClient;
  if (env.KNOWLEDGE_SOURCE !== "sanity" || !env.KB_ID) throw new Error("Invalid knowledge source configuration");
  const project = env.SANITY_PROJECT_ID || "k5950b3w";
  const dataset = env.SANITY_DATASET || "production";
  if (!/^[a-z0-9]+$/.test(project) || !/^[a-z0-9_-]+$/.test(dataset)) throw new Error("Invalid knowledge dataset");
  const url = new URL(`https://${project}.api.sanity.io/v2024-01-01/data/query/${dataset}`);
  url.searchParams.set("query", QUERY);
  url.searchParams.set("perspective", "published");
  /** @type {Array<{title: string, content: string}>|null} */
  let cached = null;
  let expiresAt = 0;
  return {
    /** @param {any} command @param {{abortSignal?: AbortSignal}} [options] */
    async send(command, options = {}) {
      if (command.input?.knowledgeBaseId !== env.KB_ID) return nativeClient.send(command, options);
      if (!cached || Date.now() >= expiresAt) {
        const signal = AbortSignal.any([
          AbortSignal.timeout(4000),
          ...(options.abortSignal ? [options.abortSignal] : []),
        ]);
        const response = await fetchImpl(url, { signal, redirect: "error" });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Published knowledge unavailable");
        }
        const data = await readInferenceJson(response);
        if (!Array.isArray(data.result)) throw new Error("Invalid published knowledge response");
        cached = data.result
          .filter((/** @type {any} */ row) => typeof row.title === "string" && typeof row.content === "string")
          .map((/** @type {any} */ row) => ({ title: row.title.slice(0, 200), content: row.content.slice(0, 6000) }));
        expiresAt = Date.now() + 60000;
      }
      const terms = [
        ...new Set(
          String(command.input.retrievalQuery?.text || "")
            .toLowerCase()
            .match(/[a-z0-9]{2,}/g) || [],
        ),
      ]
        .filter((term) => !STOP_WORDS.has(term))
        .slice(0, 30);
      const limit = Math.min(command.input.retrievalConfiguration?.vectorSearchConfiguration?.numberOfResults || 5, 10);
      const ranked = (cached || [])
        .map((row) => ({
          row,
          score: terms.reduce(
            (score, term) =>
              score +
              (row.title.toLowerCase().includes(term) ? 3 : 0) +
              (row.content.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return {
        retrievalResults: ranked.map(({ row, score }) => ({
          content: { text: `${row.title}\n${row.content}` },
          score: score / Math.max(terms.length * 4, 1),
          metadata: { source: "published-sanity-keyword-search" },
        })),
      };
    },
  };
}
