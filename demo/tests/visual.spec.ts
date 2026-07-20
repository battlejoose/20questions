import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

type StableCanvasCapture = {
  buffer: Buffer;
  png: PNG;
};

async function waitForRenderedFrames(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

async function captureStableRawCanvas(
  page: import('@playwright/test').Page,
): Promise<StableCanvasCapture> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const dataUrl = await page.evaluate(() => window.__GNM_AVATAR_TEST_HOOKS__?.captureCanvasPng());
    if (!dataUrl) throw new Error('The portrait canvas capture hook returned no image.');
    const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const png = PNG.sync.read(buffer);
    let exactBlack = 0;
    for (let pixel = 0; pixel < png.width * png.height; pixel += 1) {
      const offset = pixel * 4;
      if (
        png.data[offset] === 0 &&
        png.data[offset + 1] === 0 &&
        png.data[offset + 2] === 0 &&
        png.data[offset + 3] > 0
      ) exactBlack += 1;
    }
    if (exactBlack / (png.width * png.height) <= 0.01) return { buffer, png };
    await waitForRenderedFrames(page);
  }
  throw new Error('The raw portrait canvas repeatedly contained a transient black-frame artifact.');
}

function cropPng(
  source: PNG,
  crop: { x: number; y: number; width: number; height: number },
): Buffer {
  const x = Math.max(0, Math.min(source.width - 1, Math.floor(crop.x)));
  const y = Math.max(0, Math.min(source.height - 1, Math.floor(crop.y)));
  const width = Math.max(1, Math.min(source.width - x, Math.ceil(crop.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.ceil(crop.height)));
  const target = new PNG({ width, height });
  PNG.bitblt(source, target, x, y, width, height, 0, 0);
  return PNG.sync.write(target);
}

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const canvas = page.locator('#portrait-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) return { ok: false, reason: 'canvas-too-small' };

  const png = PNG.sync.read(await canvas.screenshot());
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));
  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const [r, g, b, a] = png.data.subarray(offset, offset + 4);
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }
  const variance = max - min;
  return {
    ok: alphaPixels > 256 && variance > 18 && buckets.size > 10,
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
  };
}

test('renders a nonblank fitted portrait and opens its evidence panel', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#portrait-canvas')).toBeVisible();
  await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, {
    timeout: 20_000,
  });
  await expect(page.locator('#loading-overlay')).toBeHidden();
  expect(await sampleCanvas(page)).toMatchObject({ ok: true });

  await page.locator('#open-evidence').click();
  await expect(page.locator('#evidence-dialog')).toBeVisible();
  await expect(page.locator('#evidence-dialog .architecture-flow span')).toHaveCount(5);
  await expect(page.locator('#evidence-dialog')).toContainText('51');
  await expect(page.locator('#evidence-dialog')).toContainText('without a learned animation model');
  await page.locator('#close-evidence').click();

  const diagnostics = await page.evaluate(() => window.__GNM_AVATAR_DIAGNOSTICS__);
  expect(diagnostics?.renderer.calls).toBeLessThanOrEqual(testInfo.project.name.includes('mobile') ? 150 : 300);
  expect(diagnostics?.renderer.triangles).toBeLessThanOrEqual(
    testInfo.project.name.includes('mobile') ? 300_000 : 750_000,
  );

  await testInfo.attach(`${testInfo.project.name}-portrait`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('native GNM mouth visibly opens and closes in rendered pixels', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, {
    timeout: 20_000,
  });
  await page.evaluate(() => {
    window.__GNM_AVATAR_TEST_HOOKS__?.setReducedMotion(true);
    window.__GNM_AVATAR_TEST_HOOKS__?.setPausedForScreenshot(true);
    window.__GNM_AVATAR_TEST_HOOKS__?.setView('front');
    window.__GNM_AVATAR_TEST_HOOKS__?.setState('bilabial-contact');
  });
  await waitForRenderedFrames(page);
  const closedDiagnostics = await page.evaluate(
    () => window.__GNM_AVATAR_DIAGNOSTICS__?.oral ?? null,
  );
  const closedCapture = await captureStableRawCanvas(page);

  await page.evaluate(() => window.__GNM_AVATAR_TEST_HOOKS__?.setState('open-vowel'));
  await waitForRenderedFrames(page);
  const openDiagnostics = await page.evaluate(
    () => window.__GNM_AVATAR_DIAGNOSTICS__?.oral ?? null,
  );
  const openCapture = await captureStableRawCanvas(page);

  expect(closedDiagnostics?.registered).toBe(true);
  expect(openDiagnostics?.registered).toBe(true);
  expect(openDiagnostics?.visible).toMatchObject({
    lips: true,
    teeth: true,
    tongue: true,
    cavity: true,
  });
  expect(openDiagnostics?.semanticTriangles).toBeGreaterThanOrEqual(400);
  expect(openDiagnostics?.apertureMillimeters ?? 0).toBeGreaterThanOrEqual(10);
  expect(
    (openDiagnostics?.apertureMillimeters ?? 0) -
      (closedDiagnostics?.apertureMillimeters ?? 0),
  ).toBeGreaterThanOrEqual(6);
  expect(openDiagnostics?.aperturePixels ?? 0).toBeGreaterThanOrEqual(8);
  expect(
    (openDiagnostics?.aperturePixels ?? 0) - (closedDiagnostics?.aperturePixels ?? 0),
  ).toBeGreaterThanOrEqual(5);

  const crop = openDiagnostics!.cropPx;
  const x0 = Math.max(0, Math.floor(crop.x));
  const y0 = Math.max(0, Math.floor(crop.y));
  const x1 = Math.min(openCapture.png.width, Math.ceil(crop.x + crop.width));
  const y1 = Math.min(openCapture.png.height, Math.ceil(crop.y + crop.height));
  let changedPixels = 0;
  let comparedPixels = 0;
  const changedRows: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    let rowChanged = 0;
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * openCapture.png.width + x) * 4;
      const delta = Math.max(
        Math.abs(openCapture.png.data[offset] - closedCapture.png.data[offset]),
        Math.abs(openCapture.png.data[offset + 1] - closedCapture.png.data[offset + 1]),
        Math.abs(openCapture.png.data[offset + 2] - closedCapture.png.data[offset + 2]),
      );
      comparedPixels += 1;
      if (delta > 24) {
        changedPixels += 1;
        rowChanged += 1;
      }
    }
    if (rowChanged >= Math.max(2, (x1 - x0) * 0.06)) changedRows.push(y);
  }
  const changedRatio = changedPixels / Math.max(1, comparedPixels);
  const changedRowSpan = changedRows.length
    ? changedRows[changedRows.length - 1] - changedRows[0] + 1
    : 0;
  expect(changedRatio).toBeGreaterThanOrEqual(0.12);
  expect(changedRowSpan).toBeGreaterThanOrEqual(6);
  expect(changedRowSpan).toBeGreaterThanOrEqual(
    Math.floor((openDiagnostics?.aperturePixels ?? 0) * 0.35),
  );

  await testInfo.attach(`${testInfo.project.name}-mouth-bilabial`, {
    body: cropPng(closedCapture.png, crop),
    contentType: 'image/png',
  });
  await testInfo.attach(`${testInfo.project.name}-mouth-open-vowel`, {
    body: cropPng(openCapture.png, crop),
    contentType: 'image/png',
  });
});
