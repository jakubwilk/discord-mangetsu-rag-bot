import {
  ChannelType,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import * as configService from '../services/configService';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Skonfiguruj bota')
  .addStringOption((option) =>
    option.setName('api_key').setDescription('Klucz do API RAG').setRequired(true)
  )
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Kanał gdzie bot przyjmuje /chat')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Brak uprawnień.', ephemeral: true });
    return;
  }

  const apiKey = interaction.options.getString('api_key', true);
  const channel = interaction.options.getChannel('channel', true);

  configService.setConfigValue('rag_api_key', apiKey);
  configService.setConfigValue('allowed_channel_id', channel.id);

  await interaction.reply({
    content: 'Konfiguracja zapisana. Bot gotowy do użycia.',
    ephemeral: true,
  });
}
