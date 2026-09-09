export class AudioStoreError extends Error {
  constructor() {
    super('audio storage operation failed');
    this.name = 'AudioStoreError';
  }
}

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export interface CheckedTransfer {
  body: ReadableStream<Uint8Array>;
  done: Promise<boolean>;
}

/** Backpressure bounds buffering to stream queues, not the whole recording. */
export function checkedTransfer(
  source: ReadableStream<Uint8Array>,
  expectedLength: number,
  expiresAt: number,
  now: () => number,
  signal: AbortSignal,
  updateHash?: (chunk: Uint8Array) => void,
): CheckedTransfer {
  let length = 0;
  let controller: TransformStreamDefaultController<Uint8Array>;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(value) { controller = value; },
    transform(chunk, output) {
      if (!(chunk instanceof Uint8Array) || now() >= expiresAt) throw new AudioStoreError();
      length += chunk.byteLength;
      if (length > expectedLength || length > MAX_AUDIO_BYTES) throw new AudioStoreError();
      updateHash?.(chunk);
      output.enqueue(chunk);
    },
    flush() {
      if (length !== expectedLength || now() >= expiresAt) throw new AudioStoreError();
    },
  });
  // preventAbort keeps a raw upstream/source exception out of the returned readable.
  const done = source.pipeTo(transform.writable, { signal, preventAbort: true }).then(
    () => true,
    () => { controller.error(new AudioStoreError()); return false; },
  );
  return { body: transform.readable, done };
}
