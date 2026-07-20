import { stat } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const sourcePath = process.argv[2] ?? 'public/assets/models/gnm-neutral.glb';
const runtimePath = process.argv[3] ?? 'public/assets/models/gnm-neutral.runtime.glb';

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const document = await io.read(sourcePath);

await document.transform(meshopt({
  encoder: MeshoptEncoder,
  level: 'high',
  // Retain sub-0.01 mm authored shape/morph parity while compacting the
  // 60-target runtime rig. COLOR_0 is simultaneously packed to normalized
  // bytes, preserving its binary oral-semantic mask exactly.
  quantizePosition: 16,
  quantizeNormal: 10,
  quantizeColor: 8,
}));
await io.write(runtimePath, document);

const [source, runtime] = await Promise.all([stat(sourcePath), stat(runtimePath)]);
console.log(JSON.stringify({
  sourcePath,
  runtimePath,
  sourceBytes: source.size,
  runtimeBytes: runtime.size,
  ratio: runtime.size / source.size,
}, null, 2));
