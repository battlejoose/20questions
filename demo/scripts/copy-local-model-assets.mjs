import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function copyFiles(sourceDirectory, targetDirectory, files) {
  mkdirSync(targetDirectory, { recursive: true });
  for (const file of files) {
    cpSync(join(sourceDirectory, file), join(targetDirectory, file));
  }
}

const vadDirectory = dirname(require.resolve('@ricky0123/vad-web'));
copyFiles(vadDirectory, join(projectRoot, 'public', 'local-models', 'vad'), [
  'silero_vad_v5.onnx',
  'vad.worklet.bundle.min.js',
]);

console.log('Copied the same-origin Silero VAD assets.');
