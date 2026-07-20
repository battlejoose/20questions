/**
 * Version-pinned browser runtimes live on a CORS-enabled CDN so a free static
 * host only serves the application, not 100+ MB of duplicated WASM binaries.
 * Model inference and user data remain entirely in the browser.
 */
export const ONNX_WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0-dev.20260212-1a71a5f46e/dist/';

export const LITERT_LM_WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@litert-lm/core@0.14.0/wasm/';
