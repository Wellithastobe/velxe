require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('products')
        .setDescription('View available products catalog'),
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Roblox account with Discord using bio verification'),
    new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Roblox account from Discord'),
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View user profile and purchases')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to view profile for (optional)')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give a product to a user (Admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to give the product to')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('retrieve')
        .setDescription('View and retrieve your purchased licenses'),
    new SlashCommandBuilder()
        .setName('mod')
        .setDescription('Moderator panel for license management')
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('View all licenses'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('Search licenses by Discord ID')
                .addStringOption(option =>
                    option.setName('discord_id')
                        .setDescription('Discord user ID to search for')
                        .setRequired(true))),
    new SlashCommandBuilder()
        .setName('hostgiveaway')
        .setDescription('Host a giveaway for a product (Admin only)')
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Giveaway duration (e.g., 10s, 5m, 1h, 2d)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('product')
                .setDescription('Product to giveaway')
                .setRequired(true)
                .addChoices(
                    { name: 'Cleaning System Basic', value: 'Cleaning System Basic' },
                    { name: 'DoorAuto V1', value: 'DoorAuto V1' },
                    { name: '📦Hover outline 📦', value: '📦Hover outline 📦' }
                ))
        .addIntegerOption(option =>
            option.setName('winners')
                .setDescription('Number of winners (default: 1)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10))
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();







