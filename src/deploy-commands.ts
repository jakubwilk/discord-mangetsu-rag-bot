import 'dotenv/config';

import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId = process.env.DISCORD_GUILD_ID!;

const commands: object[] = [];

const rest = new REST().setToken(token);

void (async (): Promise<void> => {
  console.log('Rejestrowanie slash commands...');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Gotowe.');
})();
