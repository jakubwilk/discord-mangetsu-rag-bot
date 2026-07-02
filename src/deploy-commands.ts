import 'dotenv/config';

import { REST, Routes } from 'discord.js';

import * as chatCommand from './commands/chat';
import * as configCommand from './commands/config';
import * as statsCommand from './commands/stats';
import * as statusCommand from './commands/status';

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId = process.env.DISCORD_GUILD_ID!;

const commands: object[] = [
  chatCommand.data.toJSON(),
  configCommand.data.toJSON(),
  statusCommand.data.toJSON(),
  statsCommand.data.toJSON(),
];

const rest = new REST().setToken(token);

void (async (): Promise<void> => {
  console.log('Rejestrowanie slash commands...');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Gotowe.');
})();
