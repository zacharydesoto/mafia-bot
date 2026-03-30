const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log('Fetching global application commands...');
    const global = await rest.get(Routes.applicationCommands(clientId));
    const globalToDelete = global.filter((c) => c.name === 'broadcastalive');
    for (const cmd of globalToDelete) {
      console.log(`Deleting global command ${cmd.name} (${cmd.id})`);
      await rest.delete(Routes.applicationCommand(clientId, cmd.id));
    }

    console.log('Fetching guild application commands...');
    const guildCommands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
    const guildToDelete = guildCommands.filter((c) => c.name === 'broadcastalive');
    for (const cmd of guildToDelete) {
      console.log(`Deleting guild command ${cmd.name} (${cmd.id})`);
      await rest.delete(Routes.applicationGuildCommand(clientId, guildId, cmd.id));
    }

    if (globalToDelete.length === 0 && guildToDelete.length === 0) {
      console.log('No broadcastalive commands found to delete.');
    } else {
      console.log('Deletion complete. It may take a short while for Discord clients to update.');
    }
  } catch (err) {
    console.error('Failed to remove commands:', err);
    process.exitCode = 1;
  }
})();
