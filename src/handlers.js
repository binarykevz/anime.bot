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

function getNextProxyConfig() {
    const ipPort = PROXY_LIST[proxyIndex % PROXY_LIST.length].trim();
    proxyIndex++;
    return {
        ipPort: ipPort,
        username: PROXY_USER,
        password: PROXY_PASS,
        fullHttp: `http://${PROXY_USER}:${PROXY_PASS}@${ipPort}`,
        fullSocks5: `socks5://${PROXY_USER}:${PROXY_PASS}@${ipPort}`
    };
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseAnimeInfoFromUrl(url) {
    const alMatch = url.match(/[?&]al=(\d+)/);
    const epMatch = url.match(/[?&]e=(\d+)/);
    
    const alId = alMatch ? alMatch[1] : '0';
    const epNum = epMatch ? epMatch[1] : '1';
    
    return { alId: alId, epNum: epNum, animeName: 'Anime' };
}

async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const welcomeMessage = `👋 <b>Welcome to the AniDoor Bot!</b>

<b>Commands:</b>
<code>/search</code> &lt;name&gt; - Search for an anime
<code>/episodes</code> &lt;watch_url&gt; - List episodes
<code>/upload</code> &lt;watch_url&gt; - Download & Send a single episode
<code>/auto</code> &lt;watch_url&gt; [start] [end] - 🤖 <b>Auto-Batch</b> download & send multiple episodes!
<i>Example:</i> <code>/auto https://anidoor.me/watch/?al=21 1 3</code>`;
    
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
        results.slice(0, 10).forEach(function(anime, i) {
            const safeUrl = escapeHtml(anime.url);
            message += '<b>' + (i + 1) + '.</b> <a href="' + safeUrl + '">' + escapeHtml(anime.title) + '</a>\n';
        });
        message += '\n<i>Use <code>/upload &lt;url&gt;</code> or <code>/auto &lt;url&gt;</code>.</i>';
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) {
        await bot.sendMessage(chatId, '⚠️ Error searching anime: ' + escapeHtml(error.message));
    }
}

async function processAndSendVideo(bot, chatId, episodeUrl) {
console.log('[Handler] 🚀 processAndSendVideo called with episodeUrl:', episodeUrl);
    const MAX_ATTEMPTS = 5;
    let tempFilePath = null;
    let lastError = 'Unknown error';
    const info = parseAnimeInfoFromUrl(episodeUrl);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log('\n[Handler] --- Attempt ' + attempt + '/' + MAX_ATTEMPTS + ' ---');
        const proxyConfig = getNextProxyConfig();
        console.log('[Handler] 🌐 Using Proxy IP: ' + proxyConfig.ipPort);
        
        try {
            await bot.sendMessage(chatId, '🔍 Extracting video source (Attempt ' + attempt + ')...');
            const videoUrl = await getVideoSourceUrl(episodeUrl, proxyConfig);
            console.log('[Handler] ✅ Extraction successful.');

            await bot.sendChatAction(chatId, 'upload_video');
            await bot.sendMessage(chatId, '⬇️ Downloading and converting to MP4...');
            tempFilePath = await downloadAndConvertToMp4(videoUrl, info.animeName, info.epNum, episodeUrl, proxyConfig);
            
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
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    console.error('[Handler] 💀 ALL ATTEMPTS FAILED. Last error:', lastError);
    await bot.sendMessage(chatId, '❌ <b>Download Failed.</b>\n\n<b>Reason:</b> ' + escapeHtml(lastError), { parse_mode: 'HTML' });
    return false;
}

async function handleUpload(bot, msg, match) {
    const chatId = msg.chat.id;
    const episodeUrl = match[1] ? match[1].trim() : '';
    if (!episodeUrl || !episodeUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/upload &lt;watch_url&gt;</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, "⏳ Starting process... Extracting and downloading video.");
    await processAndSendVideo(bot, chatId, episodeUrl);
}

async function handleAutoBatch(bot, msg, match) {
    const chatId = msg.chat.id;
    const watchUrl = match[1] ? match[1].trim() : '';
    const startEp = parseInt(match[2]) || 1;
    const endEp = parseInt(match[3]) || 3; 
    
    if (!watchUrl || !watchUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/auto &lt;watch_url&gt; [start_ep] [end_ep]</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, '🤖 <b>Auto-Batch Started!</b>\nDownloading episodes ' + startEp + ' to ' + endEp + '.', { parse_mode: 'HTML' });

    try {
        const episodes = await getEpisodes(watchUrl);
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

module.exports = { handleStart, handleSearch, handleUpload, handleAutoBatch };