import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('threadService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BOT_DB_PATH = ':memory:';
  });

  it('saves and retrieves a thread session', async () => {
    const threadService = await import('./threadService');
    threadService.saveThreadSession('thread-1', 'session-1', 'user-1');

    const session = threadService.getThreadSession('thread-1');
    expect(session).toBeDefined();
    expect(session?.thread_id).toBe('thread-1');
    expect(session?.session_id).toBe('session-1');
    expect(session?.user_id).toBe('user-1');
    expect(session?.message_count).toBe(0);
    expect(typeof session?.created_at).toBe('number');
  });

  it('returns undefined for an unknown thread', async () => {
    const threadService = await import('./threadService');
    expect(threadService.getThreadSession('unknown')).toBeUndefined();
  });

  it('increments message_count', async () => {
    const threadService = await import('./threadService');
    threadService.saveThreadSession('thread-1', 'session-1', 'user-1');

    threadService.incrementMessageCount('thread-1');
    threadService.incrementMessageCount('thread-1');

    expect(threadService.getThreadSession('thread-1')?.message_count).toBe(2);
  });

  it('computes global stats across all threads', async () => {
    const threadService = await import('./threadService');
    threadService.saveThreadSession('thread-1', 'session-1', 'user-1');
    threadService.saveThreadSession('thread-2', 'session-2', 'user-2');
    threadService.incrementMessageCount('thread-1');
    threadService.incrementMessageCount('thread-1');
    threadService.incrementMessageCount('thread-2');

    expect(threadService.getGlobalStats()).toEqual({ threadCount: 2, messageCount: 3 });
  });

  it('returns zeroed global stats when there are no threads', async () => {
    const threadService = await import('./threadService');
    expect(threadService.getGlobalStats()).toEqual({ threadCount: 0, messageCount: 0 });
  });

  it('computes per-user stats', async () => {
    const threadService = await import('./threadService');
    threadService.saveThreadSession('thread-1', 'session-1', 'user-1');
    threadService.saveThreadSession('thread-2', 'session-2', 'user-1');
    threadService.saveThreadSession('thread-3', 'session-3', 'user-2');
    threadService.incrementMessageCount('thread-1');
    threadService.incrementMessageCount('thread-2');
    threadService.incrementMessageCount('thread-3');
    threadService.incrementMessageCount('thread-3');

    expect(threadService.getUserStats('user-1')).toEqual({ threadCount: 2, messageCount: 2 });
    expect(threadService.getUserStats('user-2')).toEqual({ threadCount: 1, messageCount: 2 });
    expect(threadService.getUserStats('user-3')).toEqual({ threadCount: 0, messageCount: 0 });
  });

  it('createPrivateThread passes the exact expected options and truncates long names', async () => {
    const threadService = await import('./threadService');
    const create = vi.fn().mockResolvedValue({ id: 'new-thread' });
    const channel = { threads: { create } } as unknown as Parameters<
      typeof threadService.createPrivateThread
    >[0];

    await threadService.createPrivateThread(channel, 'alice', 'short question');

    expect(create).toHaveBeenCalledWith({
      name: '[alice] short question',
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 10080,
      invitable: false,
    });
  });

  it('truncates the thread name to exactly 100 characters with a trailing ellipsis', async () => {
    const threadService = await import('./threadService');
    const create = vi.fn().mockResolvedValue({ id: 'new-thread' });
    const channel = { threads: { create } } as unknown as Parameters<
      typeof threadService.createPrivateThread
    >[0];

    const longMessage = 'a'.repeat(200);
    await threadService.createPrivateThread(channel, 'alice', longMessage);

    const call = create.mock.calls[0][0] as { name: string };
    expect(call.name.length).toBe(100);
    expect(call.name.endsWith('…')).toBe(true);
    expect(call.name.startsWith('[alice] ')).toBe(true);
  });

  it('addUserToThread calls thread.members.add with the user id', async () => {
    const threadService = await import('./threadService');
    const add = vi.fn().mockResolvedValue(undefined);
    const thread = { members: { add } } as unknown as Parameters<
      typeof threadService.addUserToThread
    >[0];

    await threadService.addUserToThread(thread, 'user-42');

    expect(add).toHaveBeenCalledWith('user-42');
  });
});
