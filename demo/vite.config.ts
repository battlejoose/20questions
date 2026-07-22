import { defineConfig } from 'vite';
import { copyFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeThirdPartyLicenseBundle } from './scripts/write-third-party-license-bundle.mjs';

const staticBuildExcludedPaths = [
  'assets/models/gnm-neutral.glb',
  'assets/models/gnm-neutral.metadata.json',
];

const pruneStaticBuild = {
  name: 'prune-static-build',
  apply: 'build' as const,
  async closeBundle(): Promise<void> {
    await Promise.all([
      copyFile(resolve('..', 'LICENSE'), resolve('dist', 'LICENSE.txt')),
      copyFile(
        resolve('..', 'THIRD_PARTY_NOTICES.md'),
        resolve('dist', 'THIRD_PARTY_NOTICES.md'),
      ),
      writeThirdPartyLicenseBundle(
        resolve('dist', 'THIRD_PARTY_SOFTWARE_LICENSES.txt'),
      ),
    ]);
    await Promise.all(
      staticBuildExcludedPaths.map((path) =>
        rm(resolve('dist', path), { force: true, recursive: true }),
      ),
    );
    // onnxruntime-web emits fallback URL assets even when every runtime is
    // explicitly configured to use the pinned CDN base. Do not make a free
    // static host carry duplicate 25 MB binaries that will never be requested.
    const emittedAssets = await readdir(resolve('dist', 'assets')).catch(() => []);
    await Promise.all(
      emittedAssets
        .filter((name) => name.startsWith('ort-wasm-'))
        .map((name) => rm(resolve('dist', 'assets', name), { force: true })),
    );
  },
};

export default defineConfig({
  plugins: [pruneStaticBuild],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:5190',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
