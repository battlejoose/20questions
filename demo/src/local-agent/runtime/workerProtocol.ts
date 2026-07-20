import type { WorkerProgress } from './RpcWorkerClient';

export interface RpcWorkerRequest {
  id: number;
  operation: string;
  payload?: unknown;
}

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function postWorkerResult(
  id: number,
  value: unknown,
  transfer: Transferable[] = [],
): void {
  scope.postMessage({ id, type: 'result', value }, transfer);
}

export function postWorkerError(id: number, error: unknown): void {
  scope.postMessage({ id, type: 'error', message: errorMessage(error) });
}

export function postWorkerProgress(id: number, progress: WorkerProgress): void {
  scope.postMessage({ id, type: 'progress', progress });
}

export function normalizeDownloadProgress(value: unknown): WorkerProgress {
  const object = value && typeof value === 'object' ? value : {};
  const loadedValue = Reflect.get(object, 'loaded');
  const totalValue = Reflect.get(object, 'total');
  const progressValue = Reflect.get(object, 'progress');
  const fileValue = Reflect.get(object, 'file');
  const statusValue = Reflect.get(object, 'status');
  const loadedBytes = typeof loadedValue === 'number' && Number.isFinite(loadedValue)
    ? Math.max(0, loadedValue)
    : 0;
  const totalBytes = typeof totalValue === 'number' && Number.isFinite(totalValue)
    ? Math.max(0, totalValue)
    : null;
  const reportedFraction = typeof progressValue === 'number' && Number.isFinite(progressValue)
    ? Math.max(0, Math.min(1, progressValue > 1 ? progressValue / 100 : progressValue))
    : null;
  const fraction = totalBytes !== null && totalBytes > 0
    ? Math.min(1, loadedBytes / totalBytes)
    : reportedFraction;
  const status = typeof statusValue === 'string' ? statusValue : 'preparing';
  const file = typeof fileValue === 'string' ? fileValue : null;
  return {
    loadedBytes,
    totalBytes,
    fraction,
    file,
    message: file ? `${status} · ${file}` : status,
  };
}
