import { readdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

const assets = await readdir('dist/assets');
for (const width of [480, 960, 1280]) {
  const file = assets.find((name) => new RegExp(`^hero-portrait-${width}-.*\\.jpg$`).test(name));
  if (!file) throw new Error(`Missing ${width}px portrait in production output`);
  const bytes = await readFile(`dist/assets/${file}`);
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== width || bytes.length > 100000) {
    throw new Error(`Invalid or oversized portrait: ${file}`);
  }
  console.log(`[images] ${file}: ${bytes.length} bytes, decoded ${metadata.width}×${metadata.height}`);
}
const fallback = await sharp('dist/press-kit/headshots/Professional Headshot.png').metadata();
if (fallback.format !== 'png' || !fallback.width) throw new Error('Original portrait fallback is missing or invalid');
console.log('[images] Original PNG fallback verified');
