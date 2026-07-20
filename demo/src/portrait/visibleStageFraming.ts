export interface VisibleStageFraming {
  canvasWidth: number;
  canvasHeight: number;
  rightOverlap: number;
}

export interface VisibleStageViewOffset {
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Build an off-axis projection that places world X=0 at the center of the
 * canvas area not covered by the right-side speech studio.
 */
export function visibleStageViewOffset({
  canvasWidth,
  canvasHeight,
  rightOverlap,
}: VisibleStageFraming): VisibleStageViewOffset {
  const safeCanvasWidth = Math.max(1, canvasWidth);
  const safeCanvasHeight = Math.max(1, canvasHeight);
  const clampedOverlap = Math.min(safeCanvasWidth, Math.max(0, rightOverlap));
  return {
    fullWidth: safeCanvasWidth,
    fullHeight: safeCanvasHeight,
    offsetX: clampedOverlap * 0.5,
    offsetY: 0,
    width: safeCanvasWidth,
    height: safeCanvasHeight,
  };
}
