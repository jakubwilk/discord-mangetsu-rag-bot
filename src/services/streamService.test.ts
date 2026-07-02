import type { Message } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./threadService', () => ({
  incrementMessageCount: vi.fn(),
}));

import type { ChatStreamEvent } from './ragService';
import { RagApiError, RagApiUnreachableError } from './ragService';
import { consumeStream } from './streamService';
import { incrementMessageCount } from './threadService';

/**
 * Async generator that yields events only when explicitly `push()`-ed, letting tests
 * control exactly when the consumer observes a new SSE event (and when it sees none at all,
 * to exercise the idle timeout).
 */
function createControllableGenerator(): {
  gen: AsyncGenerator<ChatStreamEvent>;
  push: (event: ChatStreamEvent) => void;
  throwError: (error: unknown) => void;
} {
  const queue: ChatStreamEvent[] = [];
  let pendingResolve: (() => void) | null = null;
  let pendingError: unknown;
  let hasError = false;

  async function* generator(): AsyncGenerator<ChatStreamEvent> {
    for (;;) {
      if (hasError) {
        throw pendingError;
      }
      if (queue.length > 0) {
        yield queue.shift() as ChatStreamEvent;
        continue;
      }
      await new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }
  }

  return {
    gen: generator(),
    push(event: ChatStreamEvent): void {
      queue.push(event);
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve();
      }
    },
    throwError(error: unknown): void {
      hasError = true;
      pendingError = error;
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve();
      }
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function createMessage(): { message: Message; editMock: ReturnType<typeof vi.fn> } {
  const editMock = vi.fn().mockResolvedValue(undefined);
  const message = { edit: editMock } as unknown as Message;
  return { message, editMock };
}

describe('streamService.consumeStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('only edits the message on ticks where the buffer is non-empty', async () => {
    const { message, editMock } = createMessage();
    const { gen, push } = createControllableGenerator();

    const donePromise = consumeStream(gen, message, 'thread-1');

    push({ type: 'token', content: 'Hello' });
    await flush();

    await vi.advanceTimersByTimeAsync(1000);
    expect(editMock).toHaveBeenCalledTimes(1);
    expect(editMock).toHaveBeenNthCalledWith(1, 'Hello');

    // No new tokens in this window — must not send a needless edit.
    await vi.advanceTimersByTimeAsync(1000);
    expect(editMock).toHaveBeenCalledTimes(1);

    push({ type: 'token', content: ' world' });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(editMock).toHaveBeenCalledTimes(2);
    expect(editMock).toHaveBeenNthCalledWith(2, 'Hello world');

    push({ type: 'done', requestsUsed: 1 });
    await flush();
    await donePromise;
  });

  it('performs a final edit with the full accumulated text on done and increments message count once', async () => {
    const { message, editMock } = createMessage();
    const { gen, push } = createControllableGenerator();

    const donePromise = consumeStream(gen, message, 'thread-1');

    push({ type: 'token', content: 'Hello' });
    await flush();
    push({ type: 'token', content: ' world' });
    await flush();
    push({ type: 'done', requestsUsed: 7 });
    await flush();

    await donePromise;

    expect(editMock).toHaveBeenLastCalledWith('Hello world');
    expect(incrementMessageCount).toHaveBeenCalledTimes(1);
    expect(incrementMessageCount).toHaveBeenCalledWith('thread-1');
  });

  it('stops on an error event and edits the message with the error text', async () => {
    const { message, editMock } = createMessage();
    const { gen, push } = createControllableGenerator();

    const donePromise = consumeStream(gen, message, 'thread-1');

    push({ type: 'token', content: 'partial' });
    await flush();
    push({ type: 'error', message: 'Błąd połączenia z modelem AI: timeout' });
    await flush();

    await donePromise;

    expect(editMock).toHaveBeenLastCalledWith('Błąd połączenia z modelem AI: timeout');
    expect(incrementMessageCount).not.toHaveBeenCalled();

    // Interval must be cleared — advancing time further must not trigger more edits.
    const callsBefore = editMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(editMock.mock.calls.length).toBe(callsBefore);
  });

  it('edits with the timeout message after 60s of silence and returns', async () => {
    const { message, editMock } = createMessage();
    const { gen } = createControllableGenerator();

    const donePromise = consumeStream(gen, message, 'thread-1');

    await vi.advanceTimersByTimeAsync(60000);
    await donePromise;

    expect(editMock).toHaveBeenCalledWith('Przekroczono czas oczekiwania na odpowiedź.');
  });

  it('edits with the RagApiError message when the generator throws before yielding anything', async () => {
    const { message, editMock } = createMessage();
    const { gen, throwError } = createControllableGenerator();

    const donePromise = consumeStream(gen, message, 'thread-1');
    throwError(new RagApiError("Pole 'message' jest wymagane."));
    await flush();

    await donePromise;

    expect(editMock).toHaveBeenCalledWith("Pole 'message' jest wymagane.");
  });

  it('edits with the generic unreachable message when the generator throws RagApiUnreachableError', async () => {
    const { message, editMock } = createMessage();
    const { gen, throwError } = createControllableGenerator();

    const donePromise = consumeStream(gen, message, 'thread-1');
    throwError(
      new RagApiUnreachableError('Nie udało się połączyć z API RAG. Spróbuj ponownie później.')
    );
    await flush();

    await donePromise;

    expect(editMock).toHaveBeenCalledWith(
      'Nie udało się połączyć z API RAG. Spróbuj ponownie później.'
    );
  });
});
