import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPodcastEpisode, chunkCues, PODCAST_CONTENT_PREFIX } from './lib/podcast-corpus.mjs';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

describe('podcast corpus generation', () => {
  it('preserves the first actual cue timestamp through chunk boundaries', () => {
    expect(
      chunkCues([
        { start: 10.9, text: 'First cue' },
        { start: 20, text: 'Second cue' },
        { start: 56, text: 'New passage' },
      ]),
    ).toEqual([
      { startSeconds: 10, text: 'First cue Second cue' },
      { startSeconds: 56, text: 'New passage' },
    ]);
    expect(
      chunkCues([
        { start: 1, text: 'a'.repeat(599) },
        { start: 5, text: 'next' },
      ]),
    ).toHaveLength(2);
  });
  it('rejects empty, malformed, negative and out-of-order cues', () => {
    for (const cues of [
      [],
      null,
      [{ start: -1, text: 'bad' }],
      [{ start: '1', text: 'bad' }],
      [{ start: 0, text: ' ' }],
      [{ start: 1, text: 'x'.repeat(6001) }],
      [
        { start: 3, text: 'a' },
        { start: 2, text: 'b' },
      ],
    ]) {
      expect(() => chunkCues(cues)).toThrow();
    }
    expect(() => buildPodcastEpisode({ videoId: 'bad', title: 'Title' }, [{ start: 0, text: 'hello' }])).toThrow();
  });
  it('targets the deployed data source prefix without deleting unrelated source objects', () => {
    const template = readFileSync(join(scriptDirectory, '../infra/personal-account-foundation.yaml'), 'utf8');
    expect(template).toContain(`InclusionPrefixes:\n            - ${PODCAST_CONTENT_PREFIX}`);
    for (const name of ['transcribe-podcast.mjs', 'transcribe-youtube.mjs']) {
      const script = readFileSync(join(scriptDirectory, name), 'utf8');
      expect(script).toContain('s3://${SRC_BUCKET}/${PODCAST_CONTENT_PREFIX}');
      expect(script).not.toContain("'--delete'");
    }
  });
});
