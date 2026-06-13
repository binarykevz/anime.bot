require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { handleStart, handleSearch, handleAutoBatch } = require('./handlers');

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

// Matches: /auto https://... 1 5
bot.onText(/\/auto(?:@\w+)?\s+(\S+)(?:\s+(\d+))?(?:\s+(\d+))?/, (msg, match) => handleAutoBatch(bot, msg, match));

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping bot...');
    bot.stopPolling();
    process.exit(0);
});