const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory you created earlier
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
	// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			commands.push(command.data.toJSON());
			console.log(`Loaded command: ${command.data.name}`);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// The put method is used to fully refresh all commands in the guild with the current set
		// Using guild commands makes them appear instantly for testing. Switch to global when
		// you're ready for a wider rollout (note: global commands can take up to an hour to propagate).

		console.log('Sending registration request to Discord...');

		// Add a timeout so the request doesn't hang indefinitely
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000); // 15s
		let data;
		try {
			data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands, signal: controller.signal });
		} catch (err) {
			if (err.name === 'AbortError') {
				throw new Error('Request to Discord timed out (15s) — possible network issue or Discord API problem.');
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error('Failed to register commands:', error);
	}
})();