import 'dotenv/config';

import { Client, GatewayIntentBits } from 'discord.js';

import * as interactionCreateEvent from './events/interactionCreate';
import * as messageCreateEvent from './events/messageCreate';
import * as readyEvent from './events/ready';
import * as configService from './services/configService';

configService.validateEnv();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(readyEvent.name, (c) => {
  readyEvent.execute(c);
});

client.on(interactionCreateEvent.name, (interaction) => {
  void interactionCreateEvent.execute(interaction);
});

client.on(messageCreateEvent.name, (message) => {
  void messageCreateEvent.execute(message);
});

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Brak DISCORD_TOKEN w zmiennych środowiskowych');

void client.login(token);
