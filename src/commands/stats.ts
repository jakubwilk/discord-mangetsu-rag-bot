import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import * as configService from '../services/configService';
import * as threadService from '../services/threadService';

const NOT_CONFIGURED_MESSAGE =
  'Bot nie jest jeszcze skonfigurowany. Administrator musi wykonać komendę /config.';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Statystyki bota lub wybranego użytkownika')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('Użytkownik, dla którego pokazać statystyki')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!configService.isConfigured()) {
    await interaction.reply({ content: NOT_CONFIGURED_MESSAGE, ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('user');

  if (!targetUser) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Brak uprawnień.', ephemeral: true });
      return;
    }

    const { threadCount, messageCount } = threadService.getGlobalStats();
    await interaction.reply({
      content: [
        'Statystyki bota',
        '───────────────',
        `Łączne wątki: ${threadCount}`,
        `Łączne wiadomości: ${messageCount}`,
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

  const { threadCount, messageCount } = threadService.getUserStats(targetUser.id);
  await interaction.reply({
    content: [
      `Statystyki użytkownika @${targetUser.username}`,
      '─────────────────────────────────',
      `Wątki: ${threadCount}`,
      `Wiadomości: ${messageCount}`,
    ].join('\n'),
    ephemeral: true,
  });
}
