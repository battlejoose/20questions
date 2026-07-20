import * as THREE from 'three';

interface SmokeWisp {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector2;
  baseOpacity: number;
  baseRotation: number;
  phase: number;
  speed: number;
  drift: THREE.Vector2;
}

interface SmokeWispSpec {
  position: [number, number, number];
  scale: [number, number];
  opacity: number;
  rotation: number;
  phase: number;
  speed: number;
  drift: [number, number];
  color: string;
  texture: 0 | 1 | 2;
  foreground?: boolean;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const localX = x - cellX;
  const localY = y - cellY;
  const easedX = localX * localX * (3 - 2 * localX);
  const easedY = localY * localY * (3 - 2 * localY);
  const hash = (offsetX: number, offsetY: number): number => fract(
    Math.sin(
      (cellX + offsetX) * 127.1
      + (cellY + offsetY) * 311.7
      + seed * 74.37,
    ) * 43758.5453,
  );
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(0, 0), hash(1, 0), easedX),
    THREE.MathUtils.lerp(hash(0, 1), hash(1, 1), easedX),
    easedY,
  );
}

function fbm(x: number, y: number, seed: number): number {
  let amplitude = 0.54;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 1.73) * amplitude;
    normalization += amplitude;
    frequency *= 2.03;
    amplitude *= 0.49;
  }
  return total / normalization;
}

function createSmokeTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the procedural smoke texture.');
  const image = context.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const warp = fbm(nx * 1.55 + seed * 0.17, ny * 1.8 - seed * 0.11, seed);
      const curl = nx
        + Math.sin((ny + warp * 0.22) * 3.15 + seed * 1.9) * 0.17
        + (warp - 0.5) * 0.34;
      const body = fbm(
        nx * 2.35 + warp * 0.62,
        ny * 2.7 - warp * 0.36,
        seed + 5.4,
      );
      const detail = fbm(nx * 5.7 - warp, ny * 6.1 + warp, seed + 11.8);
      const ridge = 1 - Math.abs(body * 2 - 1);
      const ribbon = Math.exp(-curl * curl * 7.5);
      const radialDistance = Math.sqrt(nx * nx * 0.72 + ny * ny);
      const radial = 1 - smoothstep(0.38, 1.02, radialDistance);
      const filament = smoothstep(0.5, 0.88, ridge * 0.72 + ribbon * 0.5);
      const breakup = smoothstep(0.28, 0.78, detail);
      const alpha = THREE.MathUtils.clamp(
        Math.pow(radial * filament * (0.3 + breakup * 0.82), 1.18),
        0,
        1,
      );
      const offset = (y * size + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(alpha * 255);
    }
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `procedural_mystic_smoke_${seed}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createNeckVeilTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the procedural neck veil.');
  const image = context.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const distance = Math.sqrt(nx * nx * 0.78 + ny * ny * 1.18);
      const softEdge = 1 - smoothstep(0.35, 1, distance);
      const cloud = fbm(nx * 2.2 + 1.7, ny * 2.8 - 0.6, 14.3);
      const filament = fbm(nx * 5.4 - cloud, ny * 4.7 + cloud, 19.8);
      const density = softEdge * (0.88 + cloud * 0.08 + filament * 0.04);
      const offset = (y * size + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(THREE.MathUtils.clamp(density, 0, 1) * 255);
    }
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'procedural_dense_neck_smoke';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const WISPS: readonly SmokeWispSpec[] = [
  { position: [-0.2, 0.34, -0.075], scale: [0.34, 0.23], opacity: 0.17, rotation: -0.28, phase: 0.2, speed: 0.12, drift: [0.018, 0.012], color: '#64778d', texture: 0 },
  { position: [0.19, 0.33, -0.07], scale: [0.36, 0.24], opacity: 0.14, rotation: 0.34, phase: 1.7, speed: 0.1, drift: [0.016, 0.014], color: '#53667d', texture: 1 },
  { position: [-0.24, 0.2, -0.055], scale: [0.31, 0.2], opacity: 0.19, rotation: 0.5, phase: 2.8, speed: 0.14, drift: [0.022, 0.01], color: '#46586e', texture: 1 },
  { position: [0.24, 0.19, -0.05], scale: [0.32, 0.2], opacity: 0.17, rotation: -0.42, phase: 4.1, speed: 0.13, drift: [0.019, 0.013], color: '#6a5d68', texture: 0 },
  { position: [-0.08, 0.105, -0.035], scale: [0.39, 0.17], opacity: 0.16, rotation: 0.12, phase: 5.2, speed: 0.11, drift: [0.015, 0.009], color: '#536173', texture: 0 },
  { position: [0.1, 0.455, -0.085], scale: [0.29, 0.16], opacity: 0.08, rotation: -0.62, phase: 3.4, speed: 0.09, drift: [0.012, 0.01], color: '#64778d', texture: 1 },
  { position: [-0.145, 0.165, 0.215], scale: [0.34, 0.21], opacity: 0.48, rotation: -0.3, phase: 0.8, speed: 0.15, drift: [0.018, 0.008], color: '#3d5670', texture: 1, foreground: true },
  { position: [0.145, 0.168, 0.216], scale: [0.35, 0.21], opacity: 0.46, rotation: 0.32, phase: 2.2, speed: 0.14, drift: [0.017, 0.009], color: '#465e75', texture: 0, foreground: true },
  { position: [-0.13, 0.15, 0.207], scale: [0.25, 0.2], opacity: 0.82, rotation: -0.48, phase: 1.35, speed: 0.09, drift: [0.01, 0.006], color: '#03060a', texture: 2, foreground: true },
  { position: [0.13, 0.152, 0.208], scale: [0.25, 0.2], opacity: 0.82, rotation: 0.48, phase: 2.85, speed: 0.09, drift: [0.01, 0.006], color: '#03060a', texture: 2, foreground: true },
  { position: [0, 0.132, 0.205], scale: [0.45, 0.19], opacity: 1, rotation: 0.03, phase: 3.7, speed: 0.08, drift: [0.009, 0.004], color: '#020407', texture: 2, foreground: true },
  { position: [0.015, 0.148, 0.21], scale: [0.4, 0.15], opacity: 0.2, rotation: -0.08, phase: 4.25, speed: 0.11, drift: [0.012, 0.006], color: '#40546b', texture: 1, foreground: true },
  { position: [-0.19, 0.12, 0.218], scale: [0.3, 0.17], opacity: 0.32, rotation: 0.42, phase: 4.7, speed: 0.12, drift: [0.015, 0.007], color: '#435c76', texture: 0, foreground: true },
  { position: [0.19, 0.122, 0.219], scale: [0.3, 0.17], opacity: 0.31, rotation: -0.42, phase: 5.45, speed: 0.12, drift: [0.015, 0.007], color: '#435c76', texture: 1, foreground: true },
  { position: [-0.225, 0.25, 0.18], scale: [0.22, 0.14], opacity: 0.1, rotation: 0.7, phase: 4.8, speed: 0.12, drift: [0.014, 0.012], color: '#53687c', texture: 0, foreground: true },
  { position: [0.23, 0.255, 0.18], scale: [0.23, 0.14], opacity: 0.09, rotation: -0.65, phase: 5.9, speed: 0.11, drift: [0.016, 0.011], color: '#53687c', texture: 1, foreground: true },
] as const;

export class MysticSmoke {
  readonly root = new THREE.Group();
  private readonly textures = [
    createSmokeTexture(2.7),
    createSmokeTexture(8.9),
    createNeckVeilTexture(),
  ];
  private readonly wisps: SmokeWisp[] = [];

  constructor() {
    this.root.name = 'mystic_smoke_chamber';
    for (const spec of WISPS) {
      const material = new THREE.SpriteMaterial({
        name: spec.foreground ? 'smoke_front' : 'smoke_back',
        map: this.textures[spec.texture],
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        depthTest: !spec.foreground,
        blending: THREE.NormalBlending,
        fog: false,
      });
      material.rotation = spec.rotation;
      const sprite = new THREE.Sprite(material);
      sprite.name = spec.foreground ? 'foreground_neck_wisp' : 'background_silhouette_wisp';
      sprite.position.set(...spec.position);
      sprite.scale.set(spec.scale[0], spec.scale[1], 1);
      sprite.renderOrder = spec.foreground ? 12 : -2;
      sprite.frustumCulled = true;
      this.root.add(sprite);
      this.wisps.push({
        sprite,
        material,
        basePosition: sprite.position.clone(),
        baseScale: new THREE.Vector2(...spec.scale),
        baseOpacity: spec.opacity,
        baseRotation: spec.rotation,
        phase: spec.phase,
        speed: spec.speed,
        drift: new THREE.Vector2(...spec.drift),
      });
    }
  }

  update(elapsedSeconds: number, reducedMotion: boolean): void {
    const time = reducedMotion ? 0 : elapsedSeconds;
    for (const wisp of this.wisps) {
      const wave = time * wisp.speed + wisp.phase;
      wisp.sprite.position.x = wisp.basePosition.x + Math.sin(wave * 1.7) * wisp.drift.x;
      wisp.sprite.position.y = wisp.basePosition.y + Math.cos(wave * 1.13) * wisp.drift.y;
      const breath = 1 + Math.sin(wave * 0.83) * 0.045;
      wisp.sprite.scale.set(wisp.baseScale.x * breath, wisp.baseScale.y / breath, 1);
      wisp.material.rotation = wisp.baseRotation + Math.sin(wave * 0.71) * 0.075;
      wisp.material.opacity = wisp.baseOpacity * (0.84 + Math.sin(wave * 1.31) * 0.16);
    }
  }

  setMobileLayout(mobile: boolean): void {
    this.root.scale.setScalar(mobile ? 0.82 : 1);
    this.root.position.y = mobile ? 0.035 : 0;
  }

  dispose(): void {
    for (const wisp of this.wisps) wisp.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
