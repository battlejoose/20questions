export interface WorkerProgress {
  loadedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
  file: string | null;
  message: string;
}

interface RpcRequest {
  id: number;
  operation: string;
  payload?: unknown;
}

interface RpcResult {
  id: number;
  type: 'result';
  value: unknown;
}

interface RpcFailure {
  id: number;
  type: 'error';
  message: string;
}

interface RpcProgress {
  id: number;
  type: 'progress';
  progress: WorkerProgress;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onProgress?: (progress: WorkerProgress) => void;
}

export class RpcWorkerClient {
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;

  constructor(
    private readonly worker: Worker,
    private readonly label = 'Local model',
  ) {
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.receive(event.data);
    });
    worker.addEventListener('error', (event) => {
      const location = event.filename
        ? ` (${event.filename.split('/').at(-1)}:${event.lineno || '?'})`
        : '';
      const detail = event.error instanceof Error
        ? event.error.message
        : event.message;
      this.rejectAll(new Error(
        detail
          ? `${this.label} worker failed${location}: ${detail}`
          : `${this.label} worker failed during startup${location}.`,
      ));
    });
    worker.addEventListener('messageerror', () => {
      this.rejectAll(new Error(`${this.label} worker returned unreadable data.`));
    });
  }

  request<T>(
    operation: string,
    payload?: unknown,
    transfer: Transferable[] = [],
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    const message: RpcRequest = { id, operation, payload };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        ...(onProgress === undefined ? {} : { onProgress }),
      });
      this.worker.postMessage(message, transfer);
    });
  }

  terminate(reason = 'Local model operation cancelled.'): void {
    this.worker.terminate();
    this.rejectAll(new Error(reason));
  }

  private receive(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const id = Reflect.get(value, 'id');
    const type = Reflect.get(value, 'type');
    if (typeof id !== 'number' || typeof type !== 'string') return;
    const pending = this.pending.get(id);
    if (!pending) return;

    if (type === 'progress') {
      pending.onProgress?.((value as RpcProgress).progress);
      return;
    }
    this.pending.delete(id);
    if (type === 'result') {
      pending.resolve((value as RpcResult).value);
    } else if (type === 'error') {
      pending.reject(new Error((value as RpcFailure).message));
    }
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
