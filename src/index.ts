import 'dotenv/config';

import { Client, GatewayIntentBits } from 'discord.js';

import * as readyEvent from './events/ready';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(readyEvent.name, (c) => {
  readyEvent.execute(c);
});

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Brak DISCORD_TOKEN w zmiennych środowiskowych');

void client.login(token);
