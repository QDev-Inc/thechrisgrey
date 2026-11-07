#!/usr/bin/env node
/**
 * transcribe-youtube.mjs
 *
 * Fills in transcripts for any episode in generatedEpisodes.json that does NOT yet
 * have podcast-transcripts/<videoId>.json, sourcing audio from YouTube via yt-dlp
 * (for episodes not on the Riverside RSS). Same Amazon Transcribe → cue conversion
 * as transcribe-podcast.mjs, then stages + syncs + starts the KB ingestion job so
 * the newly added episodes are indexed alongside the existing ones.
 *
 * Requires: yt-dlp + ffmpeg on PATH.
 * Env: THECHRISGREY_AWS_PROFILE (qdev-personal, account 973662476023 asserted first),
 *      PODCAST_KB_ID, PODCAST_KB_DATA_SOURCE_ID, PODCAST_KB_SOURCE_BUCKET
 *      (each defaults to the current foundation stack output), AWS_REGION (us-east-1)
 *
 * Usage: node scripts/transcribe-youtube.mjs            # all missing episodes
 *        node scripts/transcribe-youtube.mjs <id> <id>  # specific videoIds
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getFoundationOutputs, pinAwsAccount } from './lib/aws-preflight.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOME = pinAwsAccount(); // asserts the account before any AWS call
const FOUNDATION = getFoundationOutputs();
const REGION = process.env.AWS_REGION || 'us-east-1';
const KB_ID = process.env.PODCAST_KB_ID || FOUNDATION.PodcastKnowledgeBaseId;
const DS_ID = process.env.PODCAST_KB_DATA_SOURCE_ID || FOUNDATION.PodcastKnowledgeBaseDataSourceId;
const SRC_BUCKET = process.env.PODCAST_KB_SOURCE_BUCKET || FOUNDATION.PodcastKnowledgeBaseSourceBucketName;
const TMP_BUCKET = `thechrisgrey-transcribe-tmp-${HOME.account}`;
const TRANSCRIPTS_DIR = join(ROOT, 'podcast-transcripts');
const AUDIO_TMP = join(ROOT, '.transcribe-audio');

const aws = (args) =>
  execFileSync('aws', [...args, '--region', REGION], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      if (/[.!?]/.test(content) && lastEnd - (start ?? lastEnd) >= 6) flush();
      continue;
    }
    const s = parseFloat(it.start_time),
      e = parseFloat(it.end_time);
    if (start === null) start = s;
    words.push(content);
    lastEnd = e;
    if (e - start >= 22) flush();
  }
  flush();
  return cues;
}

async function main() {
  if (!existsSync(TRANSCRIPTS_DIR)) mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  if (!existsSync(AUDIO_TMP)) mkdirSync(AUDIO_TMP, { recursive: true });

  const eps = JSON.parse(readFileSync(join(ROOT, 'src/data/generatedEpisodes.json'), 'utf8')).episodes;
  const argIds = process.argv.slice(2);
  const targets = eps.filter(
    (e) =>
      e.videoId &&
      (argIds.length ? argIds.includes(e.videoId) : !existsSync(join(TRANSCRIPTS_DIR, `${e.videoId}.json`))),
  );
  if (!targets.length) {
    console.log('Nothing to do — all episodes already have transcripts.');
    return;
  }
  console.log(`Transcribing ${targets.length} episode(s) from YouTube:`);
  targets.forEach((t) => console.log(`  ${t.videoId}  ${t.title.slice(0, 60)}`));

  try {
    aws(['s3api', 'head-bucket', '--bucket', TMP_BUCKET]);
  } catch {
    aws(['s3api', 'create-bucket', '--bucket', TMP_BUCKET]);
    console.log(`created ${TMP_BUCKET}`);
  }

  const jobs = [];
  for (const t of targets) {
    const mp3 = join(AUDIO_TMP, `${t.videoId}.mp3`);
    console.log(`downloading audio ${t.videoId}...`);
    execFileSync(
      'yt-dlp',
      [
        '-x',
        '--audio-format',
        'mp3',
        '--no-warnings',
        '-o',
        join(AUDIO_TMP, `${t.videoId}.%(ext)s`),
        `https://www.youtube.com/watch?v=${t.videoId}`,
      ],
      { stdio: 'inherit' },
    );
    aws(['s3', 'cp', mp3, `s3://${TMP_BUCKET}/audio/${t.videoId}.mp3`]);
    const jobName = `tcg-${t.videoId}`;
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
      `MediaFileUri=s3://${TMP_BUCKET}/audio/${t.videoId}.mp3`,
      '--output-bucket-name',
      TMP_BUCKET,
      '--output-key',
      `transcripts/${t.videoId}.json`,
    ]);
    jobs.push({ ...t, jobName });
    console.log(`started transcribe job ${jobName}`);
  }

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
        writeFileSync(join(TRANSCRIPTS_DIR, `${j.videoId}.json`), JSON.stringify(cues));
        console.log(`COMPLETED ${j.videoId} -> ${cues.length} cues`);
      } else if (st === 'FAILED') {
        pending.delete(j.jobName);
        console.error(`FAILED ${j.videoId}`);
      }
    }
    if (pending.size) console.log(`  ...waiting on ${pending.size} job(s)`);
  }

  console.log('\n=== Staging chunks (all episodes) ===');
  execFileSync('node', [join(ROOT, 'scripts/ingest-podcast-transcripts.mjs')], { stdio: 'inherit' });
  console.log('=== Syncing to S3 ===');
  aws(['s3', 'sync', join(ROOT, 'podcast-kb-staging'), `s3://${SRC_BUCKET}/`, '--delete']);
  console.log('=== Starting ingestion job ===');
  const job = JSON.parse(
    aws(['bedrock-agent', 'start-ingestion-job', '--knowledge-base-id', KB_ID, '--data-source-id', DS_ID]),
  );
  console.log(`ingestion job: ${job.ingestionJob.ingestionJobId} (${job.ingestionJob.status})`);
}

main().catch((e) => {
  console.error('transcribe-youtube failed:', e);
  process.exit(1);
});
