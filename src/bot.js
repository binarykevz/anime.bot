require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { handleStart, handleSearch, handleEpisodes, handleUpload } = require('./handlers');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is not set!');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('✅ Bot is running...');

// --- Handlers ---
bot.onText(/\/start/, (msg) => handleStart(bot, msg));
bot.onText(/\/search(?:@\w+)?\s*(.*)/, (msg, match) => handleSearch(bot, msg, match));
bot.onText(/\/episodes(?:@\w+)?\s*(.*)/, (msg, match) => handleEpisodes(bot, msg, match));
bot.onText(/\/upload(?:@\w+)?\s*(.*)/, (msg, match) => handleUpload(bot, msg, match));

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping bot...');
    bot.stopPolling();
    process.exit(0);
});
