import { readFileSync } from "node:fs";

const STOP_WORDS = new Set(
  "a an and are as at be been but by can did do does for from had has have how i in is it me of on or our said say she that the their them they this to was we were what when where which who why will with you your podcast episode episodes discuss discussed talk talked tell find search about".split(
    " ",
  ),
);

/** @param {string} message @returns {boolean} */
export function requiresPodcastSearch(message) {
  if (/\b(invite|invitation|outreach|speaking|draft)\b/i.test(message)) return false;
  return (
    /\b(podcast|episodes?)\b/i.test(message) &&
    /\b(say|said|discuss\w*|talk\w*|cover\w*|search|find|passages?|quotes?|timestamps?|timestamped)\b/i.test(message)
  );
}

/** @param {string} text @returns {string[]} */
function terms(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]{2,}/g) || []
  )
    .filter((term) => !STOP_WORDS.has(term))
    .map((term) => (term.length > 4 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term));
}

/** @typedef {{videoId: string, episodeTitle: string, episodeNumber: number, chunks: Array<{startSeconds: number, text: string}>}} Episode */

/** @param {any} archive @returns {Episode[]} */
function validateArchive(archive) {
  if (
    archive?.version !== 1 ||
    !Array.isArray(archive.episodes) ||
    !archive.episodes.length ||
    archive.episodes.length > 100
  ) {
    throw new Error("Invalid podcast archive");
  }
  const videos = new Set();
  let count = 0;
  for (const episode of archive.episodes) {
    if (
      !/^[A-Za-z0-9_-]{11}$/.test(episode.videoId) ||
      videos.has(episode.videoId) ||
      typeof episode.episodeTitle !== "string" ||
      !episode.episodeTitle.trim() ||
      !Array.isArray(episode.chunks) ||
      !episode.chunks.length
    )
      throw new Error("Invalid podcast episode");
    videos.add(episode.videoId);
    let previous = -1;
    for (const chunk of episode.chunks) {
      if (
        !Number.isInteger(chunk.startSeconds) ||
        chunk.startSeconds < 0 ||
        chunk.startSeconds < previous ||
        chunk.startSeconds > 86400 ||
        typeof chunk.text !== "string" ||
        !chunk.text.trim() ||
        chunk.text.length > 6000
      ) {
        throw new Error("Invalid timestamped podcast passage");
      }
      previous = chunk.startSeconds;
      if (++count > 5000) throw new Error("Podcast archive exceeds its search budget");
    }
  }
  return archive.episodes;
}

/**
 * Search only the published transcript snapshot packaged with this release.
 * The existing Sanity fallback selects this alongside published biography search;
 * setting KNOWLEDGE_SOURCE=bedrock restores both native knowledge bases.
 * @param {any} nativeClient
 * @param {{env?: NodeJS.ProcessEnv, archive?: any}} [options]
 * @returns {any}
 */
export function createPodcastKnowledgeClient(nativeClient, { env = process.env, archive } = {}) {
  if (env.KNOWLEDGE_SOURCE !== "sanity") return nativeClient;
  if (!env.PODCAST_KB_ID) return nativeClient;
  const episodes = validateArchive(
    archive ?? JSON.parse(readFileSync(new URL("./podcast-index.json", import.meta.url), "utf8")),
  );
  const passages = episodes.flatMap((episode) =>
    episode.chunks.map((chunk) => {
      const words = terms(chunk.text);
      /** @type {Map<string, number>} */
      const frequencies = new Map();
      for (const word of words) frequencies.set(word, (frequencies.get(word) || 0) + 1);
      return { episode, chunk, frequencies, length: words.length, titleTerms: new Set(terms(episode.episodeTitle)) };
    }),
  );
  const averageLength = passages.reduce((sum, passage) => sum + passage.length, 0) / passages.length || 1;
  /** @type {Map<string, number>} */
  const documentFrequency = new Map();
  for (const passage of passages) {
    for (const word of passage.frequencies.keys()) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  }
  return {
    /** @param {any} command @param {{abortSignal?: AbortSignal}} [options] */
    async send(command, options = {}) {
      if (command.input?.knowledgeBaseId !== env.PODCAST_KB_ID) return nativeClient.send(command, options);
      options.abortSignal?.throwIfAborted();
      const query = [...new Set(terms(String(command.input.retrievalQuery?.text || "").slice(0, 500)))].slice(0, 30);
      const requested = command.input.retrievalConfiguration?.vectorSearchConfiguration?.numberOfResults;
      const limit = Number.isInteger(requested) ? Math.min(10, Math.max(1, requested)) : 4;
      const ranked = passages
        .map((passage) => {
          let matched = 0;
          let score = 0;
          for (const word of query) {
            const frequency = passage.frequencies.get(word) || 0;
            if (!frequency) continue;
            matched++;
            const documents = documentFrequency.get(word) || 0;
            const rarity = Math.log(1 + (passages.length - documents + 0.5) / (documents + 0.5));
            score += (rarity * frequency * 2.2) / (frequency + 1.2 * (0.25 + (0.75 * passage.length) / averageLength));
          }
          const titleMatches = query.filter((word) => passage.titleTerms.has(word)).length;
          return { passage, score: matched ? (score * matched + 2 * titleMatches) / query.length : 0 };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return {
        retrievalResults: ranked.map(({ passage, score }) => ({
          content: { text: passage.chunk.text },
          score,
          metadata: {
            videoId: passage.episode.videoId,
            startSeconds: passage.chunk.startSeconds,
            episodeTitle: passage.episode.episodeTitle,
            contentType: "podcast",
            source: "published-transcript-keyword-search",
          },
        })),
      };
    },
  };
}
