import { type ChatInputCommandInteraction, Events, type Interaction } from 'discord.js';

import * as chatCommand from '../commands/chat';
import * as configCommand from '../commands/config';
import * as statsCommand from '../commands/stats';
import * as statusCommand from '../commands/status';

export const name = Events.InteractionCreate;
export const once = false;

const commands = new Map<string, (interaction: ChatInputCommandInteraction) => Promise<void>>([
  [chatCommand.data.name, chatCommand.execute],
  [configCommand.data.name, configCommand.execute],
  [statusCommand.data.name, statusCommand.execute],
  [statsCommand.data.name, statsCommand.execute],
]);

const GENERIC_ERROR_MESSAGE = 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie później.';

export async function execute(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const handler = commands.get(interaction.commandName);
  if (!handler) {
    return;
  }

  try {
    await handler(interaction);
  } catch (error) {
    console.error(
      `[interactionCreate] Błąd podczas obsługi komendy /${interaction.commandName}`,
      error
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(GENERIC_ERROR_MESSAGE);
      } else {
        await interaction.reply({ content: GENERIC_ERROR_MESSAGE, ephemeral: true });
      }
    } catch (replyError) {
      console.error('[interactionCreate] Nie udało się wysłać odpowiedzi o błędzie', replyError);
    }
  }
}
