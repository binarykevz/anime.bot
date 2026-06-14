
const fs = require('fs');
const { getSearchResults } = require('./scraper');
const { getEpisodes, getVideoSourceUrl } = require('./episodeExtractor');
const { downloadAndConvertToMp4, cleanupTempFile } = require('./downloader');

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

async function handleUpload(bot, msg, match) {
    const chatId = msg.chat.id;
    const episodeUrl = match[1] ? match[1].trim() : '';
    if (!episodeUrl || !episodeUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/upload &lt;episode_url&gt;</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, "⏳ Starting process... Extracting and downloading video.");
    let tempFilePath = null;
    try {
        const info = parseAnimeInfoFromUrl(episodeUrl);
        await bot.sendMessage(chatId, "🔍 Extracting video source...");
        const result = await getVideoSourceUrl(episodeUrl);
        
        await bot.sendChatAction(chatId, 'upload_video');
        await bot.sendMessage(chatId, "⬇️ Downloading and converting to MP4...");
        tempFilePath = await downloadAndConvertToMp4(result.videoUrl, info.animeName, info.epNum, episodeUrl, result.cookies);
        
        const fileSizeMB = (fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2);
        await bot.sendMessage(chatId, '⬆️ Sending ' + fileSizeMB + ' MB directly to Telegram...');
        
        await bot.sendVideo(chatId, tempFilePath, {
            caption: '📺 <b>' + escapeHtml(info.animeName) + '</b>\n🔹 Episode ' + info.epNum,
            parse_mode: 'HTML',
            supportsStreaming: true
        });
        await bot.sendMessage(chatId, '✅ <b>Success!</b> Video sent directly to chat.', { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Upload Handler Error:', error);
        if (error.message.includes('413')) await bot.sendMessage(chatId, '❌ <b>Error:</b> The video file is too large (Limit is 50MB).', { parse_mode: 'HTML' });
        else await bot.sendMessage(chatId, '❌ <b>Error:</b> ' + escapeHtml(error.message), { parse_mode: 'HTML' });
    } finally { if (tempFilePath) cleanupTempFile(tempFilePath); }
}

async function handleAutoBatch(bot, msg, match) {
    const chatId = msg.chat.id;
    const animeUrl = match[1] ? match[1].trim() : '';
    const startEp = parseInt(match[2]) || 1;
    const endEp = parseInt(match[3]) || 3; 
    if (!animeUrl || !animeUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/auto &lt;anime_url&gt; [start_ep] [end_ep]</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, '🤖 <b>Auto-Batch Started!</b>\nDownloading episodes ' + startEp + ' to ' + endEp + '.', { parse_mode: 'HTML' });
    let tempFilePath = null;

    try {
        const episodes = await getEpisodes(animeUrl);
        if (episodes.length === 0) throw new Error('No episodes found.');
        const info = parseAnimeInfoFromUrl(animeUrl);
        const targetEpisodes = episodes.slice(startEp - 1, endEp);

        for (const ep of targetEpisodes) {
            try {
                await bot.sendMessage(chatId, '⏳ <b>Processing Episode ' + ep.number + '...</b>', { parse_mode: 'HTML' });
                const result = await getVideoSourceUrl(ep.url);
                await bot.sendChatAction(chatId, 'upload_video');
                tempFilePath = await downloadAndConvertToMp4(result.videoUrl, info.animeName, ep.number, ep.url, result.cookies);
                const fileSizeMB = (fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2);
                await bot.sendMessage(chatId, '⬆️ Sending Ep ' + ep.number + ' (' + fileSizeMB + ' MB)...');
                await bot.sendVideo(chatId, tempFilePath, { caption: '📺 <b>' + escapeHtml(info.animeName) + '</b>\n🔹 Episode ' + ep.number, parse_mode: 'HTML', supportsStreaming: true });                await bot.sendMessage(chatId, '✅ Episode ' + ep.number + ' sent!');
            } catch (epError) {
                await bot.sendMessage(chatId, '❌ Failed Ep ' + ep.number + ': ' + escapeHtml(epError.message), { parse_mode: 'HTML' });
            } finally { if (tempFilePath) { cleanupTempFile(tempFilePath); tempFilePath = null; } }
        }
        await bot.sendMessage(chatId, '🎉 <b>Batch Complete!</b>', { parse_mode: 'HTML' });
    } catch (error) { await bot.sendMessage(chatId, '❌ <b>Batch Failed:</b> ' + escapeHtml(error.message), { parse_mode: 'HTML' }); }
}

module.exports = { handleStart: handleStart, handleSearch: handleSearch, handleUpload: handleUpload, handleAutoBatch: handleAutoBatch };
