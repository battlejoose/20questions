import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleStageViewOffset } from '../../src/portrait/visibleStageFraming';

for (const viewport of [
  { canvasWidth: 1280, canvasHeight: 720, panelWidth: 435 },
  { canvasWidth: 1654, canvasHeight: 1287, panelWidth: 427 },
]) {
  test(`centers the head in the visible stage at ${viewport.canvasWidth}x${viewport.canvasHeight}`, () => {
    const view = visibleStageViewOffset({
      canvasWidth: viewport.canvasWidth,
      canvasHeight: viewport.canvasHeight,
      rightOverlap: viewport.panelWidth,
    });
    const projectedX = viewport.canvasWidth * 0.5 - view.offsetX;
    const visibleStageCenter = (viewport.canvasWidth - viewport.panelWidth) * 0.5;
    assert.ok(Math.abs(projectedX - visibleStageCenter) < 1e-9);
    assert.deepEqual(view, {
      fullWidth: viewport.canvasWidth,
      fullHeight: viewport.canvasHeight,
      offsetX: viewport.panelWidth * 0.5,
      offsetY: 0,
      width: viewport.canvasWidth,
      height: viewport.canvasHeight,
    });
  });
}
