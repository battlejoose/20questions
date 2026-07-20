#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const args = {
  url: 'http://127.0.0.1:5188',
  out: 'artifacts/portrait-views',
  mobile: false,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === '--url') args.url = process.argv[++index];
  else if (value === '--out') args.out = process.argv[++index];
  else if (value === '--mobile') args.mobile = true;
  else throw new Error(`Unknown argument: ${value}`);
}

const views = [
  'front',
  'three-quarter-left',
  'three-quarter-right',
  'profile-left',
  'profile-right',
];
const articulationStates = [
  'bilabial-contact',
  'labiodental-contact',
  'open-vowel',
  'rounded-vowel',
];

function halfScale(source) {
  const target = new PNG({ width: Math.floor(source.width / 2), height: Math.floor(source.height / 2) });
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const sourceOffset = ((y * 2) * source.width + x * 2) * 4;
      const targetOffset = (y * target.width + x) * 4;
      source.data.copy(target.data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return target;
}

async function main() {
  await mkdir(args.out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext(args.mobile
    ? { ...devices['iPhone 13'], userAgent: undefined }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, {
    timeout: 20_000,
  });
  await page.evaluate(() => {
    window.__GNM_AVATAR_TEST_HOOKS__?.setReducedMotion(true);
    window.__GNM_AVATAR_TEST_HOOKS__?.setPausedForScreenshot(true);
  });

  const captures = [];
  const capture = async (view, state) => {
    await page.evaluate(({ viewName, stateName }) => {
      window.__GNM_AVATAR_TEST_HOOKS__?.setView(viewName);
      window.__GNM_AVATAR_TEST_HOOKS__?.setState(stateName);
    }, { viewName: view, stateName: state });
    await page.waitForTimeout(240);
    const dataUrl = await page.evaluate(() => window.__GNM_AVATAR_TEST_HOOKS__?.captureCanvasPng());
    const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const filename = `${args.mobile ? 'mobile' : 'desktop'}-${view}-${state}.png`;
    await writeFile(path.join(args.out, filename), buffer);
    captures.push({
      view,
      state,
      filename,
      png: PNG.sync.read(buffer),
      diagnostics: await page.evaluate(() => window.__GNM_AVATAR_DIAGNOSTICS__),
    });
  };

  for (const view of views) await capture(view, 'idle');
  for (const state of articulationStates) await capture('front', state);
  await page.screenshot({
    path: path.join(args.out, `${args.mobile ? 'mobile' : 'desktop'}-app.png`),
    fullPage: true,
  });

  const neutral = captures.filter((captureItem) => captureItem.state === 'idle');
  const scaled = neutral.map((captureItem) => halfScale(captureItem.png));
  const grid = new PNG({ width: scaled[0].width * 3, height: scaled[0].height * 2 });
  grid.data.fill(244);
  scaled.forEach((image, index) => {
    const offsetX = (index % 3) * image.width;
    const offsetY = Math.floor(index / 3) * image.height;
    PNG.bitblt(image, grid, 0, 0, image.width, image.height, offsetX, offsetY);
  });
  await writeFile(
    path.join(args.out, `${args.mobile ? 'mobile' : 'desktop'}-neutral-view-grid.png`),
    PNG.sync.write(grid),
  );

  const report = {
    url: args.url,
    mode: args.mobile ? 'mobile' : 'desktop',
    views,
    articulationStates,
    consoleErrors,
    pageErrors,
    captures: captures.map(({ png, ...captureItem }) => captureItem),
  };
  await writeFile(path.join(args.out, `${report.mode}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({
    mode: report.mode,
    captureCount: captures.length,
    consoleErrors,
    pageErrors,
    renderer: captures[0].diagnostics?.renderer,
  }, null, 2));
  if (consoleErrors.length || pageErrors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
