/* global document, innerWidth */
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.argv[2] || 'http://127.0.0.1:4173';
const output = process.argv[3] || '/tmp/thechrisgrey-browser-check';
const routes = [
  '/',
  '/about',
  '/contact',
  '/blog',
  '/podcast',
  '/blueprint',
  '/chat',
  '/aws',
  '/claude',
  '/foundation',
  '/altivum',
  '/beyond-the-assessment',
  '/links',
  '/newsletter/confirm',
];
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox'],
});
const report = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    for (const route of routes) {
      const errors = [];
      const images = new Map();
      const onError = (error) => errors.push(String(error));
      const onResponse = (response) => {
        if (response.request().resourceType() === 'image')
          images.set(response.url(), { status: response.status(), type: response.headers()['content-type'] || '' });
      };
      page.on('pageerror', onError);
      page.on('response', onResponse);
      await page.goto(new URL(route, origin).href, { waitUntil: 'networkidle2', timeout: 45000 });
      const initialResources = await page.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, bytes: entry.transferSize })),
      );
      if (route === '/') {
        const initialBytes = initialResources.reduce((sum, resource) => sum + resource.bytes, 0);
        const eagerHeavyResources = initialResources.filter((resource) =>
          /three-vendor|r3f-vendor|alti\.glb|elk-|mermaid/i.test(resource.name),
        );
        if (initialBytes > 1000000 || eagerHeavyResources.length)
          throw new Error(
            `Home transfer budget failed: ${initialBytes} bytes; unexpected 3D/diagram resources: ${eagerHeavyResources.length}`,
          );
        report.push({ check: 'home transfer budget', width, initialBytes, eagerHeavyResources });
      }
      await page.evaluate(async () => {
        for (const image of document.images) image.loading = 'eager';
        await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
        await document.fonts.ready;
      });
      const result = await page.evaluate(() => ({
        title: document.title,
        h1: [...document.querySelectorAll('h1')].map((node) => node.textContent),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        brokenImages: [...document.images]
          .filter((image) => image.currentSrc && (!image.complete || image.naturalWidth === 0))
          .map((image) => image.currentSrc),
        decodedImages: [...document.images].filter((image) => image.naturalWidth > 0).length,
        portrait: [...document.images].find((image) => image.alt === 'Christian Perez')?.currentSrc,
        formTop: document.querySelector('#name')?.getBoundingClientRect().top,
      }));
      const badImageResponses = [...images].filter(
        ([, response]) => response.status >= 400 || (response.status !== 304 && !response.type.startsWith('image/')),
      );
      report.push({ width, route, ...result, errors, badImageResponses });
      console.log(JSON.stringify(report.at(-1)));
      if (['/', '/contact', '/blog', '/podcast', '/chat'].includes(route)) {
        await page.screenshot({ path: `${output}/${width}-${route.replaceAll('/', '_') || 'home'}.png` });
      }
      page.off('pageerror', onError);
      page.off('response', onResponse);
    }
    await context.close();
  }

  const page = await browser.newPage();
  for (const width of [375, 768, 1024, 1280, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(origin, { waitUntil: 'networkidle2' });
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('nav a, nav button')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width && rect.height && (rect.left < -1 || rect.right > innerWidth + 1);
        })
        .map((node) => node.textContent),
    );
    report.push({ check: 'navigation', width, clipped });
    if (clipped.length) throw new Error(`Navigation clipped at ${width}px: ${clipped}`);
  }

  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => (/hero-portrait-.*\.jpg/.test(request.url()) ? request.abort() : request.continue()));
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() =>
    [...document.images].some(
      (image) => image.alt === 'Christian Perez' && image.currentSrc.includes('Professional') && image.naturalWidth > 0,
    ),
  );
  report.push({ check: 'original PNG fallback', passed: true });
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
const failures = report.filter(
  (item) => item.overflow || item.brokenImages?.length || item.errors?.length || item.badImageResponses?.length,
);
if (failures.length) {
  console.error(`${failures.length} browser checks failed. See ${output}/report.json`);
  process.exitCode = 1;
} else {
  console.log(`Browser checks passed. Report: ${output}/report.json`);
}
