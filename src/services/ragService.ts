import type { Readable } from 'node:stream';

import axios from 'axios';

import { getConfigValue } from './configService';

/** Błąd zwrócony przez API RAG jako ustrukturyzowana odpowiedź JSON (np. 400/401/429/500). */
export class RagApiError extends Error {}

/** Brak jakiejkolwiek odpowiedzi HTTP z API RAG (ECONNREFUSED, DNS itp.). */
export class RagApiUnreachableError extends Error {}

export type ChatStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'done'; requestsUsed: number }
  | { type: 'error'; message: string };

const client = axios.create({
  baseURL: process.env.RAG_API_URL,
});

function authHeaders(): Record<string, string> {
  const apiKey = getConfigValue('rag_api_key');
  return apiKey ? { 'X-Api-Key': apiKey } : {};
}

async function readStreamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Wyciąga treść błędu z odpowiedzi JSON (używane dla requestów bez `responseType: 'stream'`). */
function toRagErrorFromJson(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const data = error.response.data as { error?: string } | undefined;
      return new RagApiError(data?.error ?? 'Nieznany błąd API RAG.');
    }
    return new RagApiUnreachableError(
      'Nie udało się połączyć z API RAG. Spróbuj ponownie później.'
    );
  }
  return error instanceof Error ? error : new Error('Nieznany błąd API RAG.');
}

/** Wyciąga treść błędu ze streamowanej odpowiedzi (etap 1 walidacji `POST /api/chat`, `responseType: 'stream'`). */
async function toRagErrorFromStream(error: unknown): Promise<Error> {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      try {
        const body = await readStreamToString(error.response.data as Readable);
        const parsed = JSON.parse(body) as { error?: string };
        return new RagApiError(parsed.error ?? 'Nieznany błąd API RAG.');
      } catch {
        return new RagApiError('Nieznany błąd API RAG.');
      }
    }
    return new RagApiUnreachableError(
      'Nie udało się połączyć z API RAG. Spróbuj ponownie później.'
    );
  }
  return error instanceof Error ? error : new Error('Nieznany błąd API RAG.');
}

export async function getRateLimit(
  userId: string
): Promise<{ requestsUsed: number; dailyLimit: number }> {
  try {
    const response = await client.get<{ requestsUsed: number; dailyLimit: number }>(
      '/api/rate-limit',
      {
        params: { userId },
        headers: authHeaders(),
      }
    );
    return response.data;
  } catch (error) {
    throw toRagErrorFromJson(error);
  }
}

function parseSseFrame(frame: string): ChatStreamEvent | undefined {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) {
    return undefined;
  }
  const payload = dataLine.slice('data:'.length).trim();
  if (!payload) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as ChatStreamEvent;
  } catch {
    return undefined;
  }
}

export async function* postChat(params: {
  message: string;
  sessionId: string;
  discordUserId: string;
}): AsyncGenerator<ChatStreamEvent> {
  let stream: Readable;
  try {
    const response = await client.post<Readable>('/api/chat', params, {
      headers: authHeaders(),
      responseType: 'stream',
    });
    stream = response.data;
  } catch (error) {
    throw await toRagErrorFromStream(error);
  }

  let buffer = '';
  try {
    for await (const chunk of stream) {
      buffer += (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))).toString('utf-8');

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const event = parseSseFrame(frame);
        if (event) {
          yield event;
        }
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
  } finally {
    if (!stream.destroyed) {
      stream.destroy();
    }
  }
}
