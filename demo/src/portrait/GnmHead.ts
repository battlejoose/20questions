import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import {
  toGnmSpeechMorphWeights,
  protectSmileForOralContact,
  speechCompatibleExpressionWeight,
  suppressCompetingExpression,
  type ExpressivePerformanceFrame,
  type SpeechRigWeights,
} from '../speech';
import { createGnmHeadMaterials, type GnmHeadMaterials } from './gnmMaterials';
import { MysticSmoke } from './MysticSmoke';
import { visibleStageViewOffset } from './visibleStageFraming';

const MODEL_URL = '/assets/models/gnm-neutral.runtime.glb';
const HEAD_PIVOT_Y = 0.105;
const DEFAULT_HEAD_YAW = 0;
const GNM_ORAL_SOURCE_PIVOT = new THREE.Vector3(0, 0.232, 0.112);

export interface PortraitLoadProgress {
  loaded: number;
  total: number;
  ratio: number | null;
}

export interface PortraitRendererDiagnostics {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface PortraitOralDiagnostics {
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
}

type MorphWeights = Record<string, number>;

function clamp(value: number, max = 1): number {
  return THREE.MathUtils.clamp(value, 0, max);
}

function setMaximum(target: MorphWeights, name: string, value: number): void {
  target[name] = Math.max(target[name] ?? 0, clamp(value));
}

export class GnmHead {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(31, 1, 0.01, 6);
  private readonly controls: OrbitControls;
  private readonly portraitRoot = new THREE.Group();
  private readonly headAssembly = new THREE.Group();
  private readonly headContent = new THREE.Group();
  private readonly morphMeshes: THREE.Mesh[] = [];
  private readonly gnmOralMeshes: THREE.Mesh[] = [];
  private readonly pointer = new THREE.Vector2();
  private readonly targetHeadRotation = new THREE.Euler();
  private readonly onPointerMove = (event: PointerEvent): void => this.handlePointerMove(event);
  private readonly onPointerLeave = (): void => {
    this.pointer.set(0, 0);
  };
  private materials: GnmHeadMaterials | undefined;
  private environment: THREE.Texture | undefined;
  private smoke: MysticSmoke | undefined;
  private speechWeights: Readonly<SpeechRigWeights> | undefined;
  private performanceFrame: Readonly<ExpressivePerformanceFrame> | undefined;
  private modelLoaded = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pauseForScreenshot = false;
  private deterministicElapsed = 0;
  private lastMobileLayout: boolean | undefined;
  private previewMorphs: MorphWeights | undefined;
  private inspectionYaw: number | undefined;
  private registeredGnmLipPatch: THREE.Mesh | undefined;
  private oralLandmarkIndices: { upper: number; lower: number } | undefined;
  private semanticOralTriangleCount = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onLoadProgress?: (progress: PortraitLoadProgress) => void,
  ) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = 0.91;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.add(this.portraitRoot);
    this.headAssembly.position.y = HEAD_PIVOT_Y;
    this.headContent.position.y = -HEAD_PIVOT_Y;
    this.headAssembly.add(this.headContent);
    this.portraitRoot.add(this.headAssembly);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.7;
    this.controls.maxDistance = 1.22;
    this.controls.minPolarAngle = Math.PI * 0.42;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    this.controls.minAzimuthAngle = -0.42;
    this.controls.maxAzimuthAngle = 0.42;

    this.createStage();
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    this.resize(true);
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const headPromise = new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
      loader.load(
        MODEL_URL,
        resolve,
        (event) => {
          this.onLoadProgress?.({
            loaded: event.loaded,
            total: event.total,
            ratio: event.total > 0 ? event.loaded / event.total : null,
          });
        },
        reject,
      );
    });
    const gltf = await headPromise;

    this.materials = createGnmHeadMaterials(this.renderer.capabilities.getMaxAnisotropy());
    gltf.scene.name = 'gnm_population_mean_head';
    this.headContent.add(gltf.scene);
    this.scene.updateMatrixWorld(true);
    let fittedSkin: THREE.Mesh | undefined;
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
      const sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
      const sourceMaterialName = sourceMaterial?.name?.toLowerCase() ?? '';
      if (sourceMaterialName === 'skin') {
        fittedSkin = object;
      } else if (
        ['teeth', 'upper_teeth', 'lower_teeth', 'tongue'].includes(sourceMaterialName)
      ) {
        object.visible = true;
        object.userData.oralComponent = sourceMaterialName;
        this.gnmOralMeshes.push(object);
      } else if (['sclera', 'iris', 'pupil', 'eye_interior'].includes(sourceMaterialName)) {
        object.visible = true;
      }
      this.assignMaterial(object);
      if (object.morphTargetInfluences && object.morphTargetDictionary) {
        this.morphMeshes.push(object);
      }
    });
    if (!fittedSkin) throw new Error('The GNM asset is missing its native skin primitive.');
    fittedSkin.visible = true;
    this.initializeNativeGnmOralDiagnostics(fittedSkin);
    this.resize(true);
    this.modelLoaded = true;
    this.onLoadProgress?.({ loaded: 1, total: 1, ratio: 1 });
  }

  setSpeechWeights(weights: Readonly<SpeechRigWeights>): void {
    this.speechWeights = weights;
  }

  setExpressivePerformance(frame: Readonly<ExpressivePerformanceFrame>): void {
    this.performanceFrame = frame;
  }

  clearPreviewState(): void {
    this.previewMorphs = undefined;
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled) this.pointer.set(0, 0);
  }

  setPausedForScreenshot(paused: boolean): void {
    this.pauseForScreenshot = paused;
  }

  setInspectionView(name: string): void {
    const yaws: Record<string, number> = {
      front: 0,
      'three-quarter-left': -Math.PI / 6,
      'three-quarter-right': Math.PI / 6,
      'profile-left': -Math.PI * 0.5,
      'profile-right': Math.PI * 0.5,
    };
    if (!(name in yaws)) throw new Error(`Unknown portrait inspection view: ${name}`);
    this.inspectionYaw = yaws[name];
    this.headAssembly.rotation.y = yaws[name];
  }

  setPreviewState(name: string): void {
    if (name === 'idle') {
      this.previewMorphs = { eyeOpen: 0, browConcern: 0.035 };
    } else if (name === 'speaking') {
      this.previewMorphs = {
        eyeOpen: 0,
        jawOpen: 0.36,
        vowel_EH: 0.52,
        viseme_TDN: 0.18,
        browConcern: 0.035,
      };
    } else if (name === 'bilabial-contact') {
      this.previewMorphs = { eyeOpen: 0, viseme_MBP: 1, browConcern: 0.035 };
    } else if (name === 'labiodental-contact') {
      this.previewMorphs = { eyeOpen: 0, viseme_FV: 1, jawOpen: 0.1, browConcern: 0.035 };
    } else if (name === 'open-vowel') {
      // Mirrors the production /ɑ/ pose after the speech-rig adapter.
      this.previewMorphs = {
        eyeOpen: 0,
        jawOpen: 0.7,
        vowel_AA: 0.92,
        lowerLipDepress: 0.16,
        tongueBodyLow: 0.68,
        browConcern: 0.035,
      };
    } else if (name === 'rounded-vowel') {
      this.previewMorphs = {
        eyeOpen: 0,
        viseme_WQ: 0.86,
        mouthPucker: 0.7,
        mouthFunnel: 0.4,
        browConcern: 0.035,
      };
    } else {
      throw new Error(`Unknown portrait preview state: ${name}`);
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    const elapsed = this.pauseForScreenshot ? this.deterministicElapsed : elapsedSeconds;
    if (!this.pauseForScreenshot) this.deterministicElapsed = elapsedSeconds;
    this.resize(false);
    this.controls.enabled = !this.pauseForScreenshot;
    this.controls.update(deltaSeconds);
    this.smoke?.update(elapsed, this.reducedMotion);

    const pointerX = this.reducedMotion ? 0 : this.pointer.x;
    const pointerY = this.reducedMotion ? 0 : this.pointer.y;
    const performancePitch = this.inspectionYaw === undefined
      ? this.performanceFrame?.headPitch ?? 0
      : 0;
    const performanceYaw = this.inspectionYaw === undefined
      ? this.performanceFrame?.headYaw ?? 0
      : 0;
    const performanceRoll = this.inspectionYaw === undefined
      ? this.performanceFrame?.headRoll ?? 0
      : 0;
    this.targetHeadRotation.set(
      this.inspectionYaw === undefined ? pointerY * -0.024 + performancePitch : 0,
      this.inspectionYaw ?? DEFAULT_HEAD_YAW + pointerX * 0.052 + performanceYaw,
      this.inspectionYaw === undefined ? pointerX * -0.008 + performanceRoll : 0,
    );
    const directedHeadGesture = this.performanceFrame?.diagnostics.actionGesture;
    const headResponseRate = directedHeadGesture === 'nod' || directedHeadGesture === 'shake'
      ? 18
      : directedHeadGesture === 'emphasis'
        ? 10
        : 5.5;
    const damping = 1 - Math.exp(-deltaSeconds * headResponseRate);
    this.headAssembly.rotation.x = THREE.MathUtils.lerp(
      this.headAssembly.rotation.x,
      this.targetHeadRotation.x,
      damping,
    );
    this.headAssembly.rotation.y = THREE.MathUtils.lerp(
      this.headAssembly.rotation.y,
      this.targetHeadRotation.y,
      damping,
    );
    this.headAssembly.rotation.z = THREE.MathUtils.lerp(
      this.headAssembly.rotation.z,
      this.targetHeadRotation.z,
      damping,
    );

    const morphs = this.mapSpeechRig(
      this.previewMorphs ? undefined : this.speechWeights,
      this.performanceFrame,
    );
    if (this.previewMorphs) {
      for (const [name, value] of Object.entries(this.previewMorphs)) {
        setMaximum(morphs, name, value);
      }
      const previewContact = Math.max(
        this.previewMorphs.viseme_MBP ?? 0,
        this.previewMorphs.viseme_FV ?? 0,
        this.previewMorphs.viseme_L ?? 0,
        this.previewMorphs.viseme_TH ?? 0,
        this.previewMorphs.viseme_TDN ?? 0,
        this.previewMorphs.viseme_SZ ?? 0,
        this.previewMorphs.viseme_CHSH ?? 0,
        this.previewMorphs.viseme_KG ?? 0,
      );
      this.applyExpressionContactPolicy(morphs, previewContact, previewContact);
    }
    this.applyMorphs(morphs);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  captureCanvasPng(): string {
    // Read back immediately after drawing, before the browser is allowed to
    // discard a non-preserved WebGL buffer. Used only by deterministic QA.
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  isLoaded(): boolean {
    return this.modelLoaded;
  }

  getRendererDiagnostics(): PortraitRendererDiagnostics {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  getOralDiagnostics(): PortraitOralDiagnostics | null {
    const patch = this.registeredGnmLipPatch;
    const landmarks = this.oralLandmarkIndices;
    if (!patch || !landmarks || !this.modelLoaded) return null;

    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const upperWorld = patch.localToWorld(
      patch.getVertexPosition(landmarks.upper, new THREE.Vector3()),
    );
    const lowerWorld = patch.localToWorld(
      patch.getVertexPosition(landmarks.lower, new THREE.Vector3()),
    );
    const upperHead = this.headContent.worldToLocal(upperWorld.clone());
    const lowerHead = this.headContent.worldToLocal(lowerWorld.clone());
    const apertureMillimeters = Math.max(0, upperHead.y - lowerHead.y) * 1000;

    const projectWorld = (point: THREE.Vector3): { x: number; y: number } => {
      const ndc = point.clone().project(this.camera);
      return {
        x: (ndc.x * 0.5 + 0.5) * this.canvas.width,
        y: (-ndc.y * 0.5 + 0.5) * this.canvas.height,
      };
    };
    const projectHead = (point: THREE.Vector3): { x: number; y: number } =>
      projectWorld(this.headContent.localToWorld(point.clone()));
    const upperLipPx = projectWorld(upperWorld);
    const lowerLipPx = projectWorld(lowerWorld);
    const mouthCenterPx = projectHead(GNM_ORAL_SOURCE_PIVOT);
    const leftPx = projectHead(
      GNM_ORAL_SOURCE_PIVOT.clone().add(new THREE.Vector3(-0.04, 0, 0.008)),
    );
    const rightPx = projectHead(
      GNM_ORAL_SOURCE_PIVOT.clone().add(new THREE.Vector3(0.04, 0, 0.008)),
    );
    const topPx = projectHead(
      GNM_ORAL_SOURCE_PIVOT.clone().add(new THREE.Vector3(0, 0.036, 0.008)),
    );
    const bottomPx = projectHead(
      GNM_ORAL_SOURCE_PIVOT.clone().add(new THREE.Vector3(0, -0.04, 0.008)),
    );
    const cropLeft = THREE.MathUtils.clamp(
      Math.floor(Math.min(leftPx.x, rightPx.x)),
      0,
      Math.max(0, this.canvas.width - 1),
    );
    const cropRight = THREE.MathUtils.clamp(
      Math.ceil(Math.max(leftPx.x, rightPx.x)),
      cropLeft + 1,
      this.canvas.width,
    );
    const cropTop = THREE.MathUtils.clamp(
      Math.floor(Math.min(topPx.y, bottomPx.y)),
      0,
      Math.max(0, this.canvas.height - 1),
    );
    const cropBottom = THREE.MathUtils.clamp(
      Math.ceil(Math.max(topPx.y, bottomPx.y)),
      cropTop + 1,
      this.canvas.height,
    );

    return {
      registered: true,
      outerSurface: 'native-gnm-continuous-surface',
      apertureMillimeters,
      aperturePixels: Math.abs(upperLipPx.y - lowerLipPx.y),
      upperLipPx,
      lowerLipPx,
      mouthCenterPx,
      mouthHalfWidthPx: Math.abs(rightPx.x - leftPx.x) * 0.44,
      cropPx: {
        x: cropLeft,
        y: cropTop,
        width: cropRight - cropLeft,
        height: cropBottom - cropTop,
      },
      visible: {
        lips: patch.visible,
        teeth: this.gnmOralMeshes.some((mesh) =>
          mesh.visible && String(mesh.userData.oralComponent).includes('teeth')),
        tongue: this.gnmOralMeshes.some((mesh) =>
          mesh.visible && mesh.userData.oralComponent === 'tongue'),
        cavity: patch.visible,
      },
      semanticTriangles: this.semanticOralTriangleCount,
    };
  }

  getCanvasDiagnostics(): {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  } {
    const maxDpr = window.innerWidth <= 720 ? 1.5 : 2;
    return {
      clientWidth: this.canvas.clientWidth,
      clientHeight: this.canvas.clientHeight,
      width: this.canvas.width,
      height: this.canvas.height,
      dpr: Math.min(window.devicePixelRatio || 1, maxDpr),
    };
  }

  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.materials?.dispose();
    this.smoke?.dispose();
    this.environment?.dispose();
    this.renderer.dispose();
  }

  private createStage(): void {
    this.scene.background = new THREE.Color('#020305');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.13;
    pmrem.dispose();

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.45),
      new THREE.MeshStandardMaterial({ color: '#03060a', roughness: 1 }),
    );
    backdrop.name = 'nocturne_room_backdrop';
    backdrop.position.set(0, 0.22, -0.255);
    this.scene.add(backdrop);

    this.smoke = new MysticSmoke();
    this.portraitRoot.add(this.smoke.root);

    const hemisphere = new THREE.HemisphereLight('#8195ad', '#020205', 0.16);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight('#ffdfc5', 1.3);
    key.position.set(-0.58, 0.62, 0.48);
    key.target.position.set(-0.128, 0.265, 0.05);
    key.target.name = 'mystic_key_target';
    key.castShadow = true;
    key.shadow.mapSize.set(768, 768);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 2;
    key.shadow.camera.left = -0.42;
    key.shadow.camera.right = 0.42;
    key.shadow.camera.top = 0.48;
    key.shadow.camera.bottom = -0.3;
    key.shadow.bias = -0.00015;
    this.scene.add(key, key.target);

    const fill = new THREE.PointLight('#789cc8', 0.14, 2.5, 2);
    fill.position.set(0.42, 0.34, 0.42);
    this.scene.add(fill);

    const rim = new THREE.SpotLight('#7ca9de', 1.08, 2.2, Math.PI * 0.22, 0.82, 1.7);
    rim.position.set(0.38, 0.55, -0.02);
    rim.target.position.set(-0.128, 0.29, 0.01);
    rim.target.name = 'mystic_rim_target';
    this.scene.add(rim, rim.target);
  }

  private assignMaterial(mesh: THREE.Mesh): void {
    if (!this.materials) return;
    const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = sourceMaterial?.name?.toLowerCase() ?? '';
    if (name === 'skin') mesh.material = this.materials.skin;
    else if (name === 'sclera') mesh.material = this.materials.sclera;
    else if (name === 'iris') mesh.material = this.materials.iris;
    else if (name === 'pupil') mesh.material = this.materials.pupil;
    else if (name === 'eye_interior') mesh.material = this.materials.eyeInterior;
    else if (['teeth', 'upper_teeth', 'lower_teeth'].includes(name)) {
      mesh.material = this.materials.teeth;
    }
    else if (name === 'tongue') mesh.material = this.materials.tongue;
    sourceMaterial?.dispose();
  }

  private mapSpeechRig(
    rig: Readonly<SpeechRigWeights> | undefined,
    performance: Readonly<ExpressivePerformanceFrame> | undefined,
  ): MorphWeights {
    const expression = performance?.morphs;
    const blink = Math.max(expression?.blinkLeft ?? 0, expression?.blinkRight ?? 0);
    const browLift = expression?.browLift ?? 0;
    const browFurrow = suppressCompetingExpression(
      expression?.browFurrow ?? 0,
      browLift,
      0.55,
    );
    const eyeWiden = suppressCompetingExpression(expression?.eyeWiden ?? 0, blink, 0.92);
    const eyeSquint = suppressCompetingExpression(
      expression?.eyeSquint ?? 0,
      eyeWiden,
      0.75,
    );
    const hardContact = rig ? Math.max(
      rig.contactBilabial,
      rig.contactLabiodental,
      rig.contactDental,
      rig.contactAlveolar,
      rig.contactLateral,
      rig.contactVelar,
      rig.lipsTogether,
    ) : 0;
    const lipClosureContact = rig ? Math.max(
      rig.contactBilabial,
      rig.contactLabiodental,
      rig.lipsTogether,
    ) : 0;
    const morphs: MorphWeights = {
      blinkLeft: expression?.blinkLeft ?? 0,
      blinkRight: expression?.blinkRight ?? 0,
      eyeOpen: expression?.eyeOpen ?? 0,
      browConcern: expression?.browConcern ?? 0.035,
      browLift,
      browFurrow,
      eyeWiden,
      eyeSquint,
      cheekRaise: expression?.cheekRaise ?? 0,
      browLiftLeft: expression?.browLiftLeft ?? 0,
      browLiftRight: expression?.browLiftRight ?? 0,
      gazeLeft: expression?.gazeLeft ?? 0,
      gazeRight: expression?.gazeRight ?? 0,
      gazeUp: expression?.gazeUp ?? 0,
      gazeDown: expression?.gazeDown ?? 0,
      smile: expression?.smile ?? 0,
      smileMouth: expression?.smileMouth ?? 0,
      surpriseMouth: expression?.surpriseMouth ?? 0,
      concernMouth: expression?.concernMouth ?? 0,
      curiosityMouth: expression?.curiosityMouth ?? 0,
      emphasisMouth: expression?.emphasisMouth ?? 0,
    };
    this.applyExpressionContactPolicy(morphs, hardContact, lipClosureContact);
    if (!rig) return morphs;

    for (const [name, value] of Object.entries(toGnmSpeechMorphWeights(rig))) {
      setMaximum(morphs, name, value);
    }
    return morphs;
  }

  private applyExpressionContactPolicy(
    morphs: MorphWeights,
    hardContact: number,
    lipClosureContact: number,
  ): void {
    // The upper-face channels never need suppression. Each learned lower-face
    // target keeps the portion compatible with its articulatory conflict:
    // corners can retain a visible trace through a closed-lip smile, while a
    // jaw-drop surprise yields almost completely to any required contact.
    morphs.smile = protectSmileForOralContact(morphs.smile ?? 0, lipClosureContact);
    morphs.smileMouth = speechCompatibleExpressionWeight(
      morphs.smileMouth ?? 0,
      lipClosureContact,
      0.12,
    );
    morphs.surpriseMouth = speechCompatibleExpressionWeight(
      morphs.surpriseMouth ?? 0,
      hardContact,
      0.04,
    );
    morphs.concernMouth = speechCompatibleExpressionWeight(
      morphs.concernMouth ?? 0,
      lipClosureContact,
      0.62,
    );
    morphs.curiosityMouth = speechCompatibleExpressionWeight(
      morphs.curiosityMouth ?? 0,
      hardContact,
      0.24,
    );
    morphs.emphasisMouth = speechCompatibleExpressionWeight(
      morphs.emphasisMouth ?? 0,
      lipClosureContact,
      0.4,
    );
  }

  private applyMorphs(morphs: MorphWeights): void {
    for (const mesh of this.morphMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const [name, index] of Object.entries(dictionary)) {
        influences[index] = clamp(morphs[name] ?? 0);
      }
    }
  }

  private initializeNativeGnmOralDiagnostics(fittedSkin: THREE.Mesh): void {
    const position = fittedSkin.geometry.getAttribute('position');
    const semantics = fittedSkin.geometry.getAttribute('color');
    const index = fittedSkin.geometry.getIndex();
    if (!position || !semantics || semantics.itemSize < 4 || !index) {
      throw new Error('The native GNM skin is missing its semantic oral attributes.');
    }

    const selectCenterLipEdge = (channel: 0 | 1, preferMaximumY: boolean): number => {
      let selected = -1;
      let selectedY = preferMaximumY
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY;
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        const semantic = channel === 0
          ? semantics.getX(vertex)
          : semantics.getY(vertex);
        if (semantic < 0.5) continue;
        const x = position.getX(vertex);
        const z = position.getZ(vertex);
        if (Math.abs(x) > 0.004 || z < 0.12) continue;
        const y = position.getY(vertex);
        if (
          (preferMaximumY && y > selectedY) ||
          (!preferMaximumY && y < selectedY)
        ) {
          selected = vertex;
          selectedY = y;
        }
      }
      if (selected < 0) throw new Error('A native GNM center-lip landmark could not be selected.');
      return selected;
    };

    this.oralLandmarkIndices = {
      upper: selectCenterLipEdge(0, false),
      lower: selectCenterLipEdge(1, true),
    };
    let semanticTriangles = 0;
    for (let offset = 0; offset < index.count; offset += 3) {
      const a = index.getX(offset);
      const b = index.getX(offset + 1);
      const c = index.getX(offset + 2);
      const isOral = (vertex: number): boolean => Math.max(
        semantics.getX(vertex),
        semantics.getY(vertex),
        semantics.getW(vertex),
      ) > 0.5;
      if (isOral(a) && isOral(b) && isOral(c)) semanticTriangles += 1;
    }
    this.semanticOralTriangleCount = semanticTriangles;
    this.registeredGnmLipPatch = fittedSkin;
    fittedSkin.userData.oralArchitecture = {
      outerSurface: 'native-gnm-continuous-surface',
      topology: 'unchanged',
      morphTargets: Object.keys(fittedSkin.morphTargetDictionary ?? {}).length,
      semanticTriangles,
    };
  }

  private handlePointerMove(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.set(
      THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
      THREE.MathUtils.clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1),
    );
  }

  private resize(force: boolean): void {
    const mobile = window.innerWidth <= 760;
    const resized = resizeRenderer(this.renderer, this.camera, mobile ? 1.5 : 2);
    if (!force && !resized && mobile === this.lastMobileLayout) return;

    this.lastMobileLayout = mobile;
    this.controls.minDistance = mobile ? 0.88 : 0.7;
    this.controls.maxDistance = mobile ? 1.5 : 1.22;
    this.controls.target.set(0, mobile ? 0.205 : 0.258, 0.045);
    this.camera.position.set(0, mobile ? 0.225 : 0.263, mobile ? 1.36 : 0.88);
    this.camera.fov = 28;
    this.camera.clearViewOffset();
    if (!mobile) {
      const view = this.getVisibleStageViewOffset();
      if (view.offsetX > 0) {
        this.camera.setViewOffset(
          view.fullWidth,
          view.fullHeight,
          view.offsetX,
          view.offsetY,
          view.width,
          view.height,
        );
      }
    }
    this.portraitRoot.position.x = 0;
    this.portraitRoot.position.y = 0;
    const keyTarget = this.scene.getObjectByName('mystic_key_target');
    if (keyTarget) keyTarget.position.x = 0;
    const rimTarget = this.scene.getObjectByName('mystic_rim_target');
    if (rimTarget) rimTarget.position.x = 0;
    this.smoke?.setMobileLayout(mobile);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private getVisibleStageViewOffset(): ReturnType<typeof visibleStageViewOffset> {
    const panel = document.querySelector<HTMLElement>('#speech-studio');
    const canvasRect = this.canvas.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const isRightSidePanel = panelRect
      && panelRect.right >= canvasRect.right - 1
      && panelRect.top <= canvasRect.top + 1
      && panelRect.bottom >= canvasRect.bottom - 1;
    const rightOverlap = isRightSidePanel
      ? THREE.MathUtils.clamp(canvasRect.right - panelRect.left, 0, canvasRect.width)
      : 0;
    return visibleStageViewOffset({
      canvasWidth: canvasRect.width,
      canvasHeight: canvasRect.height,
      rightOverlap,
    });
  }
}
