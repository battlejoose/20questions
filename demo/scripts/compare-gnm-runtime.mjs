#!/usr/bin/env node
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const sourcePath = process.argv[2] ?? 'public/assets/models/gnm-neutral.glb';
const runtimePath = process.argv[3] ?? 'public/assets/models/gnm-neutral.runtime.glb';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const [source, runtime] = await Promise.all([io.read(sourcePath), io.read(runtimePath)]);
const sourceMesh = source.getRoot().listMeshes()[0];
const runtimeMesh = runtime.getRoot().listMeshes()[0];
const sourcePrimitives = sourceMesh.listPrimitives();
const runtimePrimitives = runtimeMesh.listPrimitives();
const sourceTargetNames = sourceMesh.getExtras()?.targetNames ?? [];
const runtimeTargetNames = runtimeMesh.getExtras()?.targetNames ?? [];
const targetNamesMatch =
  sourceTargetNames.length === runtimeTargetNames.length &&
  sourceTargetNames.every((name, index) => name === runtimeTargetNames[index]);

if (sourcePrimitives.length !== runtimePrimitives.length) {
  throw new Error(`Primitive count changed: ${sourcePrimitives.length} → ${runtimePrimitives.length}`);
}

function transformPoint(value, matrix, delta) {
  const [x, y, z] = value;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + (delta ? 0 : matrix[12]),
    matrix[1] * x + matrix[5] * y + matrix[9] * z + (delta ? 0 : matrix[13]),
    matrix[2] * x + matrix[6] * y + matrix[10] * z + (delta ? 0 : matrix[14]),
  ];
}

function readLogicalAccessor(accessor, matrix, delta = false) {
  const values = new Array(accessor.getCount());
  const element = [];
  for (let index = 0; index < accessor.getCount(); index += 1) {
    accessor.getElement(index, element);
    values[index] = accessor.getElementSize() === 3
      ? transformPoint(element, matrix, delta)
      : [...element];
  }
  return values;
}

function distanceSquared(first, second) {
  return first.reduce((sum, value, index) => sum + (value - second[index]) ** 2, 0);
}

function positionKey(value, cellSize) {
  return value.map((component) => Math.round(component / cellSize)).join(',');
}

function buildVertexMapping(sourceValues, runtimeValues) {
  if (sourceValues.length !== runtimeValues.length) throw new Error('Vertex count changed.');
  const cellSize = 0.00002;
  const buckets = new Map();
  for (let index = 0; index < runtimeValues.length; index += 1) {
    const key = positionKey(runtimeValues[index], cellSize);
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    buckets.set(key, bucket);
  }

  const mapping = new Int32Array(sourceValues.length).fill(-1);
  const used = new Uint8Array(runtimeValues.length);
  for (let sourceIndex = 0; sourceIndex < sourceValues.length; sourceIndex += 1) {
    const sourceValue = sourceValues[sourceIndex];
    const base = sourceValue.map((component) => Math.round(component / cellSize));
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = buckets.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`) ?? [];
          for (const candidate of bucket) {
            if (used[candidate]) continue;
            const error = distanceSquared(sourceValue, runtimeValues[candidate]);
            if (error < bestDistance) {
              bestDistance = error;
              bestIndex = candidate;
            }
          }
        }
      }
    }
    if (bestIndex < 0) throw new Error(`Could not match vertex ${sourceIndex}; quantization exceeded ${cellSize} m grid.`);
    used[bestIndex] = 1;
    mapping[sourceIndex] = bestIndex;
  }
  return mapping;
}

function maximumMappedError(sourceValues, runtimeValues, mapping) {
  let maximum = 0;
  for (let sourceIndex = 0; sourceIndex < sourceValues.length; sourceIndex += 1) {
    const runtimeIndex = mapping[sourceIndex];
    for (let component = 0; component < sourceValues[sourceIndex].length; component += 1) {
      maximum = Math.max(
        maximum,
        Math.abs(sourceValues[sourceIndex][component] - runtimeValues[runtimeIndex][component]),
      );
    }
  }
  return maximum;
}

const sourceNode = source.getRoot().listNodes().find((node) => node.getMesh() === sourceMesh);
const runtimeNode = runtime.getRoot().listNodes().find((node) => node.getMesh() === runtimeMesh);
if (!sourceNode || !runtimeNode) throw new Error('Could not find mesh nodes.');
const sourceMatrix = sourceNode.getWorldMatrix();
const runtimeMatrix = runtimeNode.getWorldMatrix();
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let maximumPositionError = 0;
let maximumMorphError = 0;
let maximumNormalError = 0;
let morphTargets = 0;
let vertices = 0;
let semanticChannels = null;
let semanticPrimitiveCount = 0;

for (let primitiveIndex = 0; primitiveIndex < sourcePrimitives.length; primitiveIndex += 1) {
  const sourcePrimitive = sourcePrimitives[primitiveIndex];
  const runtimePrimitive = runtimePrimitives[primitiveIndex];
  const sourcePosition = sourcePrimitive.getAttribute('POSITION');
  const runtimePosition = runtimePrimitive.getAttribute('POSITION');
  if (!sourcePosition || !runtimePosition) throw new Error(`Primitive ${primitiveIndex} is missing POSITION.`);
  vertices += sourcePosition.getCount();
  const sourcePositionValues = readLogicalAccessor(sourcePosition, sourceMatrix);
  const runtimePositionValues = readLogicalAccessor(runtimePosition, runtimeMatrix);
  const vertexMapping = buildVertexMapping(sourcePositionValues, runtimePositionValues);
  maximumPositionError = Math.max(
    maximumPositionError,
    maximumMappedError(sourcePositionValues, runtimePositionValues, vertexMapping),
  );

  const sourceSemantics = sourcePrimitive.getAttribute('COLOR_0');
  const runtimeSemantics = runtimePrimitive.getAttribute('COLOR_0');
  if (Boolean(sourceSemantics) !== Boolean(runtimeSemantics)) {
    throw new Error(`Primitive ${primitiveIndex} changed COLOR_0 presence.`);
  }
  if (sourceSemantics && runtimeSemantics) {
    semanticPrimitiveCount += 1;
    if (
      sourceSemantics.getElementSize() !== 4 ||
      runtimeSemantics.getElementSize() !== 4 ||
      sourceSemantics.getCount() !== sourcePosition.getCount() ||
      runtimeSemantics.getCount() !== runtimePosition.getCount()
    ) {
      throw new Error('The skin COLOR_0 semantic contract no longer matches POSITION as VEC4.');
    }
    const sourceValues = new Array(sourceSemantics.getCount());
    const runtimeValues = new Array(runtimeSemantics.getCount());
    const sourceElement = [];
    const runtimeElement = [];
    const channelCounts = [0, 0, 0, 0];
    const combinationCounts = new Map();
    let binary = true;
    let oralLayersMutuallyExclusive = true;
    let perioralExcludesMouthSock = true;
    for (let vertex = 0; vertex < sourceSemantics.getCount(); vertex += 1) {
      sourceSemantics.getElement(vertex, sourceElement);
      runtimeSemantics.getElement(vertex, runtimeElement);
      sourceValues[vertex] = sourceElement.slice(0, 4);
      runtimeValues[vertex] = runtimeElement.slice(0, 4);
      sourceValues[vertex].forEach((value, channel) => {
        if (value !== 0 && value !== 1) binary = false;
        if (value === 1) channelCounts[channel] += 1;
      });
      const oralLayerSum = sourceValues[vertex][0] + sourceValues[vertex][1] + sourceValues[vertex][2];
      if (oralLayerSum > 1) oralLayersMutuallyExclusive = false;
      if (sourceValues[vertex][2] === 1 && sourceValues[vertex][3] === 1) {
        perioralExcludesMouthSock = false;
      }
      const combination = sourceValues[vertex].join(',');
      combinationCounts.set(combination, (combinationCounts.get(combination) ?? 0) + 1);
    }
    const maximumValueError = maximumMappedError(
      sourceValues,
      runtimeValues,
      vertexMapping,
    );
    const expectedChannelCounts = [175, 174, 413, 686];
    const expectedCombinationCounts = {
      '0,0,0,0': 10275,
      '0,0,0,1': 454,
      '0,0,1,0': 413,
      '0,1,0,0': 58,
      '0,1,0,1': 116,
      '1,0,0,0': 59,
      '1,0,0,1': 116,
    };
    const observedCombinationCounts = Object.fromEntries(
      [...combinationCounts.entries()].sort(([first], [second]) => first.localeCompare(second)),
    );
    const combinationHistogramPass =
      Object.keys(observedCombinationCounts).length === Object.keys(expectedCombinationCounts).length &&
      Object.entries(expectedCombinationCounts).every(
        ([combination, expected]) => observedCombinationCounts[combination] === expected,
      );
    semanticChannels = {
      labels: ['upper_lip', 'lower_lip', 'mouth_sock', 'perioral_region'],
      count: sourceSemantics.getCount(),
      sourceComponentType: sourceSemantics.getComponentType(),
      sourceNormalized: sourceSemantics.getNormalized(),
      runtimeComponentType: runtimeSemantics.getComponentType(),
      runtimeNormalized: runtimeSemantics.getNormalized(),
      channelCounts,
      expectedChannelCounts,
      combinationCounts: observedCombinationCounts,
      expectedCombinationCounts,
      binary,
      oralLayersMutuallyExclusive,
      perioralExcludesMouthSock,
      combinationHistogramPass,
      maximumMappedValueError: maximumValueError,
      pass:
        sourceSemantics.getComponentType() === 5126 &&
        sourceSemantics.getNormalized() === false &&
        runtimeSemantics.getComponentType() === 5121 &&
        runtimeSemantics.getNormalized() === true &&
        channelCounts.every((count, index) => count === expectedChannelCounts[index]) &&
        binary &&
        oralLayersMutuallyExclusive &&
        perioralExcludesMouthSock &&
        combinationHistogramPass &&
        maximumValueError === 0,
    };
  }

  const sourceNormal = sourcePrimitive.getAttribute('NORMAL');
  const runtimeNormal = runtimePrimitive.getAttribute('NORMAL');
  if (sourceNormal && runtimeNormal) {
    maximumNormalError = Math.max(
      maximumNormalError,
      maximumMappedError(
        readLogicalAccessor(sourceNormal, identityMatrix, true),
        readLogicalAccessor(runtimeNormal, identityMatrix, true),
        vertexMapping,
      ),
    );
  }

  const sourceTargets = sourcePrimitive.listTargets();
  const runtimeTargets = runtimePrimitive.listTargets();
  if (sourceTargets.length !== runtimeTargets.length) {
    throw new Error(`Primitive ${primitiveIndex} target count changed.`);
  }
  morphTargets += sourceTargets.length;
  for (let targetIndex = 0; targetIndex < sourceTargets.length; targetIndex += 1) {
    const sourceMorph = sourceTargets[targetIndex].getAttribute('POSITION');
    const runtimeMorph = runtimeTargets[targetIndex].getAttribute('POSITION');
    if (!sourceMorph || !runtimeMorph) throw new Error('Morph target is missing POSITION.');
    maximumMorphError = Math.max(
      maximumMorphError,
      maximumMappedError(
        readLogicalAccessor(sourceMorph, sourceMatrix, true),
        readLogicalAccessor(runtimeMorph, runtimeMatrix, true),
        vertexMapping,
      ),
    );
  }
}

const report = {
  sourcePath,
  runtimePath,
  primitives: sourcePrimitives.length,
  vertices,
  morphTargets,
  namedMorphTargets: sourceTargetNames.length,
  targetNamesMatch,
  semanticPrimitiveCount,
  semanticChannels,
  maximumPositionErrorMeters: maximumPositionError,
  maximumMorphDeltaErrorMeters: maximumMorphError,
  maximumNormalComponentError: maximumNormalError,
  positionToleranceMeters: 0.00001,
  morphToleranceMeters: 0.00001,
  pass:
    maximumPositionError <= 0.00001 &&
    maximumMorphError <= 0.00001 &&
    targetNamesMatch &&
    semanticPrimitiveCount === 1 &&
    semanticChannels?.pass === true,
};

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
