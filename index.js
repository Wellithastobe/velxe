require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Add error handling for the client
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Initialize database
const db = new sqlite3.Database('purchases.db');
db.run(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    roblox_id TEXT,
    roblox_username TEXT,
    product_name TEXT,
    purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Add linked accounts table
db.run(`CREATE TABLE IF NOT EXISTS linked_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    roblox_id TEXT,
    roblox_username TEXT,
    verification_code TEXT,
    verified BOOLEAN DEFAULT FALSE,
    link_date DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const products = {
    1: {
        name: "Cleaning System Basic",
        info: "Features:\n• Lightweight and efficient\n• Easy to implement\n• Customizable settings\n• Performance optimized",
        description: "The Cleaning System Lite is designed to help maintain your Roblox game environment with minimal performance impact. Perfect for developers who need a reliable cleaning solution without the complexity.",
        buyable: false,
        gamepassId: null,
        status: "development", // development, preorder, available
        downloadUrl: null
    },
    2: {
        name: "DoorAuto V1",
        info: "Features:\n• Simple auto door system\n• Control panels included\n• Button controls\n• Best on the market",
        description: "A premium automatic door system with advanced control panels and intuitive button controls. The most reliable door automation solution available.",
        buyable: true,
        gamepassId: "1345470752",
        status: "preorder", // development, preorder, available
        downloadUrl: null
    },
    3: {
        name: "📦Hover outline 📦",
        info: "Features:\n• Fast to setup\n• Support included\n• Few clicks done\n• Looks like paid asset",
        description: "Hoveroutline is a fast to setup product, Its free aswell! Get your storage ready for more fantastic products like this! Look below for the perks of this product.",
        buyable: true,
        gamepassId: null,
        status: "available",
        downloadUrl: "https://velxe.com/HoverOutline.rbxm",
        isFree: true,
        fileName: "HoverOutline VELXE FREE.rbxm"
    }
};

const AUTHORIZED_MODS = ['898896312660025375', '1093138840660742249'];

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} is online!`);
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'products') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                
                // Check if user has linked account
                db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [interaction.user.id], async (dbErr, linkedAccount) => {
                    if (dbErr || !linkedAccount) {
                        const linkEmbed = new EmbedBuilder()
                            .setTitle('🔗 Account Not Linked')
                            .setDescription('You need to link your Roblox account before purchasing products.\n\nUse `/link` to link your account.')
                            .setColor(0xff6b6b);

                        await interaction.editReply({ embeds: [linkEmbed] });
                        return;
                    }

                    // Show products
                    const embed = createProductEmbed(1);
                    const buttons = createNavigationButtons(1, interaction.user.id);
                    await interaction.editReply({ embeds: [embed], components: [buttons] });
                });
            } else if (interaction.commandName === 'link') {
                await handleLinkCommand(interaction);
            } else if (interaction.commandName === 'unlink') {
                await handleUnlinkCommand(interaction);
            } else if (interaction.commandName === 'profile') {
                const targetUser = interaction.options.getUser('user') || interaction.user;
                await handleProfileCommand(interaction, targetUser);
            } else if (interaction.commandName === 'give') {
                await handleGiveCommand(interaction);
            } else if (interaction.commandName === 'retrieve') {
                await handleRetrieveCommand(interaction);
            } else if (interaction.commandName === 'mod') {
                // Check if user is authorized
                if (!AUTHORIZED_MODS.includes(interaction.user.id)) {
                    await interaction.reply({ 
                        content: '❌ You are not authorized to use this command.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                if (interaction.options.getSubcommand() === 'panel') {
                    await showLicensePanel(interaction);
                } else if (interaction.options.getSubcommand() === 'search') {
                    const discordId = interaction.options.getString('discord_id');
                    await searchUserLicenses(interaction, discordId);
                }
            } else if (interaction.commandName === 'hostgiveaway') {
                // Check if user is authorized mod
                if (!AUTHORIZED_MODS.includes(interaction.user.id)) {
                    await interaction.reply({ 
                        content: '❌ You are not authorized to use this command.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                const duration = interaction.options.getString('duration');
                const productName = interaction.options.getString('product');
                const winners = interaction.options.getInteger('winners') || 1;

                // Parse duration
                const durationMs = parseDuration(duration);
                if (!durationMs) {
                    await interaction.reply({
                        content: '❌ Invalid duration format. Use formats like: 10s, 5m, 1h, 2d',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                await startGiveaway(interaction, productName, durationMs, winners);
            }
        } else if (interaction.isButton()) {
            // Handle bio verification button FIRST
            if (interaction.customId.startsWith('verify_bio_')) {
                const userId = interaction.customId.split('_')[2];
                
                if (userId !== interaction.user.id) {
                    await interaction.reply({ 
                        content: '❌ You cannot use this button.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                // Get verification data
                db.get(`SELECT * FROM linked_accounts WHERE discord_id = ?`, [interaction.user.id], async (dbErr, linkData) => {
                    if (dbErr || !linkData) {
                        await interaction.editReply({ 
                            content: '❌ No verification data found. Please try linking again with `/link`.'
                        });
                        return;
                    }

                    try {
                        const bioValid = await checkRobloxBio(linkData.roblox_id, linkData.verification_code);

                        if (bioValid) {
                            // Mark as verified
                            db.run(`UPDATE linked_accounts SET verified = TRUE WHERE discord_id = ?`, [interaction.user.id]);

                            const successEmbed = new EmbedBuilder()
                                .setTitle('✅ Account Linked Successfully!')
                                .setDescription(`Your Discord is now linked to **${linkData.roblox_username}** (${linkData.roblox_id})`)
                                .addFields({
                                    name: '🎉 What\'s Next?',
                                    value: '• You can now purchase products!\n• Feel free to remove the code from your bio\n• Use `/products` to browse available items',
                                    inline: false
                                })
                                .setColor(0x00ff00)
                                .setFooter({ text: 'Velxe License System' })
                                .setTimestamp();

                            await interaction.editReply({ 
                                content: null,
                                embeds: [successEmbed]
                            });
                        } else {
                            const failEmbed = new EmbedBuilder()
                                .setTitle('❌ Bio Verification Failed')
                                .setDescription('Could not find the verification code in your bio.')
                                .addFields({
                                    name: '🔍 Make sure you added:',
                                    value: `\`${linkData.verification_code}\``,
                                    inline: false
                                }, {
                                    name: '📝 Next Steps:',
                                    value: '• Update your Roblox bio with the code above\n• Try verification again once updated',
                                    inline: false
                                })
                                .setColor(0xff6b6b)
                                .setFooter({ text: 'Velxe License System' })
                                .setTimestamp();

                            await interaction.editReply({ 
                                content: null,
                                embeds: [failEmbed]
                            });
                        }
                    } catch (error) {
                        console.error('Error in bio verification:', error);
                        await interaction.editReply({ 
                            content: '❌ Error checking bio. Please try again.'
                        });
                    }
                });
                return;
            }

            // Handle retrieve file buttons
            if (interaction.customId.startsWith('retrieve_file_')) {
                const licenseId = interaction.customId.split('_')[2];
                const userId = interaction.customId.split('_')[3];
                
                if (userId !== interaction.user.id) {
                    await interaction.reply({ 
                        content: '❌ You cannot use this button.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                // Get license details
                db.get(`SELECT * FROM purchases WHERE id = ? AND discord_id = ?`, [licenseId, interaction.user.id], async (dbErr, license) => {
                    if (dbErr || !license) {
                        await interaction.editReply({ 
                            content: '❌ License not found or access denied.'
                        });
                        return;
                    }

                    // Find the product to check its status
                    const product = Object.values(products).find(p => p.name === license.product_name);
                    
                    if (!product) {
                        await interaction.editReply({ 
                            content: '❌ Product information not found.'
                        });
                        return;
                    }

                    let fileEmbed;

                    if (product.status === "development") {
                        fileEmbed = new EmbedBuilder()
                            .setTitle('🚧 Product In Development')
                            .setDescription(`**Product:** ${license.product_name}\n**License ID:** ${license.id}\n**Status:** In Development\n\n**Information:**\nThis product is currently being developed. You will be notified when it's ready for download.\n\n**What happens next:**\n• You'll receive a DM when the product is released\n• Your license will remain valid\n• No additional payment required`)
                            .setColor(0xffa500)
                            .setFooter({ text: 'Velxe License System • Thank you for your patience' })
                            .setTimestamp();
                    } else if (product.status === "preorder") {
                        fileEmbed = new EmbedBuilder()
                            .setTitle('📦 Preorder Product')
                            .setDescription(`**Product:** ${license.product_name}\n**License ID:** ${license.id}\n**Status:** Preorder\n\n**Information:**\nThis is a preorder product. The files are not yet available for download.\n\n**What happens next:**\n• You'll receive a DM when the product is released\n• Your license is confirmed and valid\n• No additional payment required`)
                            .setColor(0x3498db)
                            .setFooter({ text: 'Velxe License System • Thank you for your preorder' })
                            .setTimestamp();
                    } else if (product.status === "available") {
                        let downloadContent = '';
                        let attachments = [];
                        
                        // Handle file attachment for local files
                        if (product.fileName && !product.downloadUrl.startsWith('http')) {
                            try {
                                const filePath = path.join(__dirname, product.fileName);
                                const fileBuffer = fs.readFileSync(filePath);
                                const attachment = new AttachmentBuilder(fileBuffer, { name: product.fileName });
                                attachments.push(attachment);
                                
                                downloadContent = `**Product:** ${license.product_name}\n**License ID:** ${license.id}\n\n📁 **File attached:** ${product.fileName}\n\n**Setup Instructions:**\n1. Download the attached file\n2. Import into Roblox Studio\n3. Follow the setup guide included\n4. Contact support if you need help`;
                            } catch (error) {
                                console.error('Error reading file:', error);
                                downloadContent = `**Product:** ${license.product_name}\n**License ID:** ${license.id}\n\n❌ **Error:** Could not load file. Please contact support.`;
                            }
                        } else if (product.downloadUrl) {
                            // Handle URL downloads
                            let downloadLinks = product.fileName ? 
                                `• ${product.fileName}: [Download](${product.downloadUrl})` :
                                `• Main Script: [Download](${product.downloadUrl})\n• Documentation: [Download](${product.downloadUrl}/docs)\n• Setup Guide: [Download](${product.downloadUrl}/setup)`;
                            
                            downloadContent = `**Product:** ${license.product_name}\n**License ID:** ${license.id}\n**Download Instructions:**\n\n1. Download the files from the links below\n2. Follow the setup instructions included\n3. Contact support if you need help\n\n**Files:**\n${downloadLinks}`;
                        }

                        fileEmbed = new EmbedBuilder()
                            .setTitle('📁 Here are your files!')
                            .setDescription(downloadContent)
                            .setColor(0x00ff00)
                            .setFooter({ text: 'Velxe License System • Keep these files private' })
                            .setTimestamp();
                        
                        if (attachments.length > 0) {
                            await interaction.reply({ embeds: [fileEmbed], files: attachments, ephemeral: true });
                            return;
                        }
                    } else {
                        fileEmbed = new EmbedBuilder()
                            .setTitle('❌ Files Not Available')
                            .setDescription(`**Product:** ${license.product_name}\n**License ID:** ${license.id}\n\n**Status:** Files are currently not available for download.\n\nPlease contact support for assistance.`)
                            .setColor(0xff0000)
                            .setFooter({ text: 'Velxe License System' })
                            .setTimestamp();
                    }

                    await interaction.editReply({ embeds: [fileEmbed] });
                });
                return;
            }

            // Handle mod panel buttons
            if (interaction.customId.startsWith('delete_license_') || 
                interaction.customId.startsWith('resend_confirm_') ||
                interaction.customId.startsWith('confirm_delete_') ||
                interaction.customId.startsWith('cancel_delete_')) {
                
                // Check if user is authorized mod
                if (!AUTHORIZED_MODS.includes(interaction.user.id)) {
                    await interaction.reply({ 
                        content: '❌ You are not authorized to use this button.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                if (interaction.customId.startsWith('delete_license_')) {
                    const licenseId = interaction.customId.split('_')[2];
                    
                    // First, get the license details to show confirmation
                    db.get(`SELECT * FROM purchases WHERE id = ?`, [licenseId], async (dbErr, license) => {
                        if (dbErr || !license) {
                            await interaction.reply({ 
                                content: '❌ License not found.', 
                                flags: MessageFlags.Ephemeral 
                            });
                            return;
                        }

                        const confirmEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Confirm License Deletion')
                            .setDescription(`Are you sure you want to delete this license?\n\n**License ID:** ${license.id}\n**Product:** ${license.product_name}\n**User:** <@${license.discord_id}>\n**Roblox:** ${license.roblox_username} (${license.roblox_id})\n**Date:** ${new Date(license.purchase_date).toLocaleString()}`)
                            .setColor(0xff6b6b);

                        const confirmButtons = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`confirm_delete_${licenseId}`)
                                    .setLabel('✅ Yes, Delete')
                                    .setStyle(ButtonStyle.Danger),
                                new ButtonBuilder()
                                    .setCustomId(`cancel_delete_${licenseId}`)
                                    .setLabel('❌ Cancel')
                                    .setStyle(ButtonStyle.Secondary)
                            );

                        await interaction.reply({ 
                            embeds: [confirmEmbed], 
                            components: [confirmButtons],
                            flags: MessageFlags.Ephemeral 
                        });
                    });
                } else if (interaction.customId.startsWith('confirm_delete_')) {
                    const licenseId = interaction.customId.split('_')[2];
                    
                    db.run(`DELETE FROM purchases WHERE id = ?`, [licenseId], function(dbErr) {
                        if (dbErr) {
                            interaction.update({ 
                                content: '❌ Error deleting license.',
                                embeds: [],
                                components: []
                            });
                            return;
                        }
                        
                        interaction.update({ 
                            content: '✅ License deleted successfully.',
                            embeds: [],
                            components: []
                        });
                    });
                } else if (interaction.customId.startsWith('cancel_delete_')) {
                    await interaction.update({ 
                        content: '❌ License deletion cancelled.',
                        embeds: [],
                        components: []
                    });
                }
                return;
            }

            // Handle unlink confirmation buttons
            if (interaction.customId.startsWith('confirm_unlink_') || interaction.customId.startsWith('cancel_unlink_')) {
                const userId = interaction.customId.split('_')[2];
                
                if (userId !== interaction.user.id) {
                    await interaction.reply({ 
                        content: '❌ You cannot use this button.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                if (interaction.customId.startsWith('confirm_unlink_')) {
                    db.run(`DELETE FROM linked_accounts WHERE discord_id = ?`, [interaction.user.id], function(dbErr) {
                        if (dbErr) {
                            const errorEmbed = new EmbedBuilder()
                                .setTitle('❌ Error')
                                .setDescription('Failed to unlink account. Please try again.')
                                .setColor(0xff0000);

                            interaction.update({ embeds: [errorEmbed], components: [] });
                            return;
                        }

                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ Account Unlinked')
                            .setDescription('Your Roblox account has been successfully unlinked.\n\nYou can use `/link` to link a new account.')
                            .setColor(0x00ff00);

                        interaction.update({ embeds: [successEmbed], components: [] });
                    });
                } else {
                    const cancelEmbed = new EmbedBuilder()
                        .setTitle('❌ Unlink Cancelled')
                        .setDescription('Your account remains linked.')
                        .setColor(0x3498db);

                    await interaction.update({ embeds: [cancelEmbed], components: [] });
                }
                return;
            }

            // Handle regular product buttons
            const customIdParts = interaction.customId.split('_');
            const buttonUserId = customIdParts[customIdParts.length - 1];
            
            if (buttonUserId !== interaction.user.id) {
                await interaction.reply({ 
                    content: '❌ You cannot use this button. Use `/products` to create your own product catalog.', 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }

            const [action, page] = interaction.customId.split('_');
            const currentPage = parseInt(page);

            if (action === 'prev') {
                const newPage = Math.max(1, currentPage - 1);
                const embed = createProductEmbed(newPage);
                const buttons = createNavigationButtons(newPage, interaction.user.id);
                await interaction.update({ embeds: [embed], components: [buttons] });
            } else if (action === 'next') {
                const newPage = Math.min(Object.keys(products).length, currentPage + 1);
                const embed = createProductEmbed(newPage);
                const buttons = createNavigationButtons(newPage, interaction.user.id);
                await interaction.update({ embeds: [embed], components: [buttons] });
            } else if (action === 'buy') {
                const product = products[currentPage];
                
                const confirmEmbed = new EmbedBuilder()
                    .setTitle('💰 Confirm Purchase')
                    .setDescription(`Are you sure you want to buy **${product.name}**?\n\n${product.description}`)
                    .setColor(0xffa500);

                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_buy_${currentPage}_${interaction.user.id}`)
                            .setLabel('✅ Yes, Buy')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`cancel_buy_${currentPage}_${interaction.user.id}`)
                            .setLabel('❌ Cancel')
                            .setStyle(ButtonStyle.Secondary)
                    );

                await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });
            } else if (action === 'confirm' && interaction.customId.includes('buy')) {
                const [, , page] = interaction.customId.split('_');
                const currentPage = parseInt(page);
                const product = products[currentPage];
                
                // Check if it's a free product
                if (product.isFree) {
                    // Get linked account
                    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [interaction.user.id], async (dbErr, linkedAccount) => {
                        if (!linkedAccount) {
                            const linkEmbed = new EmbedBuilder()
                                .setTitle('🔗 Account Not Linked')
                                .setDescription('You need to link your Roblox account before claiming free products.\n\nUse `/link` to link your account.')
                                .setColor(0xff6b6b);

                            await interaction.update({ embeds: [linkEmbed], components: [] });
                            return;
                        }

                        // Check if user already owns this product
                        db.get(`SELECT * FROM purchases WHERE discord_id = ? AND product_name = ?`, [interaction.user.id, product.name], async (dbErr2, existingPurchase) => {
                            if (existingPurchase) {
                                const alreadyOwnedEmbed = new EmbedBuilder()
                                    .setTitle('❌ Already Claimed')
                                    .setDescription(`You already claimed **${product.name}**!\n\nClaimed on: ${new Date(existingPurchase.purchase_date).toLocaleString()}`)
                                    .setColor(0xff6b6b);

                                await interaction.update({ embeds: [alreadyOwnedEmbed], components: [] });
                                return;
                            }

                            // Give free product
                            db.run(`INSERT INTO purchases (discord_id, roblox_id, roblox_username, product_name) VALUES (?, ?, ?, ?)`,
                                [interaction.user.id, linkedAccount.roblox_id, linkedAccount.roblox_username, product.name], function(dbErr3) {
                                    if (dbErr3) {
                                        console.error('Error giving free product:', dbErr3);
                                        const errorEmbed = new EmbedBuilder()
                                            .setTitle('❌ Error')
                                            .setDescription('Failed to claim product. Please try again.')
                                            .setColor(0xff0000);

                                        interaction.update({ embeds: [errorEmbed], components: [] });
                                        return;
                                    }

                                    const licenseId = this.lastID;

                                    const successEmbed = new EmbedBuilder()
                                        .setTitle('✅ Free Product Claimed!')
                                        .setDescription(`You have successfully claimed **${product.name}**!\n\n**Roblox Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})\n**License ID:** ${licenseId}\n**Status:** Active\n**Valid Until:** Forever`)
                                        .setColor(0x00ff00)
                                        .setTimestamp();

                                    interaction.update({ embeds: [successEmbed], components: [] });

                                    // Send confirmation DM
                                    const dmEmbed = new EmbedBuilder()
                                        .setTitle('🎉 Free Product Claimed!')
                                        .setDescription(`You've successfully claimed **${product.name}**!`)
                                        .addFields({
                                            name: '📄 License Details:',
                                            value: `**Product:** ${product.name}\n**License ID:** ${licenseId}\n**Roblox Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})`,
                                            inline: false
                                        }, {
                                            name: '📥 Next Steps:',
                                            value: 'Use `/retrieve` to download your files!',
                                            inline: false
                                        })
                                        .setColor(0x00ff00)
                                        .setFooter({ text: 'Velxe License System' })
                                        .setTimestamp();

                                    interaction.user.send({ embeds: [dmEmbed] }).catch(console.error);
                                });
                        });
                    });
                    return;
                }
                
                // Regular paid product logic continues here...
                db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [interaction.user.id], async (dbErr, linkedAccount) => {
                    if (!linkedAccount) {
                        const linkEmbed = new EmbedBuilder()
                            .setTitle('🔗 Account Not Linked')
                            .setDescription('You need to link your Roblox account before purchasing.\n\nUse `/link` to link your account.')
                            .setColor(0xff6b6b);

                        await interaction.update({ embeds: [linkEmbed], components: [] });
                        return;
                    }

                    const product = products[currentPage];
                    
                    // Check if user already owns this product
                    db.get(`SELECT * FROM purchases WHERE discord_id = ? AND product_name = ?`, [interaction.user.id, product.name], async (dbErr2, existingPurchase) => {
                        if (existingPurchase) {
                            const alreadyOwnedEmbed = new EmbedBuilder()
                                .setTitle('❌ Already Purchased')
                                .setDescription(`You already own **${product.name}**!\n\nPurchased on: ${new Date(existingPurchase.purchase_date).toLocaleString()}`)
                                .setColor(0xff6b6b);

                            await interaction.update({ embeds: [alreadyOwnedEmbed], components: [] });
                            return;
                        }

                        const stepsEmbed = new EmbedBuilder()
                            .setTitle('📋 Purchase Instructions')
                            .setDescription(`**Linked Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})\n\n**Step-by-step guide:**\n1. Click the link below to go to the gamepass\n2. Purchase the gamepass on Roblox\n3. Come back here and click "Done" when purchased\n\n**Gamepass Link:**\nhttps://www.roblox.com/game-pass/${product.gamepassId}/${product.name.replace(/\s+/g, '')}`)
                            .setColor(0x00ff00)
                            .setFooter({ text: 'Secured by Velxe.com' });

                        const actionRow = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`done_purchase_${currentPage}_${linkedAccount.roblox_id}_${interaction.user.id}`)
                                    .setLabel('✅ Done - I bought it!')
                                    .setStyle(ButtonStyle.Success)
                            );

                        await interaction.update({ embeds: [stepsEmbed], components: [actionRow] });
                    });
                });
            } else if (action === 'cancel' && interaction.customId.includes('buy')) {
                const embed = createProductEmbed(currentPage);
                const buttons = createNavigationButtons(currentPage, interaction.user.id);
                await interaction.update({ embeds: [embed], components: [buttons] });
            } else if (action === 'done') {
                const [, , page, robloxId, discordUserId] = interaction.customId.split('_');
                
                // Check authorization using Discord user ID
                if (discordUserId !== interaction.user.id) {
                    await interaction.reply({ 
                        content: '❌ You cannot use this button. Use `/products` to create your own product catalog.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }
                
                const product = products[parseInt(page)];
                
                await interaction.update({ 
                    embeds: [new EmbedBuilder()
                        .setTitle('🔄 Verifying Purchase...')
                        .setDescription('Please wait while we verify your gamepass purchase.')
                        .setColor(0x3498db)], 
                    components: [] 
                });

                try {
                    const hasGamepass = await checkGamepassOwnership(robloxId, product.gamepassId);
                    
                    if (hasGamepass) {
                        const robloxUsername = await getRobloxUsername(robloxId);
                        
                        await interaction.editReply({
                            embeds: [new EmbedBuilder()
                                .setTitle('💾 Saving to Velxe Database...')
                                .setDescription('Processing your purchase...')
                                .setColor(0x3498db)]
                        });

                        // Save to database
                        db.run(`INSERT INTO purchases (discord_id, roblox_id, roblox_username, product_name) VALUES (?, ?, ?, ?)`,
                            [interaction.user.id, robloxId, robloxUsername, product.name]);

                        setTimeout(async () => {
                            const successEmbed = new EmbedBuilder()
                                .setTitle('✅ Success!')
                                .setDescription(`You have bought **${product.name}** for **${robloxUsername}**\n\nActive until: **Forever**\n\n📁 **File Delivery:** You will be sent the file when it's released\n📩 **Confirmation:** A confirmation will be sent to your DMs`)
                                .setColor(0x00ff00)
                                .setTimestamp();

                            await interaction.editReply({ embeds: [successEmbed] });
                            
                            // Send DM confirmation
                            try {
                                const dmEmbed = new EmbedBuilder()
                                    .setTitle('🎉 Purchase Confirmation')
                                    .setDescription(`Thank you for purchasing **${product.name}**!\n\n**Details:**\n• Product: ${product.name}\n• Roblox Account: ${robloxUsername} (${robloxId})\n• Purchase Date: ${new Date().toLocaleString()}\n\n📁 You will receive the file when it's released.\n\nIf you have any questions, contact support.`)
                                    .setColor(0x00ff00)
                                    .setTimestamp();
                                
                                await interaction.user.send({ embeds: [dmEmbed] });
                            } catch (error) {
                                console.log('Could not send DM to user:', error);
                            }
                        }, 2000);
                    } else {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle('❌ Purchase Not Found')
                            .setDescription('We could not verify your gamepass purchase. Please contact <@575252669443211264> (Modmail) for assistance.')
                            .setColor(0xff0000);

                        await interaction.editReply({ embeds: [errorEmbed] });
                    }
                } catch (error) {
                    console.error('Error verifying purchase:', error);
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ Error')
                        .setDescription('An error occurred while verifying your purchase. Please contact <@575252669443211264> (Modmail) for assistance.')
                        .setColor(0xff0000);

                    await interaction.editReply({ embeds: [errorEmbed] });
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('give_product_')) {
                const adminId = interaction.customId.split('_')[2];
                
                // Check if the person using the dropdown is the admin who created it
                if (adminId !== interaction.user.id) {
                    await interaction.reply({ 
                        content: '❌ You cannot use this dropdown.', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                const selectedProduct = interaction.values[0];
                const targetUserId = interaction.customId.split('_')[3];
                
                await handleGiveProduct(interaction, targetUserId, selectedProduct);
                return;
            }
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'link_modal') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const robloxUsername = interaction.fields.getTextInputValue('roblox_username');

                try {
                    const robloxId = await getRobloxId(robloxUsername);
                    const verificationCode = generateVerificationCode();

                    // Save verification attempt
                    db.run(`INSERT OR REPLACE INTO linked_accounts (discord_id, roblox_id, roblox_username, verification_code, verified) VALUES (?, ?, ?, ?, FALSE)`,
                        [interaction.user.id, robloxId, robloxUsername, verificationCode]);

                    const verifyEmbed = new EmbedBuilder()
                        .setTitle('🔗 Bio Verification Required')
                        .setDescription(`**Step 1:** Go to your Roblox profile settings\n**Step 2:** Add this code to your bio:\n\`\`\`${verificationCode}\`\`\`\n**Step 3:** Click "Done" when you've updated your bio\n\n**Security:** Bio verification is secured by Velxe.com\n**Profile:** [${robloxUsername}](https://www.roblox.com/users/${robloxId}/profile)`)
                        .setColor(0x3498db)
                        .setFooter({ text: 'Secured by Velxe.com' });

                    const verifyButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`verify_bio_${interaction.user.id}`)
                                .setLabel('✅ Done - Check Bio')
                                .setStyle(ButtonStyle.Success)
                        );

                    await interaction.editReply({ embeds: [verifyEmbed], components: [verifyButton] });
                } catch (error) {
                    console.error('Error in link modal:', error);
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ User Not Found')
                        .setDescription('Could not find that Roblox username. Please check the spelling and try again.')
                        .setColor(0xff0000);

                    await interaction.editReply({ embeds: [errorEmbed] });
                }
            }
        }
    } catch (error) {
        console.error('Error in interaction handler:', error);
        
        // Try to respond if we haven't already
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ An error occurred. Please try again.', 
                    flags: MessageFlags.Ephemeral 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ An error occurred. Please try again.' 
                });
            }
        } catch (replyError) {
            console.error('Error sending error response:', replyError);
        }
    }
});

function createProductEmbed(page) {
    const product = products[page];
    
    return new EmbedBuilder()
        .setTitle(`📦 ${product.name}`)
        .addFields(
            { name: '📋 Info', value: product.info, inline: false },
            { name: '📝 Description', value: product.description, inline: false }
        )
        .setFooter({ text: `Page ${page} of ${Object.keys(products).length}` })
        .setColor(0x00ff00)
        .setTimestamp();
}

function createNavigationButtons(currentPage, userId) {
    const product = products[currentPage];
    const row = new ActionRowBuilder();
    
    const prevButton = new ButtonBuilder()
        .setCustomId(`prev_${currentPage}_${userId}`)
        .setLabel('◀️ Back')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1);
    
    const nextButton = new ButtonBuilder()
        .setCustomId(`next_${currentPage}_${userId}`)
        .setLabel('Forward ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === Object.keys(products).length);

    const buyButton = new ButtonBuilder()
        .setCustomId(`buy_${currentPage}_${userId}`)
        .setLabel(product.isFree ? '🆓 Claim Free' : '💰 Buy')
        .setStyle(product.isFree ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(!product.buyable);
    
    row.addComponents(prevButton, nextButton, buyButton);
    return row;
}

async function getRobloxId(username) {
    try {
        const response = await axios.post('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: true
        });
        
        if (response.data.data && response.data.data.length > 0) {
            return response.data.data[0].id.toString();
        }
        
        throw new Error('User not found');
    } catch (error) {
        throw new Error('User not found');
    }
}

async function getRobloxUsername(userId) {
    try {
        console.log(`Fetching username for User ID: ${userId}`);
        const response = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
        console.log('API Response:', response.data);
        
        if (response.data && response.data.name) {
            console.log(`Successfully got username: ${response.data.name}`);
            return response.data.name;
        }
        
        throw new Error('No name in response');
        
    } catch (error) {
        console.log('Error in getRobloxUsername:', error.message);
        throw error;
    }
}

async function checkGamepassOwnership(userId, gamepassId) {
    try {
        const response = await axios.get(`https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gamepassId}`);
        return response.data.data && response.data.data.length > 0;
    } catch (error) {
        return false;
    }
}

async function showLicensePanel(interaction) {
    await interaction.reply({ 
        content: '🔄 Loading license data...', 
        flags: MessageFlags.Ephemeral 
    });

    db.all(`SELECT * FROM purchases ORDER BY purchase_date DESC`, [], (dbErr, rows) => {
        if (dbErr) {
            interaction.editReply({ content: '❌ Database error occurred.' });
            return;
        }

        if (rows.length === 0) {
            interaction.editReply({ content: '📝 No licenses found.' });
            return;
        }

        // Paginate results (10 per page)
        const itemsPerPage = 10;
        const totalPages = Math.ceil(rows.length / itemsPerPage);
        const currentPage = 1;
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pageItems = rows.slice(startIndex, endIndex);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ License Management Panel')
            .setDescription(`Total Licenses: ${rows.length}`)
            .setColor(0x3498db)
            .setFooter({ text: `Page ${currentPage} of ${totalPages}` });

        pageItems.forEach((license, index) => {
            embed.addFields({
                name: `License #${startIndex + index + 1}`,
                value: `**Product:** ${license.product_name}\n**Discord:** <@${license.discord_id}>\n**Roblox:** ${license.roblox_username} (${license.roblox_id})\n**Date:** ${new Date(license.purchase_date).toLocaleString()}`,
                inline: false
            });
        });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`mod_prev_${currentPage}`)
                    .setLabel('◀️ Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage === 1),
                new ButtonBuilder()
                    .setCustomId(`mod_next_${currentPage}`)
                    .setLabel('Next ▶️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage === totalPages)
            );

        interaction.editReply({ embeds: [embed], components: [buttons] });
    });
}

async function searchUserLicenses(interaction, discordId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    db.all(`SELECT * FROM purchases WHERE discord_id = ? ORDER BY purchase_date DESC`, [discordId], async (dbErr, licenses) => {
        if (dbErr) {
            await interaction.editReply({ content: '❌ Database error occurred.' });
            return;
        }

        if (licenses.length === 0) {
            await interaction.editReply({ content: `📝 No licenses found for Discord ID: ${discordId}` });
            return;
        }

        // Get linked account info
        db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [discordId], async (dbErr2, linkedAccount) => {
            const searchEmbed = new EmbedBuilder()
                .setTitle('🔍 License Search Results')
                .setDescription(`**Discord ID:** ${discordId}\n**Linked Account:** ${linkedAccount ? `${linkedAccount.roblox_username} (${linkedAccount.roblox_id})` : 'Not linked'}\n**Total Licenses:** ${licenses.length}`)
                .setColor(0x3498db)
                .setFooter({ text: 'Velxe License System' })
                .setTimestamp();

            licenses.forEach((license, index) => {
                searchEmbed.addFields({
                    name: `License #${index + 1}`,
                    value: `**Product:** ${license.product_name}\n**License ID:** ${license.id}\n**Date:** ${new Date(license.purchase_date).toLocaleString()}`,
                    inline: true
                });
            });

            // Create delete buttons for each license (max 5 per row)
            const components = [];
            for (let i = 0; i < licenses.length; i += 5) {
                const row = new ActionRowBuilder();
                const batch = licenses.slice(i, i + 5);
                
                batch.forEach((license) => {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`delete_license_${license.id}`)
                            .setLabel(`�️ Delete #${license.id}`)
                            .setStyle(ButtonStyle.Danger)
                    );
                });
                
                components.push(row);
            }

            await interaction.editReply({ embeds: [searchEmbed], components });
        });
    });
}

async function handleLinkCommand(interaction) {
    // Check if already linked
    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [interaction.user.id], async (dbErr, existingLink) => {
        if (existingLink) {
            const alreadyLinkedEmbed = new EmbedBuilder()
                .setTitle('✅ Already Linked')
                .setDescription(`Your account is already linked to **${existingLink.roblox_username}** (${existingLink.roblox_id})\n\nUse \`/unlink\` if you want to link a different account.`)
                .setColor(0x00ff00);

            await interaction.reply({ embeds: [alreadyLinkedEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('link_modal')
            .setTitle('Link Roblox Account');

        const robloxInput = new TextInputBuilder()
            .setCustomId('roblox_username')
            .setLabel('Roblox Username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter your Roblox username')
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(robloxInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
    });
}

async function handleUnlinkCommand(interaction) {
    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [interaction.user.id], async (dbErr, linkedAccount) => {
        if (!linkedAccount) {
            const notLinkedEmbed = new EmbedBuilder()
                .setTitle('❌ Not Linked')
                .setDescription('You don\'t have a linked Roblox account.\n\nUse `/link` to link your account.')
                .setColor(0xff6b6b);

            await interaction.reply({ embeds: [notLinkedEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Unlink')
            .setDescription(`Are you sure you want to unlink your account from **${linkedAccount.roblox_username}** (${linkedAccount.roblox_id})?\n\n**Warning:** You will need to re-verify if you want to link again.`)
            .setColor(0xffa500);

        const confirmButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_unlink_${interaction.user.id}`)
                    .setLabel('✅ Yes, Unlink')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`cancel_unlink_${interaction.user.id}`)
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({ embeds: [confirmEmbed], components: [confirmButtons], flags: MessageFlags.Ephemeral });
    });
}

async function handleProfileCommand(interaction, targetUser) {
    await interaction.deferReply();

    // Get linked account info
    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [targetUser.id], async (dbErr, linkedAccount) => {
        // Get purchases
        db.all(`SELECT * FROM purchases WHERE discord_id = ? ORDER BY purchase_date DESC`, [targetUser.id], async (dbErr2, purchases) => {
            const profileEmbed = new EmbedBuilder()
                .setTitle(`📋 ${targetUser.displayName}'s Profile`)
                .setThumbnail(targetUser.displayAvatarURL())
                .setColor(0x3498db)
                .setTimestamp();

            if (linkedAccount) {
                profileEmbed.addFields({
                    name: '🔗 Linked Account',
                    value: `**Username:** ${linkedAccount.roblox_username}\n**User ID:** ${linkedAccount.roblox_id}\n**Linked:** ${new Date(linkedAccount.link_date).toLocaleDateString()}`,
                    inline: false
                });
            } else {
                profileEmbed.addFields({
                    name: '🔗 Linked Account',
                    value: 'No linked account',
                    inline: false
                });
            }

            if (purchases && purchases.length > 0) {
                const purchaseList = purchases.map((purchase, index) => 
                    `**${index + 1}.** ${purchase.product_name}\n└ Purchased: ${new Date(purchase.purchase_date).toLocaleDateString()}`
                ).join('\n\n');

                profileEmbed.addFields({
                    name: `🛒 Purchases (${purchases.length})`,
                    value: purchaseList.length > 1024 ? purchaseList.substring(0, 1021) + '...' : purchaseList,
                    inline: false
                });
            } else {
                profileEmbed.addFields({
                    name: '🛒 Purchases',
                    value: 'No purchases yet',
                    inline: false
                });
            }

            profileEmbed.setFooter({ text: 'Velxe License System' });

            await interaction.editReply({ embeds: [profileEmbed] });
        });
    });
}

function generateVerificationCode() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let randomLetters = '';
    for (let i = 0; i < 4; i++) {
        randomLetters += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    return `Velxe-${randomLetters}`;
}

async function checkRobloxBio(robloxId, verificationCode) {
    try {
        const response = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
        const bio = response.data.description || '';
        return bio.includes(verificationCode);
    } catch (error) {
        return false;
    }
}

async function handleGiveCommand(interaction) {
    // Check if user is authorized
    if (!AUTHORIZED_MODS.includes(interaction.user.id)) {
        await interaction.reply({ 
            content: '❌ You are not authorized to use this command.', 
            flags: MessageFlags.Ephemeral 
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');

    // Check if target user has linked account
    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [targetUser.id], async (dbErr, linkedAccount) => {
        if (!linkedAccount) {
            const noLinkEmbed = new EmbedBuilder()
                .setTitle('❌ User Not Linked')
                .setDescription(`${targetUser.displayName} doesn't have a linked Roblox account.\n\nThey need to use \`/link\` first.`)
                .setColor(0xff6b6b);

            await interaction.reply({ embeds: [noLinkEmbed], flags: MessageFlags.Ephemeral });
            return;
        }

        // Create dropdown with products
        const productOptions = Object.entries(products).map(([productId, product]) => ({
            label: product.name,
            description: product.description.substring(0, 100),
            value: product.name
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`give_product_${interaction.user.id}_${targetUser.id}`)
            .setPlaceholder('Select a product to give')
            .addOptions(productOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const selectEmbed = new EmbedBuilder()
            .setTitle('🎁 Give Product')
            .setDescription(`Select a product to give to **${targetUser.displayName}**\n\n**Linked Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})`)
            .setColor(0x00ff00);

        await interaction.reply({ embeds: [selectEmbed], components: [row], flags: MessageFlags.Ephemeral });
    });
}

async function handleGiveProduct(interaction, targetUserId, productName) {
    await interaction.deferUpdate();

    try {
        // Get target user and their linked account
        const targetUser = await interaction.client.users.fetch(targetUserId);
        
        db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [targetUserId], async (dbErr, linkedAccount) => {
            if (dbErr || !linkedAccount) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setDescription('Target user no longer has a linked account.')
                    .setColor(0xff0000);

                await interaction.editReply({ embeds: [errorEmbed], components: [] });
                return;
            }

            // Check if user already owns this product
            db.get(`SELECT * FROM purchases WHERE discord_id = ? AND product_name = ?`, [targetUserId, productName], async (dbErr2, existingPurchase) => {
                if (existingPurchase) {
                    const alreadyOwnedEmbed = new EmbedBuilder()
                        .setTitle('❌ Already Owns Product')
                        .setDescription(`**${targetUser.displayName}** already owns **${productName}**!\n\nPurchased on: ${new Date(existingPurchase.purchase_date).toLocaleString()}`)
                        .setColor(0xff6b6b);

                    await interaction.editReply({ embeds: [alreadyOwnedEmbed], components: [] });
                    return;
                }

                // Add product to database
                db.run(`INSERT INTO purchases (discord_id, roblox_id, roblox_username, product_name) VALUES (?, ?, ?, ?)`,
                    [targetUserId, linkedAccount.roblox_id, linkedAccount.roblox_username, productName], function(dbErr3) {
                        if (dbErr3) {
                            console.error('Error giving product:', dbErr3);
                            const errorEmbed = new EmbedBuilder()
                                .setTitle('❌ Database Error')
                                .setDescription('Failed to give product. Please try again.')
                                .setColor(0xff0000);

                            interaction.editReply({ embeds: [errorEmbed], components: [] });
                            return;
                        }

                        const licenseId = this.lastID;

                        // Success message for admin
                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ Product Given Successfully')
                            .setDescription(`**${productName}** has been given to **${targetUser.displayName}**\n\n**Roblox Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})\n**License ID:** ${licenseId}`)
                            .setColor(0x00ff00)
                            .setTimestamp();

                        interaction.editReply({ embeds: [successEmbed], components: [] });

                        // Send DM to target user
                        try {
                            const dmEmbed = new EmbedBuilder()
                                .setTitle('🎁 Product Received!')
                                .setDescription(`You have been given **${productName}** by an administrator!\n\n**Details:**\n• Product: ${productName}\n• Roblox Account: ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})\n• Date: ${new Date().toLocaleString()}\n• License ID: ${licenseId}\n\n📁 Use \`/retrieve\` to check your licenses.\n\nIf you have any questions, contact support.`)
                                .setColor(0x00ff00)
                                .setTimestamp()
                                .setFooter({ text: 'Velxe License System' });
                            
                            targetUser.send({ embeds: [dmEmbed] }).catch(error => {
                                console.log('Could not send DM to target user:', error);
                            });
                        } catch (error) {
                            console.log('Could not send DM to target user:', error);
                        }
                    });
            });
        });
    } catch (error) {
        console.error('Error in handleGiveProduct:', error);
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Error')
            .setDescription('An error occurred while processing the request.')
            .setColor(0xff0000);

        await interaction.editReply({ embeds: [errorEmbed], components: [] });
    }
}

async function handleRetrieveCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Check if user has linked account
    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [interaction.user.id], async (dbErr, linkedAccount) => {
        if (dbErr || !linkedAccount) {
            const linkEmbed = new EmbedBuilder()
                .setTitle('🔗 Account Not Linked')
                .setDescription('You need to link your Roblox account before retrieving licenses.\n\nUse `/link` to link your account.')
                .setColor(0xff6b6b);

            await interaction.editReply({ embeds: [linkEmbed] });
            return;
        }

        // Get user's purchases
        db.all(`SELECT * FROM purchases WHERE discord_id = ? ORDER BY purchase_date DESC`, [interaction.user.id], async (dbErr2, purchases) => {
            if (dbErr2) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Database Error')
                    .setDescription('Failed to retrieve your licenses. Please try again.')
                    .setColor(0xff0000);

                await interaction.editReply({ embeds: [errorEmbed] });
                return;
            }

            if (purchases.length === 0) {
                const noLicensesEmbed = new EmbedBuilder()
                    .setTitle('📝 No Licenses Found')
                    .setDescription('You don\'t have any purchased licenses yet.\n\nUse `/products` to browse available products.')
                    .setColor(0x3498db)
                    .setFooter({ text: 'Velxe License System' });

                await interaction.editReply({ embeds: [noLicensesEmbed] });
                return;
            }

            const retrieveEmbed = new EmbedBuilder()
                .setTitle('📋 Your Licenses')
                .setDescription(`**Linked Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})\n\nClick the buttons below to check the status of each license:`)
                .setColor(0x00ff00)
                .setFooter({ text: `Total Licenses: ${purchases.length} • Velxe License System` })
                .setTimestamp();

            // Add fields for each license with status
            purchases.forEach((license, index) => {
                const product = Object.values(products).find(p => p.name === license.product_name);
                let statusEmoji = "❓";
                let statusText = "Unknown";
                
                if (product) {
                    switch (product.status) {
                        case "development":
                            statusEmoji = "🚧";
                            statusText = "In Development";
                            break;
                        case "preorder":
                            statusEmoji = "📦";
                            statusText = "Preorder";
                            break;
                        case "available":
                            statusEmoji = "✅";
                            statusText = "Available";
                            break;
                    }
                }

                retrieveEmbed.addFields({
                    name: `${index + 1}. ${license.product_name}`,
                    value: `**License ID:** ${license.id}\n**Purchased:** ${new Date(license.purchase_date).toLocaleDateString()}\n**Status:** ${statusEmoji} ${statusText}`,
                    inline: true
                });
            });

            // Create buttons for each license (max 5 per row)
            const components = [];
            for (let i = 0; i < purchases.length; i += 5) {
                const row = new ActionRowBuilder();
                const batch = purchases.slice(i, i + 5);
                
                batch.forEach((license) => {
                    const product = Object.values(products).find(p => p.name === license.product_name);
                    let buttonLabel = `📁 ${license.product_name}`;
                    
                    if (product) {
                        switch (product.status) {
                            case "development":
                                buttonLabel = `🚧 ${license.product_name}`;
                                break;
                            case "preorder":
                                buttonLabel = `📦 ${license.product_name}`;
                                break;
                            case "available":
                                buttonLabel = `📁 ${license.product_name}`;
                                break;
                        }
                    }

                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`retrieve_file_${license.id}_${interaction.user.id}`)
                            .setLabel(buttonLabel)
                            .setStyle(ButtonStyle.Primary)
                    );
                });
                
                components.push(row);
            }

            await interaction.editReply({ embeds: [retrieveEmbed], components });
        });
    });
}

client.login(process.env.DISCORD_TOKEN);

function parseDuration(duration) {
    const regex = /^(\d+)(s|m|h|d)$/i;
    const match = duration.match(regex);
    
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    const multipliers = {
        's': 1000,           // seconds
        'm': 60 * 1000,      // minutes
        'h': 60 * 60 * 1000, // hours
        'd': 24 * 60 * 60 * 1000 // days
    };
    
    return value * multipliers[unit];
}

async function startGiveaway(interaction, productName, durationMs, winners) {
    const endTime = Date.now() + durationMs;
    const giveawayId = `giveaway_${Date.now()}`;
    
    const giveawayEmbed = new EmbedBuilder()
        .setTitle('🎉 GIVEAWAY!')
        .setDescription(`**Prize:** ${productName}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`)
        .addFields({
            name: '📝 How to Enter:',
            value: 'React with 🎉 to enter the giveaway!',
            inline: false
        })
        .setColor(0xffd700)
        .setFooter({ text: `Hosted by ${interaction.user.displayName} • Velxe Giveaways` })
        .setTimestamp();

    const giveawayMessage = await interaction.reply({
        embeds: [giveawayEmbed]
    });

    // Get the message to react to it
    const message = await interaction.fetchReply();
    await message.react('🎉');

    // Store giveaway data
    const giveawayData = {
        messageId: message.id,
        channelId: interaction.channel.id,
        productName,
        winners,
        endTime,
        hostId: interaction.user.id
    };

    // Set timeout to end giveaway
    setTimeout(() => {
        endGiveaway(giveawayData);
    }, durationMs);
}

async function endGiveaway(giveawayData) {
    try {
        const channel = client.channels.cache.get(giveawayData.channelId);
        if (!channel) return;

        const message = await channel.messages.fetch(giveawayData.messageId);
        if (!message) return;

        const reaction = message.reactions.cache.get('🎉');
        if (!reaction) {
            const noEntriesEmbed = new EmbedBuilder()
                .setTitle('🎉 Giveaway Ended')
                .setDescription(`**Prize:** ${giveawayData.productName}\n**Result:** No valid entries`)
                .setColor(0xff6b6b)
                .setTimestamp();

            await message.edit({ embeds: [noEntriesEmbed] });
            return;
        }

        const users = await reaction.users.fetch();
        const validEntries = users.filter(user => !user.bot);
        
        if (validEntries.size === 0) {
            const noEntriesEmbed = new EmbedBuilder()
                .setTitle('🎉 Giveaway Ended')
                .setDescription(`**Prize:** ${giveawayData.productName}\n**Result:** No valid entries`)
                .setColor(0xff6b6b)
                .setTimestamp();

            await message.edit({ embeds: [noEntriesEmbed] });
            return;
        }

        // Select winners
        const entriesArray = Array.from(validEntries.values());
        const selectedWinners = [];
        const winnersCount = Math.min(giveawayData.winners, entriesArray.length);

        for (let i = 0; i < winnersCount; i++) {
            const randomIndex = Math.floor(Math.random() * entriesArray.length);
            const winner = entriesArray.splice(randomIndex, 1)[0];
            selectedWinners.push(winner);
        }

        // Update embed with results
        const winnersList = selectedWinners.map(winner => `<@${winner.id}>`).join('\n');
    
        const endedEmbed = new EmbedBuilder()
            .setTitle('🎉 Giveaway Ended!')
            .setDescription(`**Prize:** ${giveawayData.productName}`)
            .addFields({
                name: `🏆 Winner${selectedWinners.length > 1 ? 's' : ''}:`,
                value: winnersList,
                inline: false
            })
            .setColor(0x00ff00)
            .setTimestamp();

        await message.edit({ embeds: [endedEmbed] });

        // Give products to winners
        for (const winner of selectedWinners) {
            try {
                // Check if winner has linked account
                const linkedAccount = await new Promise((resolve, reject) => {
                    db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [winner.id], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (linkedAccount) {
                    // Add to database
                    db.run(`INSERT INTO purchases (discord_id, roblox_id, roblox_username, product_name, purchase_date) VALUES (?, ?, ?, ?, ?)`,
                        [winner.id, linkedAccount.roblox_id, linkedAccount.roblox_username, giveawayData.productName, new Date().toISOString()], function(dbErr) {
                            if (!dbErr) {
                                const licenseId = this.lastID;
                                
                                // Send winner DM
                                const dmEmbed = new EmbedBuilder()
                                    .setTitle('🎉 Congratulations!')
                                    .setDescription(`You won **${giveawayData.productName}** in the giveaway!`)
                                    .addFields({
                                        name: '📋 License Details:',
                                        value: `**Product:** ${giveawayData.productName}\n**Roblox Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})\n**License ID:** ${licenseId}\n**Date:** ${new Date().toLocaleString()}`,
                                        inline: false
                                    }, {
                                        name: '📥 How to Access:',
                                        value: 'Use `/retrieve` to download your files.',
                                        inline: false
                                    })
                                    .setColor(0xffd700)
                                    .setFooter({ text: 'Velxe License System • Keep this information safe' })
                                    .setTimestamp();

                                winner.send({ embeds: [dmEmbed] }).catch(console.error);

                                // Send confirmation DM
                                setTimeout(() => {
                                    const confirmEmbed = new EmbedBuilder()
                                        .setTitle('✅ License Confirmed')
                                        .setDescription(`Your giveaway prize has been successfully added to your account!`)
                                        .addFields({
                                            name: '📄 Summary:',
                                            value: `• **Product:** ${giveawayData.productName}\n• **License ID:** ${licenseId}\n• **Status:** Active\n• **Valid Until:** Forever`,
                                            inline: false
                                        }, {
                                            name: '🔧 Next Steps:',
                                            value: '• Use `/retrieve` to access your files\n• Contact support if you need help\n• Enjoy your new product!',
                                            inline: false
                                        })
                                        .setColor(0x00ff00)
                                        .setFooter({ text: 'Velxe License System' })
                                        .setTimestamp();

                                    winner.send({ embeds: [confirmEmbed] }).catch(console.error);
                                }, 2000);
                            }
                        });
                } else {
                    // Send DM asking to link account
                    const linkEmbed = new EmbedBuilder()
                        .setTitle('🎉 You Won!')
                        .setDescription(`You won **${giveawayData.productName}** but need to link your Roblox account first.`)
                        .addFields({
                            name: '📝 Next Steps:',
                            value: 'Use `/link` to connect your Roblox account, then contact an admin to claim your prize.',
                            inline: false
                        })
                        .setColor(0xffa500)
                        .setFooter({ text: 'Velxe License System' })
                        .setTimestamp();

                    await winner.send({ embeds: [linkEmbed] });
                }
            } catch (error) {
                console.error(`Failed to process winner ${winner.id}:`, error);
            }
        }

        // Announce winners in channel
        const announcementEmbed = new EmbedBuilder()
            .setTitle('🎉 Giveaway Results')
            .setDescription(`Congratulations to the winner${selectedWinners.length > 1 ? 's' : ''} of **${giveawayData.productName}**!\n\n${winnersList}`)
            .setColor(0xffd700)
            .setFooter({ text: 'Check your DMs for instructions!' });

        await channel.send({ embeds: [announcementEmbed] });

    } catch (error) {
        console.error('Error ending giveaway:', error);
    }
}

// Add reaction event handler after the interactionCreate event
client.on('messageReactionAdd', async (reaction, user) => {
    // Ignore bot reactions
    if (user.bot) return;

    // Check if it's a giveaway reaction
    if (reaction.emoji.name === '🎉') {
        try {
            const message = reaction.message;
            
            // Check if this is a giveaway message (has the giveaway embed structure)
            if (message.embeds.length > 0 && message.embeds[0].title === '🎉 GIVEAWAY!') {
                const embed = message.embeds[0];
                const description = embed.description;
                
                // Extract product name from embed
                const productMatch = description.match(/\*\*Prize:\*\* (.+)/);
                if (!productMatch) return;
                
                const productName = productMatch[1].split('\n')[0];

                // Check if user has linked account
                db.get(`SELECT * FROM linked_accounts WHERE discord_id = ? AND verified = TRUE`, [user.id], async (dbErr, linkedAccount) => {
                    if (dbErr || !linkedAccount) {
                        // Remove reaction and send DM
                        await reaction.users.remove(user.id);
                        
                        const linkEmbed = new EmbedBuilder()
                            .setTitle('❌ Account Not Linked')
                            .setDescription('You need to link your Roblox account before joining giveaways.')
                            .addFields({
                                name: '📝 How to Link:',
                                value: 'Use `/link` to connect your Roblox account, then try joining the giveaway again.',
                                inline: false
                            })
                            .setColor(0xff6b6b)
                            .setFooter({ text: 'Velxe License System' });

                        try {
                            await user.send({ embeds: [linkEmbed] });
                        } catch (error) {
                            console.log(`Could not DM user ${user.id}`);
                        }
                        return;
                    }

                    // Check if user already owns this product
                    db.get(`SELECT * FROM purchases WHERE discord_id = ? AND product_name = ?`, [user.id, productName], async (dbErr2, existingPurchase) => {
                        if (existingPurchase) {
                            // Remove reaction and send DM
                            await reaction.users.remove(user.id);
                            
                            const alreadyOwnedEmbed = new EmbedBuilder()
                                .setTitle('❌ Already Own Product')
                                .setDescription(`You already own **${productName}**!`)
                                .addFields({
                                    name: '📋 Purchase Details:',
                                    value: `**Purchased:** ${new Date(existingPurchase.purchase_date).toLocaleString()}\n**License ID:** ${existingPurchase.id}`,
                                    inline: false
                                }, {
                                    name: '💡 Tip:',
                                    value: 'You cannot enter giveaways for products you already own.',
                                    inline: false
                                })
                                .setColor(0xff6b6b)
                                .setFooter({ text: 'Velxe License System' });

                            try {
                                await user.send({ embeds: [alreadyOwnedEmbed] });
                            } catch (error) {
                                console.log(`Could not DM user ${user.id}`);
                            }
                            return;
                        }

                        // User is eligible - send confirmation DM
                        const confirmEmbed = new EmbedBuilder()
                            .setTitle('✅ Giveaway Entry Confirmed')
                            .setDescription(`You've successfully entered the giveaway for **${productName}**!`)
                            .addFields({
                                name: '🎯 Entry Details:',
                                value: `**Product:** ${productName}\n**Linked Account:** ${linkedAccount.roblox_username} (${linkedAccount.roblox_id})`,
                                inline: false
                            }, {
                                name: '🍀 Good Luck!',
                                value: 'Winners will be announced when the giveaway ends.',
                                inline: false
                            })
                            .setColor(0x00ff00)
                            .setFooter({ text: 'Velxe License System' });

                        try {
                            await user.send({ embeds: [confirmEmbed] });
                        } catch (error) {
                            console.log(`Could not DM user ${user.id}`);
                        }
                    });
                });
            }
        } catch (error) {
            console.error('Error handling giveaway reaction:', error);
        }
    }
});




