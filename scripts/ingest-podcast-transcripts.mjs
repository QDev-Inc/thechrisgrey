#!/usr/bin/env node
/**
 * ingest-podcast-transcripts.mjs
 *
 * Stage transcript chunks for the dedicated Vector Podcast Knowledge Base.
 *
 * For each episode in src/data/generatedEpisodes.json, this:
 *   1. Reads a local transcript at podcast-transcripts/<videoId>.json, OR
 *      fetches the public English caption track from YouTube timedtext (no auth)
 *      (an array of { start: number, dur?: number, text: string } cues — e.g. the
 *      output of Amazon Transcribe / Whisper for episodes without public captions).
 *   2. Chunks cues into ~45s / ~600-char windows, each tagged with its startSeconds.
 *   3. Writes, into ./podcast-kb-staging/:
 *        <videoId>-<startSeconds>.txt              (chunk text)
 *        <videoId>-<startSeconds>.txt.metadata.json (Bedrock KB metadataAttributes)
 *
 * It then prints the exact `aws s3 sync` + `start-ingestion-job` commands for the
 * operator to run. It does NOT call AWS itself — provisioning + ingestion are
 * deliberate, operator-controlled steps.
 *
 * Usage:
 *   node scripts/ingest-podcast-transcripts.mjs [--local-only]
 *
 * A complete run also refreshes lambda/chat-stream/podcast-index.json for
 * timestamped keyword search when KNOWLEDGE_SOURCE=sanity. Commit that snapshot.
 *
 * Env (only used in the printed commands):
 *   PODCAST_KB_SOURCE_BUCKET   PodcastKnowledgeBaseSourceBucketName stack output
 *   PODCAST_KB_ID              the dedicated podcast KB id (required to print ingest cmd)
 *   PODCAST_KB_DATA_SOURCE_ID  the podcast KB data source id
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPodcastEpisode, PODCAST_CONTENT_PREFIX } from './lib/podcast-corpus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EPISODES_PATH = join(ROOT, 'src', 'data', 'generatedEpisodes.json');
const LOCAL_TRANSCRIPTS_DIR = join(ROOT, 'podcast-transcripts');
const STAGING_DIR = join(ROOT, 'podcast-kb-staging');

const BUNDLED_INDEX = join(ROOT, 'lambda', 'chat-stream', 'podcast-index.json');
const BUCKET = process.env.PODCAST_KB_SOURCE_BUCKET || '<PodcastKnowledgeBaseSourceBucketName>';
const KB_ID = process.env.PODCAST_KB_ID || '<PODCAST_KB_ID>';
const DATA_SOURCE_ID = process.env.PODCAST_KB_DATA_SOURCE_ID || '<PODCAST_KB_DATA_SOURCE_ID>';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Parse YouTube timedtext XML into [{ start, dur, text }]. */
function parseTimedText(xml) {
  const cues = [];
  const re = /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeEntities(m[3].replace(/\n/g, ' ').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    cues.push({ start: Number(m[1]), dur: m[2] ? Number(m[2]) : 0, text });
  }
  return cues;
}

async function fetchYouTubeCaptions(videoId) {
  const url = `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml || !xml.includes('<text')) return null;
    const cues = parseTimedText(xml);
    return cues.length > 0 ? cues : null;
  } catch {
    return null;
  }
}

function loadLocalTranscript(videoId) {
  const path = join(LOCAL_TRANSCRIPTS_DIR, `${videoId}.json`);
  if (!existsSync(path)) return null;
  try {
    const cues = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(cues)) return null;
    return cues;
  } catch {
    return null;
  }
}

function writeChunk(videoId, episode, window) {
  const startSeconds = window.startSeconds;
  const base = `${videoId}-${startSeconds}`;
  writeFileSync(join(STAGING_DIR, `${base}.txt`), window.text.trim(), 'utf8');
  const metadata = {
    metadataAttributes: {
      videoId,
      startSeconds,
      episodeTitle: episode.title || 'The Vector Podcast',
      episodeNumber: episode.episodeNumber ?? 0,
      contentType: 'podcast',
    },
  };
  writeFileSync(join(STAGING_DIR, `${base}.txt.metadata.json`), JSON.stringify(metadata, null, 2), 'utf8');
}

async function main() {
  const { episodes } = JSON.parse(readFileSync(EPISODES_PATH, 'utf8'));
  if (!Array.isArray(episodes) || episodes.length === 0) {
    console.error('No episodes found in generatedEpisodes.json — nothing to ingest.');
    process.exit(1);
  }

  // Fresh staging dir each run.
  if (existsSync(STAGING_DIR)) rmSync(STAGING_DIR, { recursive: true, force: true });
  mkdirSync(STAGING_DIR, { recursive: true });

  const summary = { processed: [], skipped: [], totalChunks: 0 };
  const archive = { version: 1, episodes: [] };

  for (const episode of episodes) {
    const videoId = episode.videoId;
    if (!videoId) {
      summary.skipped.push({ title: episode.title, reason: 'no videoId' });
      continue;
    }

    let cues = loadLocalTranscript(videoId);
    let source = 'local-transcript';
    if (!cues && !process.argv.includes('--local-only')) {
      cues = await fetchYouTubeCaptions(videoId);
      source = 'youtube-captions';
    }
    if (!cues || cues.length === 0) {
      summary.skipped.push({
        title: episode.title,
        videoId,
        reason: `no captions (add podcast-transcripts/${videoId}.json to include)`,
      });
      continue;
    }

    const entry = buildPodcastEpisode(episode, cues);
    const windows = entry.chunks;
    archive.episodes.push(entry);
    for (const w of windows) writeChunk(videoId, episode, w);
    summary.totalChunks += windows.length;
    summary.processed.push({ title: episode.title, videoId, chunks: windows.length, source });
  }

  // Report — explicit, never silently drops anything.
  console.log('\n=== Vector Podcast transcript ingestion (staging) ===');
  console.log(`Staging dir: ${STAGING_DIR}`);
  console.log(`Episodes processed: ${summary.processed.length}`);
  for (const p of summary.processed) {
    console.log(`  + ${p.title} (${p.videoId}) — ${p.chunks} chunks [${p.source}]`);
  }
  if (summary.skipped.length > 0) {
    console.log(`Episodes SKIPPED: ${summary.skipped.length}`);
    for (const s of summary.skipped) {
      console.log(`  - ${s.title || '(untitled)'}${s.videoId ? ` (${s.videoId})` : ''} — ${s.reason}`);
    }
  }
  console.log(`Total chunks written: ${summary.totalChunks}`);

  console.log('\n=== Next steps (operator-run — these touch AWS) ===');
  console.log(`1. Sync chunks to S3:`);
  console.log(
    `     aws s3 sync ${STAGING_DIR} s3://${BUCKET}/${PODCAST_CONTENT_PREFIX} --profile qdev-personal --region us-east-1`,
  );
  console.log(`2. Start ingestion into the podcast KB:`);
  console.log(
    `     aws bedrock-agent start-ingestion-job --knowledge-base-id ${KB_ID} --data-source-id ${DATA_SOURCE_ID} --profile qdev-personal --region us-east-1`,
  );
  console.log('');

  if (summary.totalChunks === 0) {
    console.error('No chunks were produced. Provide captions or local transcripts before syncing.');
    process.exit(1);
  }
  if (summary.skipped.length > 0) {
    throw new Error('Bundled archive was not replaced: provide transcripts for every published episode first.');
  }
  writeFileSync(BUNDLED_INDEX, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  console.log(`Bundled timestamped search index: ${BUNDLED_INDEX}`);
}

main().catch((err) => {
  console.error('ingest-podcast-transcripts failed:', err);
  process.exit(1);
});
