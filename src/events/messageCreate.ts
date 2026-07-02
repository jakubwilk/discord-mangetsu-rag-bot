import { ChannelType, Events, type Message } from 'discord.js';

import * as ragService from '../services/ragService';
import * as streamService from '../services/streamService';
import * as threadService from '../services/threadService';

export const name = Events.MessageCreate;
export const once = false;

const DAILY_LIMIT_MESSAGE = 'Osiągnąłeś dzienny limit zapytań. Spróbuj ponownie jutro.';
const PLACEHOLDER_MESSAGE = 'Generuję odpowiedź...';
const MAX_MESSAGE_LENGTH = 1000;

export async function execute(message: Message): Promise<void> {
  if (message.author.bot) {
    return;
  }

  if (message.channel.type !== ChannelType.PrivateThread) {
    return;
  }

  const session = threadService.getThreadSession(message.channel.id);
  if (!session) {
    return;
  }

  let rateLimit: { requestsUsed: number; dailyLimit: number };
  try {
    rateLimit = await ragService.getRateLimit(message.author.id);
  } catch (error) {
    console.error('[messageCreate] Nie udało się pobrać limitu zapytań', error);
    const errorMessage =
      error instanceof ragService.RagApiError || error instanceof ragService.RagApiUnreachableError
        ? error.message
        : 'Wystąpił nieoczekiwany błąd.';
    await message.channel.send(errorMessage);
    return;
  }

  if (rateLimit.requestsUsed >= rateLimit.dailyLimit) {
    await message.channel.send(DAILY_LIMIT_MESSAGE);
    return;
  }

  const content =
    message.content.length > MAX_MESSAGE_LENGTH
      ? message.content.slice(0, MAX_MESSAGE_LENGTH)
      : message.content;

  const placeholder = await message.channel.send(PLACEHOLDER_MESSAGE);

  const events = ragService.postChat({
    message: content,
    sessionId: session.session_id,
    discordUserId: message.author.id,
  });
  await streamService.consumeStream(events, placeholder, message.channel.id);
}
