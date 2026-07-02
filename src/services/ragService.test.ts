import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();

vi.mock('axios', () => {
  const isAxiosError = (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    (error as { isAxiosError?: boolean }).isAxiosError === true;

  const mockAxios = {
    create: vi.fn(() => ({ post, get })),
    isAxiosError,
  };

  return { default: mockAxios, ...mockAxios };
});

vi.mock('./configService', () => ({
  getConfigValue: vi.fn(),
}));

function makeReadable(chunks: string[]): Readable {
  const stream = new Readable({
    read(): void {
      // no-op — chunks are pushed eagerly below
    },
  });
  for (const chunk of chunks) {
    stream.push(chunk);
  }
  stream.push(null);
  return stream;
}

function makeAxiosError(payload: { response?: { data: unknown } }): unknown {
  return { isAxiosError: true, ...payload };
}

describe('ragService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const configService = await import('./configService');
    vi.mocked(configService.getConfigValue).mockReturnValue('test-api-key');
  });

  describe('getRateLimit', () => {
    it('attaches the X-Api-Key header sourced from configService', async () => {
      const ragService = await import('./ragService');
      get.mockResolvedValueOnce({ data: { requestsUsed: 3, dailyLimit: 20 } });

      const result = await ragService.getRateLimit('user-1');

      expect(result).toEqual({ requestsUsed: 3, dailyLimit: 20 });
      expect(get).toHaveBeenCalledWith(
        '/api/rate-limit',
        expect.objectContaining({
          params: { userId: 'user-1' },
          headers: { 'X-Api-Key': 'test-api-key' },
        })
      );
    });

    it('throws RagApiError with the exact error field text from a JSON error response', async () => {
      const ragService = await import('./ragService');
      get.mockRejectedValueOnce(
        makeAxiosError({
          response: {
            data: { error: 'Przekroczono dzienny limit zapytań. Spróbuj ponownie jutro.' },
          },
        })
      );

      try {
        await ragService.getRateLimit('user-1');
        expect.fail('expected getRateLimit to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ragService.RagApiError);
        expect((error as Error).message).toBe(
          'Przekroczono dzienny limit zapytań. Spróbuj ponownie jutro.'
        );
      }
    });

    it('throws RagApiUnreachableError when there is no HTTP response at all', async () => {
      const ragService = await import('./ragService');
      get.mockRejectedValueOnce(makeAxiosError({}));

      await expect(ragService.getRateLimit('user-1')).rejects.toBeInstanceOf(
        ragService.RagApiUnreachableError
      );
    });
  });

  describe('postChat', () => {
    it('parses SSE frames split across multiple chunk boundaries', async () => {
      const ragService = await import('./ragService');

      const frame1 = 'data: {"type":"token","content":"Hello"}\n\n';
      const frame2 = 'data: {"type":"token","content":" world"}\n\n';
      const frame3 = 'data: {"type":"done","requestsUsed":5}\n\n';

      // Split frame1 mid-way, and frame2's closing \n\n across chunk boundaries.
      const chunks = [
        frame1.slice(0, 15),
        frame1.slice(15),
        frame2.slice(0, -1),
        frame2.slice(-1) + frame3,
      ];

      post.mockResolvedValueOnce({ data: makeReadable(chunks) });

      const events = [];
      for await (const event of ragService.postChat({
        message: 'hi',
        sessionId: 'session-1',
        discordUserId: 'user-1',
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'token', content: 'Hello' },
        { type: 'token', content: ' world' },
        { type: 'done', requestsUsed: 5 },
      ]);
    });

    it('sends the X-Api-Key header on the chat request', async () => {
      const ragService = await import('./ragService');
      post.mockResolvedValueOnce({ data: makeReadable([]) });

      const generator = ragService.postChat({
        message: 'hi',
        sessionId: 'session-1',
        discordUserId: 'user-1',
      });
      await generator.next();

      expect(post).toHaveBeenCalledWith(
        '/api/chat',
        { message: 'hi', sessionId: 'session-1', discordUserId: 'user-1' },
        expect.objectContaining({
          headers: { 'X-Api-Key': 'test-api-key' },
          responseType: 'stream',
        })
      );
    });

    it('throws RagApiError extracted from a stage-1 JSON error body delivered as a stream', async () => {
      const ragService = await import('./ragService');
      post.mockRejectedValueOnce(
        makeAxiosError({
          response: { data: makeReadable(['{"error":"Pole \'message\' jest wymagane."}']) },
        })
      );

      const generator = ragService.postChat({
        message: '',
        sessionId: 'session-1',
        discordUserId: 'user-1',
      });

      try {
        await generator.next();
        expect.fail('expected postChat to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ragService.RagApiError);
        expect((error as Error).message).toBe("Pole 'message' jest wymagane.");
      }
    });

    it('throws RagApiUnreachableError when the network request fails with no response', async () => {
      const ragService = await import('./ragService');
      post.mockRejectedValueOnce(makeAxiosError({}));

      const generator = ragService.postChat({
        message: 'hi',
        sessionId: 'session-1',
        discordUserId: 'user-1',
      });

      await expect(generator.next()).rejects.toBeInstanceOf(ragService.RagApiUnreachableError);
    });
  });
});
