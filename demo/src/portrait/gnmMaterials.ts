import * as THREE from 'three';

export interface GnmHeadMaterials {
  skin: THREE.MeshPhysicalMaterial;
  sclera: THREE.MeshPhysicalMaterial;
  iris: THREE.MeshPhysicalMaterial;
  pupil: THREE.MeshPhysicalMaterial;
  eyeInterior: THREE.MeshStandardMaterial;
  teeth: THREE.MeshPhysicalMaterial;
  tongue: THREE.MeshPhysicalMaterial;
  dispose(): void;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function noise(x: number, y: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const localX = x - cellX;
  const localY = y - cellY;
  const smoothX = localX * localX * (3 - 2 * localX);
  const smoothY = localY * localY * (3 - 2 * localY);
  const hash = (offsetX: number, offsetY: number): number =>
    fract(Math.sin((cellX + offsetX) * 127.1 + (cellY + offsetY) * 311.7) * 43758.5453);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(0, 0), hash(1, 0), smoothX),
    THREE.MathUtils.lerp(hash(0, 1), hash(1, 1), smoothX),
    smoothY,
  );
}

function createSkinMaps(size = 384): {
  albedo: THREE.DataTexture;
  bump: THREE.DataTexture;
} {
  const albedoBytes = new Uint8Array(size * size * 4);
  const bumpBytes = new Uint8Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const broad = noise(x / 46, y / 46) - 0.5;
      const pores = noise(x / 5.4 + 19.2, y / 5.4 - 7.1) - 0.5;
      const offset = index * 4;
      albedoBytes[offset] = THREE.MathUtils.clamp(187 + broad * 18 + pores * 4, 0, 255);
      albedoBytes[offset + 1] = THREE.MathUtils.clamp(139 + broad * 12 + pores * 3, 0, 255);
      albedoBytes[offset + 2] = THREE.MathUtils.clamp(119 + broad * 9 + pores * 2, 0, 255);
      albedoBytes[offset + 3] = 255;
      bumpBytes[index] = THREE.MathUtils.clamp(126 + pores * 50 + broad * 12, 0, 255);
    }
  }

  const albedo = new THREE.DataTexture(albedoBytes, size, size, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.DataTexture(bumpBytes, size, size, THREE.RedFormat);
  for (const texture of [albedo, bump]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  return { albedo, bump };
}

/**
 * COLOR_0 contains GNM's native oral semantics: upper lip, lower lip,
 * mouth-sock, and broader perioral region. Only material response changes;
 * no lip shell, cutout, or second cavity is introduced.
 */
function installNativeOralShading(material: THREE.MeshPhysicalMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `
attribute vec4 color;
varying vec4 vGnmOral;
varying float vGnmWorldY;
varying vec3 vGnmDitherPoint;
` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vGnmOral = color;`,
    ).replace(
      '#include <project_vertex>',
      `vGnmWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
       vGnmDitherPoint = transformed;
       #include <project_vertex>`,
    );
    shader.fragmentShader = `
varying vec4 vGnmOral;
varying float vGnmWorldY;
varying vec3 vGnmDitherPoint;
` + shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float neckFade = smoothstep(0.138, 0.158, vGnmWorldY);
         vec3 neckCell = floor(vGnmDitherPoint * 701.0);
         float neckGrain = fract(sin(dot(neckCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
         if (neckFade < neckGrain) discard;
         float upperLip = smoothstep(0.22, 0.72, vGnmOral.r);
         float lowerLip = smoothstep(0.22, 0.72, vGnmOral.g);
         float lipMask = max(upperLip, lowerLip);
         float mouthSock = smoothstep(0.12, 0.68, vGnmOral.b);
         float perioral = smoothstep(0.18, 0.82, vGnmOral.a);
         vec3 lipColor = diffuseColor.rgb * vec3(0.76, 0.66, 0.64)
           + vec3(0.034, 0.010, 0.012);
         diffuseColor.rgb = mix(diffuseColor.rgb, lipColor, lipMask * 0.62);
         diffuseColor.rgb *= mix(vec3(1.0), vec3(0.98, 0.955, 0.95), perioral * 0.08);
         vec3 oralInterior = vec3(0.010, 0.0016, 0.0024);
         diffuseColor.rgb = mix(diffuseColor.rgb, oralInterior, mouthSock * 0.992);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float lipRoughness = max(
           smoothstep(0.22, 0.72, vGnmOral.r),
           smoothstep(0.22, 0.72, vGnmOral.g)
         );
         float sockRoughness = smoothstep(0.12, 0.68, vGnmOral.b);
         roughnessFactor = mix(roughnessFactor, 0.68, lipRoughness * 0.45);
         roughnessFactor = mix(roughnessFactor, 0.96, sockRoughness);`,
      );
  };
  material.customProgramCacheKey = () => 'gnm-native-oral-surface-neck-dissolve-v2';
}

export function createGnmHeadMaterials(maxAnisotropy: number): GnmHeadMaterials {
  const skinMaps = createSkinMaps();
  skinMaps.albedo.anisotropy = Math.min(8, maxAnisotropy);

  const skin = new THREE.MeshPhysicalMaterial({
    name: 'gnm_population_mean_skin',
    color: '#fff2e8',
    map: skinMaps.albedo,
    roughness: 0.96,
    bumpMap: skinMaps.bump,
    bumpScale: 0.00012,
    metalness: 0,
    ior: 1.42,
    specularIntensity: 0.035,
    sheen: 0.01,
    sheenColor: new THREE.Color('#8f4f43'),
    sheenRoughness: 0.86,
    clearcoat: 0,
    envMapIntensity: 0.055,
  });
  installNativeOralShading(skin);

  const sclera = new THREE.MeshPhysicalMaterial({
    name: 'gnm_sclera',
    color: '#b4aaa1',
    roughness: 0.39,
    clearcoat: 0.18,
    clearcoatRoughness: 0.3,
    ior: 1.376,
    specularIntensity: 0.18,
    envMapIntensity: 0.2,
  });
  const iris = new THREE.MeshPhysicalMaterial({
    name: 'gnm_iris',
    color: '#30251d',
    roughness: 0.3,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.3,
  });
  const pupil = new THREE.MeshPhysicalMaterial({
    name: 'gnm_pupil',
    color: '#050506',
    roughness: 0.16,
    clearcoat: 0.34,
  });
  const eyeInterior = new THREE.MeshStandardMaterial({
    name: 'gnm_eye_interior',
    color: '#10080a',
    roughness: 0.9,
    side: THREE.BackSide,
  });
  const teeth = new THREE.MeshPhysicalMaterial({
    name: 'gnm_enamel',
    color: '#d7cfb9',
    roughness: 0.46,
    clearcoat: 0.08,
    clearcoatRoughness: 0.55,
    specularIntensity: 0.2,
  });
  const tongue = new THREE.MeshPhysicalMaterial({
    name: 'gnm_tongue',
    color: '#7d3543',
    roughness: 0.62,
    clearcoat: 0.06,
    clearcoatRoughness: 0.7,
    specularIntensity: 0.18,
  });
  const materials: THREE.Material[] = [
    skin,
    sclera,
    iris,
    pupil,
    eyeInterior,
    teeth,
    tongue,
  ];
  return {
    skin,
    sclera,
    iris,
    pupil,
    eyeInterior,
    teeth,
    tongue,
    dispose: () => {
      for (const entry of materials) entry.dispose();
      skinMaps.albedo.dispose();
      skinMaps.bump.dispose();
    },
  };
}
