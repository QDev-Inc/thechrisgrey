#!/usr/bin/env node
/**
 * transcribe-podcast.mjs
 *
 * Produces timestamped transcripts for The Vector Podcast using Amazon Transcribe
 * on the owner-hosted Riverside audio, then writes them to podcast-transcripts/<videoId>.json
 * (the format ingest-podcast-transcripts.mjs consumes).
 *
 * Pipeline per episode (matched RSS audio only):
 *   download MP3 -> upload to temp S3 -> start Transcribe job -> poll ->
 *   convert word items to sentence-level cues with start times -> write transcript JSON.
 *
 * Then it stages + syncs + starts the KB ingestion job.
 *
 * Env:
 *   THECHRISGREY_AWS_PROFILE   default: qdev-personal (account 973662476023 asserted first)
 *   PODCAST_KB_ID              default: current foundation stack output
 *   PODCAST_KB_DATA_SOURCE_ID  default: current foundation stack output
 *   PODCAST_KB_SOURCE_BUCKET   default: current foundation stack output
 *   AWS_REGION                 default: us-east-1
 *
 * Usage: node scripts/transcribe-podcast.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getFoundationOutputs, pinAwsAccount } from './lib/aws-preflight.mjs';
import { PODCAST_CONTENT_PREFIX } from './lib/podcast-corpus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOME = pinAwsAccount(); // asserts the account before any AWS call
const FOUNDATION = getFoundationOutputs();
const REGION = process.env.AWS_REGION || 'us-east-1';
const KB_ID = process.env.PODCAST_KB_ID || FOUNDATION.PodcastKnowledgeBaseId;
const DS_ID = process.env.PODCAST_KB_DATA_SOURCE_ID || FOUNDATION.PodcastKnowledgeBaseDataSourceId;
const SRC_BUCKET = process.env.PODCAST_KB_SOURCE_BUCKET || FOUNDATION.PodcastKnowledgeBaseSourceBucketName;
const RSS_URL = 'https://api.riverside.fm/hosting/heA0qRHh.rss';
const TMP_BUCKET = `thechrisgrey-transcribe-tmp-${HOME.account}`;
const TRANSCRIPTS_DIR = join(ROOT, 'podcast-transcripts');
const AUDIO_TMP = join(ROOT, '.transcribe-audio');

const aws = (args) =>
  execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim();
    const url = (block.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1];
    if (title && url) items.push({ title, url });
  }
  return items;
}

function matchEpisodes(eps, items) {
  const used = new Set();
  const out = [];
  for (const e of eps) {
    const a = new Set(norm(e.title).split(' '));
    let best = -1,
      score = 0;
    items.forEach((it, idx) => {
      if (used.has(idx)) return;
      const b = new Set(norm(it.title).split(' '));
      const inter = [...a].filter((x) => b.has(x)).length;
      const s = inter / new Set([...a, ...b]).size;
      if (s > score) {
        score = s;
        best = idx;
      }
    });
    if (best >= 0 && score > 0.5) {
      used.add(best);
      out.push({ videoId: e.videoId, title: e.title, episodeNumber: e.episodeNumber ?? 0, mp3: items[best].url });
    }
  }
  return out;
}

/** Transcribe results.items -> sentence-level cues [{start, dur, text}]. */
function itemsToCues(items) {
  const cues = [];
  let words = [],
    start = null,
    lastEnd = 0;
  const flush = () => {
    if (words.length) {
      const text = words
        .join(' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .trim();
      if (text) cues.push({ start: Math.floor(start), dur: Math.max(0, lastEnd - start), text });
    }
    words = [];
    start = null;
  };
  for (const it of items) {
    const content = it.alternatives?.[0]?.content;
    if (!content) continue;
    if (it.type === 'punctuation') {
      if (words.length) words[words.length - 1] += content;
      if (/[.!?]/.test(content)) {
        if (lastEnd - (start ?? lastEnd) >= 6) flush();
      }
      continue;
    }
    const s = parseFloat(it.start_time),
      e = parseFloat(it.end_time);
    if (start === null) start = s;
    words.push(content);
    lastEnd = e;
    if (e - start >= 22) flush(); // hard cap so cues don't run too long
  }
  flush();
  return cues;
}

async function main() {
  if (!existsSync(TRANSCRIPTS_DIR)) mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  if (!existsSync(AUDIO_TMP)) mkdirSync(AUDIO_TMP, { recursive: true });

  const eps = JSON.parse(readFileSync(join(ROOT, 'src/data/generatedEpisodes.json'), 'utf8')).episodes;
  const items = parseRss(await fetchText(RSS_URL));
  const matched = matchEpisodes(eps, items);
  console.log(`Matched ${matched.length} episodes to RSS audio:`);
  matched.forEach((m) => console.log(`  ${m.videoId}  ${m.title.slice(0, 60)}`));
  if (!matched.length) {
    console.error('No audio matched — aborting.');
    process.exit(1);
  }

  // Temp bucket for audio + transcribe output.
  try {
    aws(['s3api', 'head-bucket', '--bucket', TMP_BUCKET]);
  } catch {
    aws(['s3api', 'create-bucket', '--bucket', TMP_BUCKET]);
    console.log(`created ${TMP_BUCKET}`);
  }

  const jobs = [];
  for (const m of matched) {
    const transcriptPath = join(TRANSCRIPTS_DIR, `${m.videoId}.json`);
    if (existsSync(transcriptPath)) {
      console.log(`skip ${m.videoId} (transcript exists)`);
      continue;
    }
    const mp3 = join(AUDIO_TMP, `${m.videoId}.mp3`);
    console.log(`downloading ${m.videoId}...`);
    await download(m.mp3, mp3);
    aws(['s3', 'cp', mp3, `s3://${TMP_BUCKET}/audio/${m.videoId}.mp3`]);
    const jobName = `tcg-${m.videoId}`;
    try {
      aws(['transcribe', 'delete-transcription-job', '--transcription-job-name', jobName]);
    } catch {
      /* none */
    }
    aws([
      'transcribe',
      'start-transcription-job',
      '--transcription-job-name',
      jobName,
      '--language-code',
      'en-US',
      '--media-format',
      'mp3',
      '--media',
      `MediaFileUri=s3://${TMP_BUCKET}/audio/${m.videoId}.mp3`,
      '--output-bucket-name',
      TMP_BUCKET,
      '--output-key',
      `transcripts/${m.videoId}.json`,
    ]);
    jobs.push({ ...m, jobName, transcriptPath });
    console.log(`started transcribe job ${jobName}`);
  }

  // Poll
  const pending = new Set(jobs.map((j) => j.jobName));
  while (pending.size) {
    await sleep(20000);
    for (const j of jobs) {
      if (!pending.has(j.jobName)) continue;
      const st = JSON.parse(aws(['transcribe', 'get-transcription-job', '--transcription-job-name', j.jobName]))
        .TranscriptionJob.TranscriptionJobStatus;
      if (st === 'COMPLETED') {
        pending.delete(j.jobName);
        const raw = aws(['s3', 'cp', `s3://${TMP_BUCKET}/transcripts/${j.videoId}.json`, '-']);
        const cues = itemsToCues(JSON.parse(raw).results.items);
        writeFileSync(j.transcriptPath, JSON.stringify(cues));
        console.log(`COMPLETED ${j.videoId} -> ${cues.length} cues`);
      } else if (st === 'FAILED') {
        pending.delete(j.jobName);
        console.error(`FAILED ${j.videoId}`);
      }
    }
    if (pending.size) console.log(`  ...waiting on ${pending.size} job(s)`);
  }

  // Stage + sync + ingest
  console.log('\n=== Staging chunks ===');
  execFileSync('node', [join(ROOT, 'scripts/ingest-podcast-transcripts.mjs')], { stdio: 'inherit' });
  const staging = join(ROOT, 'podcast-kb-staging');
  console.log('=== Syncing to S3 ===');
  aws(['s3', 'sync', staging, `s3://${SRC_BUCKET}/${PODCAST_CONTENT_PREFIX}`]);
  console.log('=== Starting ingestion job ===');
  const job = JSON.parse(
    aws(['bedrock-agent', 'start-ingestion-job', '--knowledge-base-id', KB_ID, '--data-source-id', DS_ID]),
  );
  console.log(`ingestion job: ${job.ingestionJob.ingestionJobId} (${job.ingestionJob.status})`);
  console.log('\nDone. Temp audio bucket retained for debugging:', TMP_BUCKET);
}

main().catch((e) => {
  console.error('transcribe-podcast failed:', e);
  process.exit(1);
});
