import crypto from 'node:crypto';

import { ChannelType, type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

import * as configService from '../services/configService';
import * as ragService from '../services/ragService';
import * as streamService from '../services/streamService';
import * as threadService from '../services/threadService';

const NOT_CONFIGURED_MESSAGE =
  'Bot nie jest jeszcze skonfigurowany. Administrator musi wykonać komendę /config.';
const DAILY_LIMIT_MESSAGE = 'Osiągnąłeś dzienny limit zapytań. Spróbuj ponownie jutro.';
const THREAD_PERMISSION_ERROR_MESSAGE =
  'Brak uprawnień do utworzenia wątku. Skontaktuj się z administratorem serwera.';
const PLACEHOLDER_MESSAGE = 'Generuję odpowiedź...';

export const data = new SlashCommandBuilder()
  .setName('chat')
  .setDescription('Rozpocznij rozmowę z asystentem')
  .addStringOption((option) =>
    option.setName('message').setDescription('Twoje pytanie do asystenta').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!configService.isConfigured()) {
    await interaction.editReply(NOT_CONFIGURED_MESSAGE);
    return;
  }

  const allowedChannelId = configService.getConfigValue('allowed_channel_id');
  if (interaction.channelId !== allowedChannelId) {
    const channelMention = allowedChannelId ? `<#${allowedChannelId}>` : 'skonfigurowanym kanale';
    await interaction.editReply(`Ta komenda działa tylko na kanale ${channelMention}.`);
    return;
  }

  const message = interaction.options.getString('message', true);

  let rateLimit: { requestsUsed: number; dailyLimit: number };
  try {
    rateLimit = await ragService.getRateLimit(interaction.user.id);
  } catch (error) {
    await interaction.editReply(errorToUserMessage(error));
    return;
  }

  if (rateLimit.requestsUsed >= rateLimit.dailyLimit) {
    await interaction.editReply(DAILY_LIMIT_MESSAGE);
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.editReply(THREAD_PERMISSION_ERROR_MESSAGE);
    return;
  }

  let thread;
  try {
    thread = await threadService.createPrivateThread(channel, interaction.user.username, message);
    await threadService.addUserToThread(thread, interaction.user.id);
  } catch (error) {
    console.error('[chat] Nie udało się utworzyć wątku lub dodać użytkownika', error);
    await interaction.editReply(THREAD_PERMISSION_ERROR_MESSAGE);
    return;
  }

  const sessionId = crypto.randomUUID();
  threadService.saveThreadSession(thread.id, sessionId, interaction.user.id);

  const placeholder = await thread.send(PLACEHOLDER_MESSAGE);

  const events = ragService.postChat({
    message,
    sessionId,
    discordUserId: interaction.user.id,
  });
  await streamService.consumeStream(events, placeholder, thread.id);

  await interaction.editReply(`Otwarto wątek: <#${thread.id}>`);
}

function errorToUserMessage(error: unknown): string {
  if (error instanceof ragService.RagApiError) {
    return error.message;
  }
  if (error instanceof ragService.RagApiUnreachableError) {
    return error.message;
  }
  console.error('[chat] Nieoczekiwany błąd', error);
  return 'Wystąpił nieoczekiwany błąd.';
}
