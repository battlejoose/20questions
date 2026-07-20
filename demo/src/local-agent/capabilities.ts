import type {
  LocalModelBackendProfile,
  LocalModelCapability,
  LocalModelDescriptor,
  LocalModelId,
} from './modelRegistry';

interface FeatureSetLike {
  has(feature: string): boolean;
}

interface GpuAdapterLike {
  features?: FeatureSetLike;
}

interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

interface StorageManagerLike {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  persisted?: () => Promise<boolean>;
  getDirectory?: () => Promise<unknown>;
}

interface NavigatorLike {
  gpu?: GpuLike;
  storage?: StorageManagerLike;
}

interface CacheStorageLike {
  open(name: string): Promise<unknown>;
}

interface IndexedDbLike {
  open(name: string): unknown;
}

interface WebAssemblyLike {
  validate(bytes: Uint8Array): boolean;
}

export interface BrowserCapabilityEnvironment {
  navigator?: NavigatorLike;
  caches?: CacheStorageLike;
  indexedDB?: IndexedDbLike;
  WebAssembly?: WebAssemblyLike;
  SharedArrayBuffer?: unknown;
  Atomics?: unknown;
  isSecureContext?: boolean;
  crossOriginIsolated?: boolean;
}

export interface BrowserCapabilitySnapshot {
  checkedAtEpochMs: number;
  secureContext: boolean;
  crossOriginIsolated: boolean;
  webgpu: {
    apiAvailable: boolean;
    adapterAvailable: boolean;
    shaderF16: boolean;
    error?: string;
  };
  wasm: {
    available: boolean;
    simd: boolean;
    threads: boolean;
  };
  storage: {
    cacheStorage: boolean;
    indexedDb: boolean;
    opfs: boolean;
    persisted: boolean | null;
    quotaBytes: number | null;
    usageBytes: number | null;
    error?: string;
  };
}

export interface BackendSupportResult {
  backend: LocalModelBackendProfile;
  supported: boolean;
  missingCapabilities: readonly LocalModelCapability[];
}

export interface ModelCompatibilitySnapshot {
  modelId: LocalModelId;
  supported: boolean;
  backends: readonly BackendSupportResult[];
  blockers: readonly string[];
  warnings: readonly string[];
}

// A minimal valid module containing i8x16.splat. `validate` is side-effect free.
const WASM_SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x1a, 0x0b,
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function detectBrowserCapabilities(
  environment: BrowserCapabilityEnvironment = globalThis as BrowserCapabilityEnvironment,
  now: () => number = Date.now,
): Promise<BrowserCapabilitySnapshot> {
  const navigatorLike = environment.navigator;
  const webgpu = {
    apiAvailable: typeof navigatorLike?.gpu?.requestAdapter === 'function',
    adapterAvailable: false,
    shaderF16: false,
  } as BrowserCapabilitySnapshot['webgpu'];

  if (webgpu.apiAvailable) {
    try {
      const adapter = await navigatorLike?.gpu?.requestAdapter();
      webgpu.adapterAvailable = adapter != null;
      webgpu.shaderF16 = adapter?.features?.has('shader-f16') === true;
    } catch (error) {
      webgpu.error = errorMessage(error);
    }
  }

  const wasmAvailable = typeof environment.WebAssembly?.validate === 'function';
  let wasmSimd = false;
  if (wasmAvailable) {
    try {
      wasmSimd = environment.WebAssembly?.validate(WASM_SIMD_PROBE) === true;
    } catch {
      wasmSimd = false;
    }
  }

  const storage = {
    cacheStorage: typeof environment.caches?.open === 'function',
    indexedDb: typeof environment.indexedDB?.open === 'function',
    opfs: typeof navigatorLike?.storage?.getDirectory === 'function',
    persisted: null,
    quotaBytes: null,
    usageBytes: null,
  } as BrowserCapabilitySnapshot['storage'];

  try {
    const estimate = await navigatorLike?.storage?.estimate?.();
    storage.quotaBytes = finiteNumber(estimate?.quota);
    storage.usageBytes = finiteNumber(estimate?.usage);
    if (typeof navigatorLike?.storage?.persisted === 'function') {
      storage.persisted = await navigatorLike.storage.persisted();
    }
  } catch (error) {
    storage.error = errorMessage(error);
  }

  return {
    checkedAtEpochMs: now(),
    secureContext: environment.isSecureContext === true,
    crossOriginIsolated: environment.crossOriginIsolated === true,
    webgpu,
    wasm: {
      available: wasmAvailable,
      simd: wasmSimd,
      threads:
        wasmAvailable &&
        environment.crossOriginIsolated === true &&
        typeof environment.SharedArrayBuffer === 'function' &&
        typeof environment.Atomics === 'object',
    },
    storage,
  };
}

function hasCapability(
  capability: LocalModelCapability,
  snapshot: BrowserCapabilitySnapshot,
): boolean {
  switch (capability) {
    case 'wasm':
      return snapshot.wasm.available;
    case 'webgpu':
      return snapshot.webgpu.adapterAvailable;
    case 'shader-f16':
      return snapshot.webgpu.shaderF16;
  }
}

export function evaluateBackendSupport(
  backend: LocalModelBackendProfile,
  capabilities: BrowserCapabilitySnapshot,
): BackendSupportResult {
  const missingCapabilities = backend.requiredCapabilities.filter(
    (capability) => !hasCapability(capability, capabilities),
  );
  return {
    backend,
    supported: missingCapabilities.length === 0,
    missingCapabilities,
  };
}

export function evaluateModelCompatibility(
  model: LocalModelDescriptor,
  capabilities: BrowserCapabilitySnapshot,
): ModelCompatibilitySnapshot {
  const backends = model.backends.map((backend) =>
    evaluateBackendSupport(backend, capabilities),
  );
  const supported = backends.some((backend) => backend.supported);
  const missing = new Set(
    backends.flatMap((backend) => backend.missingCapabilities),
  );
  const blockers = supported
    ? []
    : [...missing].map((capability) => `Missing browser capability: ${capability}`);
  const warnings: string[] = [];

  if (!capabilities.storage.cacheStorage && !capabilities.storage.opfs) {
    warnings.push('No Cache Storage or OPFS is available; model persistence is unavailable.');
  }
  if (model.policy.warning !== undefined) {
    warnings.push(model.policy.warning);
  }

  return {
    modelId: model.id,
    supported,
    backends,
    blockers,
    warnings,
  };
}
