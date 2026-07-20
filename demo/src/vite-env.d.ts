/// <reference types="vite/client" />

interface GnmAvatarDiagnostics {
  frame: number;
  elapsed: number;
  loaded: boolean;
  speechState: string;
  previewState: string | null;
  activeGesture: string;
  timing: {
    frameTimeMs: number;
    fps: number;
  };
  expression: {
    affect: 'neutral' | 'warm' | 'surprise' | 'question' | 'concerned' | 'emphatic';
    intensity: number;
    discourseAct: string;
    intentSource: string;
    intentConfidence: number;
    envelopePhase: 'idle' | 'anticipation' | 'active' | 'release' | 'residue' | 'ended';
    maximumMorphWeight: number;
    gazeState: string;
    blinkPhase: 'open' | 'closing' | 'closed' | 'opening';
    cueCount: number;
    plannerMs: number;
    speechTime: number;
    actionGesture: string;
    actionPhase: 'idle' | 'waiting' | 'attack' | 'hold' | 'release';
  } | null;
  headMotion: {
    pitch: number;
    yaw: number;
    roll: number;
  };
  oral: {
    registered: boolean;
    outerSurface: 'native-gnm-continuous-surface';
    apertureMillimeters: number;
    aperturePixels: number;
    upperLipPx: { x: number; y: number };
    lowerLipPx: { x: number; y: number };
    mouthCenterPx: { x: number; y: number };
    mouthHalfWidthPx: number;
    cropPx: { x: number; y: number; width: number; height: number };
    visible: {
      lips: boolean;
      teeth: boolean;
      tongue: boolean;
      cavity: boolean;
    };
    semanticTriangles: number;
  } | null;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface GnmAvatarTestHooks {
  /** Re-seed deterministic portrait timing for stable capture. */
  seed(value: number): void;
  /** Jump to an articulation state: idle, speaking, or an oral-contact pose. */
  setState(name: string): void;
  /** Replay a deterministic neutral/warm/surprise/concern/question/emphatic pose. */
  setExpressionScenario(name: string): void;
  /** Select a deterministic front, three-quarter, or profile review camera. */
  setView(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide nonessential diagnostics before capturing. */
  hideDebugUi(hidden: boolean): void;
  /** Draw and read the raw WebGL buffer in the same task for canvas-only QA. */
  captureCanvasPng(): string;
}

interface Window {
  __GNM_AVATAR_DIAGNOSTICS__?: GnmAvatarDiagnostics;
  __GNM_AVATAR_TEST_HOOKS__?: GnmAvatarTestHooks;
}
