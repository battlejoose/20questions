export class LocalAgentAbortError extends Error {
  constructor(message = 'The local voice-agent operation was aborted.') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof LocalAgentAbortError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new LocalAgentAbortError();
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
