import { ChannelType, type TextChannel, type ThreadChannel } from 'discord.js';

import { getDb } from './configService';

const THREAD_NAME_MAX_LENGTH = 100;

export interface ThreadSessionRow {
  thread_id: string;
  session_id: string;
  user_id: string;
  created_at: number;
  message_count: number;
}

function buildThreadName(username: string, message: string): string {
  const fullName = `[${username}] ${message}`;
  if (fullName.length <= THREAD_NAME_MAX_LENGTH) {
    return fullName;
  }
  return `${fullName.slice(0, THREAD_NAME_MAX_LENGTH - 1)}…`;
}

export async function createPrivateThread(
  channel: TextChannel,
  username: string,
  message: string
): Promise<ThreadChannel> {
  return channel.threads.create({
    name: buildThreadName(username, message),
    type: ChannelType.PrivateThread,
    autoArchiveDuration: 10080,
    invitable: false,
  });
}

export async function addUserToThread(thread: ThreadChannel, userId: string): Promise<void> {
  await thread.members.add(userId);
}

export function saveThreadSession(threadId: string, sessionId: string, userId: string): void {
  getDb()
    .prepare(
      `INSERT INTO thread_sessions (thread_id, session_id, user_id, created_at, message_count)
       VALUES (?, ?, ?, ?, 0)`
    )
    .run(threadId, sessionId, userId, Date.now());
}

export function getThreadSession(threadId: string): ThreadSessionRow | undefined {
  return getDb().prepare('SELECT * FROM thread_sessions WHERE thread_id = ?').get(threadId) as
    ThreadSessionRow | undefined;
}

export function incrementMessageCount(threadId: string): void {
  getDb()
    .prepare('UPDATE thread_sessions SET message_count = message_count + 1 WHERE thread_id = ?')
    .run(threadId);
}

export function getGlobalStats(): { threadCount: number; messageCount: number } {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS threadCount, COALESCE(SUM(message_count), 0) AS messageCount FROM thread_sessions'
    )
    .get() as { threadCount: number; messageCount: number };
  return row;
}

export function getUserStats(userId: string): { threadCount: number; messageCount: number } {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS threadCount, COALESCE(SUM(message_count), 0) AS messageCount FROM thread_sessions WHERE user_id = ?'
    )
    .get(userId) as { threadCount: number; messageCount: number };
  return row;
}
