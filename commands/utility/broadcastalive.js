const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');

function sanitizeChannelName(name) {
    return name.replace(/[^a-zA-Z0-9\-]/g, '-').toLowerCase().slice(0, 90);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('broadcastalive')
        .setDescription('Open a text box to paste per-user messages (one block per recipient).'),

    async execute(interaction) {
        // Open a modal with a multiline text input for the bulk payload
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('broadcastalive_modal')
            .setTitle('Broadcast Alive - bulk payload');

        const input = new TextInputBuilder()
            .setCustomId('payload_input')
            .setLabel('Payload (blocks start with @recipient)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('@user\nMessage\n\n@other\nMessage2')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(4000);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);
    },

    // Handle modal submit
    async handleModal(interaction) {
        const payload = interaction.fields.getTextInputValue('payload_input');

        // Parse payload into blocks of {recipientLine, message}
        function parsePayload(text) {
            const lines = text.split(/\r?\n/);
            const blocks = [];
            let current = null;
            for (const raw of lines) {
                const line = raw.replace(/\u00A0/g, ' ').trim();
                if (!line) continue;
                if (line.startsWith('@')) {
                    if (current) blocks.push(current);
                    current = { recipientLine: line, messageLines: [] };
                } else if (current) {
                    current.messageLines.push(raw);
                } else {
                    // ignore lines before first recipient
                }
            }
            if (current) blocks.push(current);
            return blocks.map((b) => ({ recipient: b.recipientLine, message: b.messageLines.join('\n').trim() }));
        }

        const blocks = parsePayload(payload);
        if (!blocks.length) {
                await interaction.reply({ content: 'Could not parse any recipient blocks from the payload. Make sure each block starts with `@username` on its own line.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Find roles
        const adminRole = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'admin');
        const aliveRole = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'alive');

        if (!aliveRole) {
            await interaction.reply({ content: 'No role named "Alive" was found in this server.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (!adminRole) {
            await interaction.reply({ content: 'No role named "Admin" was found in this server. Please make sure an Admin role exists.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Only allow users with Admin role to use this command
        const memberInvoker = interaction.member;
        if (!memberInvoker.roles || !memberInvoker.roles.cache.has(adminRole.id)) {
            await interaction.reply({ content: 'You must have the Admin role to use this command.', flags: MessageFlags.Ephemeral });
            return;
        }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Resolve recipients from the parsed blocks
        const unresolved = [];
        const recipientEntries = []; // { member, message }

        for (const block of blocks) {
            const recip = block.recipient; // like '@name' or '<@id>'
            let member = null;

            // mention form: <@1234> or <@!1234>
            const mentionMatch = recip.match(/<@!?(\d+)>/);
            if (mentionMatch) {
                const id = mentionMatch[1];
                try {
                    member = await interaction.guild.members.fetch(id);
                } catch (e) {
                    // not found
                }
            }

            // plain @name form
            if (!member) {
                const name = recip.replace(/^@/, '').trim();
                const nameLower = name.toLowerCase();
                member = interaction.guild.members.cache.find((m) => {
                    try {
                        return (m.displayName && m.displayName.toLowerCase() === nameLower) || (m.user && m.user.username.toLowerCase() === nameLower);
                    } catch (e) {
                        return false;
                    }
                });
                if (!member) {
                    // try fetch by query (may return array)
                    try {
                        const results = await interaction.guild.members.fetch({ query: name, limit: 1 });
                        if (results && results.size) member = results.first();
                    } catch (e) {
                        // ignore
                    }
                }
            }

            if (!member) {
                unresolved.push(recip);
            } else {
                recipientEntries.push({ member, message: block.message || '' });
            }
        }

        if (unresolved.length) {
            await interaction.editReply({ content: `Could not resolve these recipients: ${unresolved.join(', ')}. Use mentions or exact username/displayName.` });
            return;
        }

        // Ensure we can check Alive coverage by fetching members (requires Server Members intent to be enabled in portal)
        try {
            await interaction.guild.members.fetch();
        } catch (err) {
            await interaction.editReply({ content: 'Unable to fetch guild members to verify Alive coverage. Please enable Server Members Intent in the Developer Portal and try again.' });
            return;
        }

        const aliveMembers = interaction.guild.members.cache.filter((m) => m.roles.cache.has(aliveRole.id) && !m.user.bot);
        const missing = aliveMembers.filter((m) => !recipientEntries.some((r) => r.member.id === m.id));
        if (missing.size > 0) {
            await interaction.editReply({ content: `The following Alive members are missing from the payload: ${missing.map((m) => `${m}`).join(', ')}` });
            return;
        }

        // Safety: warn/limit for very large numbers
        if (aliveMembers.size > 300) {
            await interaction.editReply({ content: `There are ${aliveMembers.size} members with the Alive role — that's a large operation. Please reduce the number or run smaller batches.` });
            return;
        }

        let success = 0;
        let failed = 0;

        for (const entry of recipientEntries) {
            const member = entry.member;
            const personalMessage = entry.message;
            try {
                const rawName = `${member.user.username} Announcements`;
                const channelName = sanitizeChannelName(rawName);

                let channel = interaction.guild.channels.cache.find((c) => c.name === channelName && c.type === ChannelType.GuildText);

                if (channel) {
                    try {
                        await channel.permissionOverwrites.edit(member.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                        });
                    } catch (e) {}
                    try {
                        await channel.permissionOverwrites.edit(adminRole.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                        });
                    } catch (e) {}
                    try {
                        await channel.permissionOverwrites.edit(interaction.client.user.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                        });
                    } catch (e) {}
                } else {
                    channel = await interaction.guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.roles.everyone.id,
                                deny: [PermissionsBitField.Flags.ViewChannel],
                            },
                            {
                                id: member.id,
                                allow: [
                                    PermissionsBitField.Flags.ViewChannel,
                                    PermissionsBitField.Flags.SendMessages,
                                    PermissionsBitField.Flags.ReadMessageHistory,
                                ],
                            },
                            {
                                id: adminRole.id,
                                allow: [
                                    PermissionsBitField.Flags.ViewChannel,
                                    PermissionsBitField.Flags.SendMessages,
                                    PermissionsBitField.Flags.ReadMessageHistory,
                                ],
                            },
                            {
                                id: interaction.client.user.id,
                                allow: [
                                    PermissionsBitField.Flags.ViewChannel,
                                    PermissionsBitField.Flags.SendMessages,
                                    PermissionsBitField.Flags.ReadMessageHistory,
                                ],
                            },
                        ],
                    });
                }

                // Format message: mention once, then the personal message
                const content = `${member}\n\n${personalMessage}`;
                await channel.send({ content });

                success += 1;
            } catch (err) {
                console.error('Failed to deliver to member', member.id, err);
                failed += 1;
            }

            await new Promise((r) => setTimeout(r, 500));
        }

        await interaction.editReply({ content: `Broadcast completed. Delivered to ${success} members, failed for ${failed} members.` });
    },
};
