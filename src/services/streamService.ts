import type { Message } from 'discord.js';

import { type ChatStreamEvent, RagApiError, RagApiUnreachableError } from './ragService';
import { incrementMessageCount } from './threadService';

const EDIT_INTERVAL_MS = 1000;
const IDLE_TIMEOUT_MS = 60000;

const TIMEOUT_MESSAGE = 'Przekroczono czas oczekiwania na odpowiedź.';
const UNREACHABLE_MESSAGE = 'Nie udało się połączyć z API RAG. Spróbuj ponownie później.';
const UNEXPECTED_ERROR_MESSAGE = 'Wystąpił nieoczekiwany błąd.';

async function safeEdit(message: Message, content: string): Promise<void> {
  try {
    await message.edit(content);
  } catch (error) {
    console.error('[streamService] Nie udało się zedytować wiadomości Discord', error);
  }
}

/**
 * Konsumuje strumień zdarzeń SSE (opakowany jako async generator przez ragService.postChat)
 * i edytuje wiadomość Discord co ~1s zbuforowanymi tokenami. Obsługuje zdarzenia `done`/`error`
 * oraz 60-sekundowy timeout bezczynności.
 */
export async function consumeStream(
  events: AsyncGenerator<ChatStreamEvent>,
  message: Message,
  threadId: string
): Promise<void> {
  let sinceLastEditBuffer = '';
  let fullResponse = '';

  const editInterval = setInterval(() => {
    if (sinceLastEditBuffer.length === 0) {
      return;
    }
    sinceLastEditBuffer = '';
    void message.edit(fullResponse).catch((error: unknown) => {
      console.error('[streamService] Nie udało się zedytować wiadomości Discord', error);
    });
  }, EDIT_INTERVAL_MS);

  try {
    for (;;) {
      const nextPromise = events.next();
      // Zapobiega "unhandled promise rejection", jeśli ta obietnica przegra wyścig z timeoutem.
      nextPromise.catch(() => undefined);

      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timeout'), IDLE_TIMEOUT_MS);
      });

      const result = await Promise.race([nextPromise, timeoutPromise]);
      clearTimeout(timeoutHandle);

      if (result === 'timeout') {
        await safeEdit(message, TIMEOUT_MESSAGE);
        void events.return(undefined).catch(() => undefined);
        return;
      }

      if (result.done) {
        return;
      }

      const event = result.value;
      if (event.type === 'token') {
        sinceLastEditBuffer += event.content;
        fullResponse += event.content;
      } else if (event.type === 'done') {
        await safeEdit(message, fullResponse);
        incrementMessageCount(threadId);
        return;
      } else if (event.type === 'error') {
        await safeEdit(message, event.message);
        return;
      }
    }
  } catch (error) {
    if (error instanceof RagApiError) {
      await safeEdit(message, error.message);
    } else if (error instanceof RagApiUnreachableError) {
      await safeEdit(message, UNREACHABLE_MESSAGE);
    } else {
      console.error('[streamService] Nieoczekiwany błąd strumienia', error);
      await safeEdit(message, UNEXPECTED_ERROR_MESSAGE);
    }
  } finally {
    clearInterval(editInterval);
  }
}
