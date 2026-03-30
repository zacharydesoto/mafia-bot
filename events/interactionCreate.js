const { Events, MessageFlags } = require('discord.js');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		// Route modal submits to command handlers if present
		if (interaction.isModalSubmit && interaction.isModalSubmit()) {
			const customId = interaction.customId || '';
			if (customId.startsWith('broadcastalive')) {
				const command = interaction.client.commands.get('broadcastalive');
				if (command && 'handleModal' in command) {
					try {
						await command.handleModal(interaction);
					} catch (error) {
						console.error('Error handling modal submit:', error);
						if (interaction.replied || interaction.deferred) {
							await interaction.followUp({ content: 'There was an error while handling the modal submission!', flags: MessageFlags.Ephemeral });
						} else {
							await interaction.reply({ content: 'There was an error while handling the modal submission!', flags: MessageFlags.Ephemeral });
						}
					}
				}
			}
			return;
		}

		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			console.error(error);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({
					content: 'There was an error while executing this command!',
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.reply({
					content: 'There was an error while executing this command!',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
	},
};