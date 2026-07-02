import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import * as configService from '../services/configService';
import * as ragService from '../services/ragService';

const NOT_CONFIGURED_MESSAGE =
  'Bot nie jest jeszcze skonfigurowany. Administrator musi wykonać komendę /config.';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Sprawdź status API RAG');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Brak uprawnień.', ephemeral: true });
    return;
  }

  if (!configService.isConfigured()) {
    await interaction.reply({ content: NOT_CONFIGURED_MESSAGE, ephemeral: true });
    return;
  }

  const start = Date.now();
  try {
    await ragService.getRateLimit('healthcheck');
    const elapsedMs = Date.now() - start;

    const allowedChannelId = configService.getConfigValue('allowed_channel_id');
    const channelMention = allowedChannelId ? `<#${allowedChannelId}>` : 'nieznany';

    await interaction.reply({
      content: `API RAG: ✓ online (${elapsedMs}ms)\nKanał: ${channelMention}`,
      ephemeral: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd';
    await interaction.reply({
      content: `API RAG: ✗ niedostępne\nBłąd: ${message}`,
      ephemeral: true,
    });
  }
}
