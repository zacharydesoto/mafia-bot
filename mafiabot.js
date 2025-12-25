import {REST, routes} from 'discord.js';

const commands = [
    {
        name: 'mafia',
        description: 'Join the mafia game'
    },
];

const rest = new REST({version: '10'}).setToken(process.env.DISCORD_BOT_TOKEN);

