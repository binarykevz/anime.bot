
const fs = require('fs');
const { getSearchResults } = require('./scraper');
const { getEpisodes, getVideoSourceUrl } = require('./episodeExtractor');
const { downloadAndConvertToMp4, cleanupTempFile } = require('./downloader');

const PROXY_USER = 'bgfqfdjy';
const PROXY_PASS = 'xgrj384kx4yw';
const PROXY_LIST = [
    '38.154.203.95:5863', '198.105.121.200:6462', '64.137.96.74:6641',
    '209.127.138.10:5784', '38.154.185.97:6370', '84.247.60.125:6095',
    '142.111.67.146:5611', '191.96.254.138:6185', '104.239.107.47:5699', '23.229.19.94:8689'
];
let proxyIndex = 0;

function getNextProxyUrl() {
    const ipPort = PROXY_LIST[proxyIndex % PROXY_LIST.length];
    proxyIndex++;
    return `http://${PROXY_USER}:${PROXY_PASS}@${ipPort}`;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseAnimeInfoFromUrl(url) {
    const urlParts = url.split('/').filter(Boolean);
    const slug = urlParts[urlParts.length - 1];
    let cleanSlug = slug.replace(/-in-english-(subbed|dubbed)/i, '');
    const epNumMatch = cleanSlug.match(/(?:-episode-|-ep-)(\d+)/i);
    const epNum = epNumMatch ? epNumMatch[1] : '1';
    let animeName = cleanSlug.replace(/(?:-episode-|-ep-)\d+.*/i, '');
    animeName = animeName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return { animeName: animeName, epNum: epNum };
}

async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const welcomeMessage = '👋 <b>Welcome to the AnimeKai Bot!</b>\n\n<b>Commands:</b>\n/search &lt;name&gt; - Search\n/episodes &lt;url&gt; - List episodes\n/upload &lt;url&gt; - Send single episode\n/auto &lt;url&gt; [start] [end] - Auto-Batch';
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
}

async function handleSearch(bot, msg, match) {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : '';
    if (!query) return bot.sendMessage(chatId, "⚠️ Usage: <code>/search &lt;anime name&gt;</code>", { parse_mode: 'HTML' });
    await bot.sendChatAction(chatId, 'typing');
    try {
        const results = await getSearchResults(query);
        if (results.length === 0) return bot.sendMessage(chatId, '❌ No results found for "' + escapeHtml(query) + '".');
        let message = '🔍 <b>Results for "' + escapeHtml(query) + '"</b>\n\n';
        results.slice(0, 10).forEach(function(anime, i) { message += '<b>' + (i + 1) + '.</b> <a href="' + anime.url + '">' + escapeHtml(anime.title) + '</a>\n'; });
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) { await bot.sendMessage(chatId, '⚠️ Error searching anime.'); }
}

async function processAndSendVideo(bot, chatId, episodeUrl) {
    const MAX_ATTEMPTS = 5;
    let tempFilePath = null;
    let lastError = 'Unknown error';
    const info = parseAnimeInfoFromUrl(episodeUrl);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log('\n[Handler] --- Attempt ' + attempt + '/' + MAX_ATTEMPTS + ' ---');
        const proxyUrl = getNextProxyUrl();
        console.log('[Handler] 🌐 Using Proxy: ' + proxyUrl.replace(/:\/\/.*@/, '://***:***@'));
        
        try {
            await bot.sendMessage(chatId, '🔍 Extracting video source (Attempt ' + attempt + ')...');
            const videoUrl = await getVideoSourceUrl(episodeUrl, proxyUrl);
            console.log('[Handler] ✅ Extraction successful. Video URL:', videoUrl.substring(0, 50) + '...');

            await bot.sendChatAction(chatId, 'upload_video');
            await bot.sendMessage(chatId, '⬇️ Downloading and converting to MP4...');
            tempFilePath = await downloadAndConvertToMp4(videoUrl, info.animeName, info.epNum, episodeUrl, proxyUrl);
            
            const fileSizeBytes = fs.statSync(tempFilePath).size;
            const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2);
            
            await bot.sendMessage(chatId, '⬆️ Sending video (' + fileSizeMB + ' MB) to Telegram...');
            
            await bot.sendVideo(chatId, tempFilePath, {
                caption: '📺 <b>' + escapeHtml(info.animeName) + '</b>\n🔹 Episode ' + info.epNum + '\n📦 <b>Size:</b> ' + fileSizeMB + ' MB',
                parse_mode: 'HTML',
                supportsStreaming: true
            });
            await bot.sendMessage(chatId, '✅ <b>Success!</b> Video sent directly to chat.', { parse_mode: 'HTML' });
            return true;
            
        } catch (error) {
            lastError = error.message;
            console.error('[Handler] ❌ Attempt ' + attempt + ' failed:', lastError);
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                cleanupTempFile(tempFilePath);
                tempFilePath = null;
            }
            // Brief pause before next attempt
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // 🚀 REPORT THE EXACT ERROR TO THE USER
    console.error('[Handler] 💀 ALL ATTEMPTS FAILED. Last error:', lastError);
    await bot.sendMessage(chatId, '❌ <b>Download Failed.</b>\n\n<b>Reason:</b> ' + escapeHtml(lastError) + '\n\n<i>Please share this error message with the developer.</i>', { parse_mode: 'HTML' });
    return false;
}

async function handleUpload(bot, msg, match) {
    const chatId = msg.chat.id;
    const episodeUrl = match[1] ? match[1].trim() : '';
    if (!episodeUrl || !episodeUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/upload &lt;episode_url&gt;</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, "⏳ Starting process... Extracting and downloading video.");
    await processAndSendVideo(bot, chatId, episodeUrl);
}

async function handleAutoBatch(bot, msg, match) {
    const chatId = msg.chat.id;
    const animeUrl = match[1] ? match[1].trim() : '';
    const startEp = parseInt(match[2]) || 1;
    const endEp = parseInt(match[3]) || 3; 
    if (!animeUrl || !animeUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/auto &lt;anime_url&gt; [start_ep] [end_ep]</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, '🤖 <b>Auto-Batch Started!</b>\nDownloading episodes ' + startEp + ' to ' + endEp + '.', { parse_mode: 'HTML' });

    try {
        const episodes = await getEpisodes(animeUrl);
        if (episodes.length === 0) throw new Error('No episodes found.');
        const targetEpisodes = episodes.slice(startEp - 1, endEp);

        for (const ep of targetEpisodes) {
            await bot.sendMessage(chatId, '⏳ <b>Processing Episode ' + ep.number + '...</b>', { parse_mode: 'HTML' });
            const success = await processAndSendVideo(bot, chatId, ep.url);
            if (!success) {
                await bot.sendMessage(chatId, '❌ Failed Ep ' + ep.number + '. Skipping...', { parse_mode: 'HTML' });
            }
        }
        await bot.sendMessage(chatId, '🎉 <b>Batch Complete!</b>', { parse_mode: 'HTML' });
    } catch (error) { 
        await bot.sendMessage(chatId, '❌ <b>Batch Failed:</b> ' + escapeHtml(error.message), { parse_mode: 'HTML' }); 
    }
}

module.exports = { handleStart: handleStart, handleSearch: handleSearch, handleUpload: handleUpload, handleAutoBatch: handleAutoBatch };
