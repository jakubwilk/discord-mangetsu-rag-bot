import { Client, Events } from 'discord.js';

export const name = Events.ClientReady;
export const once = true;

export function execute(client: Client<true>): void {
  console.log(`[ready] Zalogowano jako ${client.user.tag}`);
}
