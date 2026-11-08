export const PODCAST_CONTENT_PREFIX = 'content/';

export function chunkCues(cues) {
  if (!Array.isArray(cues) || cues.length === 0) throw new Error('Transcript has no cues');
  const windows = [];
  let current = null;
  let previousStart = -1;
  for (const cue of cues) {
    if (!cue || typeof cue.text !== 'string' || !Number.isFinite(cue.start) || cue.start < previousStart) {
      throw new Error('Transcript cues must have text and nonnegative, ordered timestamps');
    }
    if (cue.start < 0 || cue.start > 86400) throw new Error('Transcript timestamp is out of bounds');
    previousStart = cue.start;
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > 6000) throw new Error('Transcript cue is too large');
    if (!current || cue.start - current.startSeconds >= 45 || current.text.length + text.length + 1 > 600) {
      if (current) windows.push(current);
      current = { startSeconds: Math.floor(cue.start), text };
    } else {
      current.text += ` ${text}`;
    }
  }
  if (current) windows.push(current);
  if (windows.length === 0) throw new Error('Transcript contains no speech');
  return windows;
}

export function buildPodcastEpisode(episode, cues) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(episode.videoId) || typeof episode.title !== 'string' || !episode.title.trim()) {
    throw new Error('Invalid published episode');
  }
  return {
    videoId: episode.videoId,
    episodeTitle: episode.title,
    episodeNumber: episode.episodeNumber ?? 0,
    chunks: chunkCues(cues),
  };
}
