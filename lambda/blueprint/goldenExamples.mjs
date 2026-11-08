/**
 * Fetch and cache golden architectureBlueprint documents from Sanity.
 *
 * Cache strategy:
 *  - Module-scope Map keyed by "active" (single-bucket) with 5-min TTL.
 *  - Negative caching on fetch error for 30s to prevent stampedes during
 *    Sanity outages (the engine still runs — just without examples).
 *  - Single in-flight promise per container for dedup; concurrent requests
 *    share the same fetch.
 *
 * Example selection (by category match) happens in prompts.mjs; this module
 * just owns the fetch + cache.
 */

import { createLogger } from "lambda-shared/logger";

const log = createLogger(null, { service: "blueprint" });

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

// GROQ: all active architectureBlueprint docs, ordered by sortOrder ascending.
// The engine selects from this list by category at request time.
export const GOLDEN_EXAMPLES_QUERY = `*[_type == "architectureBlueprint" && isActive == true && !(_id in path("drafts.**"))] | order(sortOrder asc)[0...50] {
  _id, title, "slug": slug.current, category, spec, output, notes, isActive, sortOrder
}`;

/**
 * Build a fetcher with its own private cache. One per Lambda container.
 *
 * @param {{ fetch: any }} sanityClient - @sanity/client instance.
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=CACHE_TTL_MS]
 * @param {number} [opts.negativeTtlMs=NEGATIVE_CACHE_TTL_MS]
 * @param {Function} [opts.now=Date.now] - Injectable for tests.
 * @returns {{ getExamples: () => Promise<Array<object>>, clear: () => void }}
 */
export function createGoldenExamplesFetcher(sanityClient, opts = {}) {
  const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
  const negativeTtlMs = opts.negativeTtlMs ?? NEGATIVE_CACHE_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  /** @type {any} */
  let cache = null; // { data, expiresAt }
  /** @type {any} */
  let inflight = null;

  async function fetchFresh() {
    if (!sanityClient) return [];
    const results = await sanityClient.fetch(GOLDEN_EXAMPLES_QUERY);
    return Array.isArray(results) ? results : [];
  }

  async function getExamples() {
    const current = now();

    if (cache && cache.expiresAt > current) {
      return cache.data;
    }

    if (inflight) {
      return inflight;
    }

    inflight = (async () => {
      try {
        const data = await fetchFresh();
        cache = { data, expiresAt: now() + ttlMs };
        return data;
      } catch (error) {
        log.error("golden_examples_fetch_error", {
          error: error instanceof Error ? error.name : String(error),
          message: error instanceof Error ? error.message : "",
        });
        cache = { data: [], expiresAt: now() + negativeTtlMs };
        return [];
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  function clear() {
    cache = null;
    inflight = null;
  }

  return { getExamples, clear };
}

export default {
  createGoldenExamplesFetcher,
  GOLDEN_EXAMPLES_QUERY,
  CACHE_TTL_MS,
  NEGATIVE_CACHE_TTL_MS,
};
