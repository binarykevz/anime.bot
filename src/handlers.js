const { getSearchResults } = require('./scraper');
const { getEpisodes, getVideoSourceUrl } = require('./episodeExtractor');
const { downloadVideoToTemp, cleanupTempFile } = require('./downloader');
const { initUpload, uploadFileToUrl } = require('./storage');
const path = require('path');

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Sanitize filename to remove illegal OS characters
function sanitizeFilename(name) {
    return name.replace(/[\/\\:*?"<>|]/g, '_').trim();
}

async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const welcomeMessage = `
👋 <b>Welcome to the AnimeKai Bot!</b>

<b>Commands:</b>
/search &lt;name&gt; - Search for an anime
/episodes &lt;anime_url&gt; - List episodes of an anime
/upload &lt;episode_url&gt; - Download & Upload an episode to Storage

<i>Example:</i> <code>/search One Piece</code>
    `;
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
}

async function handleSearch(bot, msg, match) {
    const chatId = msg.chat.id;
    const query = match[1]?.trim();
    if (!query) return bot.sendMessage(chatId, "⚠️ Usage: <code>/search &lt;anime name&gt;</code>", { parse_mode: 'HTML' });

    await bot.sendChatAction(chatId, 'typing');
    try {
        const results = await getSearchResults(query);
        if (results.length === 0) return bot.sendMessage(chatId, `❌ No results found for "${escapeHtml(query)}".`);

        let message = `🔍 <b>Results for "${escapeHtml(query)}"</b>\n\n`;
        results.slice(0, 10).forEach((anime, i) => {
            message += `<b>${i + 1}.</b> <a href="${anime.url}">${escapeHtml(anime.title)}</a>\n`;
        });
        message += `\n<i>Use /episodes &lt;url&gt; to see episodes.</i>`;
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) {
        await bot.sendMessage(chatId, '⚠️ Error searching anime.');
    }}

async function handleEpisodes(bot, msg, match) {
    const chatId = msg.chat.id;
    const animeUrl = match[1]?.trim();
    if (!animeUrl || !animeUrl.includes('http')) return bot.sendMessage(chatId, "⚠️ Usage: <code>/episodes &lt;anime_url&gt;</code>", { parse_mode: 'HTML' });

    await bot.sendChatAction(chatId, 'typing');
    try {
        const episodes = await getEpisodes(animeUrl);
        if (episodes.length === 0) return bot.sendMessage(chatId, "❌ No episodes found.");

        let message = `📺 <b>Episodes Found (${episodes.length}):</b>\n\n`;
        // Show first 20 episodes to avoid message limits
        episodes.slice(0, 20).forEach(ep => {
            // Construct a mock watch URL for the user to copy
            const watchUrl = `https://anikai.watch/ajax/v2/episode/ep?id=${ep.id}`; 
            message += `🔹 Ep ${escapeHtml(ep.number)}: <code>/upload ${watchUrl}</code>\n`;
        });
        
        if (episodes.length > 20) message += `\n<i>...and ${episodes.length - 20} more.</i>`;
        message += `\n\n<i>Copy the command above to download and upload an episode!</i>`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
        await bot.sendMessage(chatId, `⚠️ Error: ${error.message}`);
    }
}

async function handleUpload(bot, msg, match) {
    const chatId = msg.chat.id;
    const episodeUrl = match[1]?.trim();
    
    if (!episodeUrl) return bot.sendMessage(chatId, "⚠️ Usage: <code>/upload &lt;episode_url&gt;</code>", { parse_mode: 'HTML' });

    await bot.sendMessage(chatId, "⏳ Starting process... This may take a few minutes depending on file size.");
    await bot.sendChatAction(chatId, 'upload_video');

    let tempFilePath = null;

    try {
        // 1. Extract Episode ID from URL (Assuming URL contains ?id= or /ep/)
        const epIdMatch = episodeUrl.match(/id=(\d+)/) || episodeUrl.match(/\/(\d+)(?:\?|$)/);
        if (!epIdMatch) throw new Error('Invalid episode URL format.');
        const episodeId = epIdMatch[1];

        // 2. Get Video Source URL
        await bot.sendMessage(chatId, "🔍 Extracting video source...");
        const videoUrl = await getVideoSourceUrl(episodeId);
        // 3. Download to Temp File
        await bot.sendMessage(chatId, "⬇️ Downloading video to temporary storage...");
        tempFilePath = await downloadVideoToTemp(videoUrl);
        
        // Get file size and extract filename parts
        const stats = require('fs').statSync(tempFilePath);
        const fileSize = stats.size;
        
        // Extract Anime Name and Episode Number from URL or context
        // For simplicity, we parse it from the URL or use defaults. 
        // In a real scenario, you'd pass the anime name from the previous step.
        const animeName = episodeUrl.split('/').find(p => p.includes('-'))?.replace(/-/g, ' ') || 'Unknown Anime';
        const epNum = episodeUrl.match(/ep(?:isode)?[-_]?(\\d+)/i)?.[1] || '1';
        
        const filename = `${sanitizeFilename(animeName)}, Episode ${epNum}.mp4`;

        // 4. Initialize Upload
        await bot.sendMessage(chatId, `📤 Initializing upload for "${filename}" (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);
        const uploadUrl = await initUpload(filename, fileSize);

        // 5. Stream to Storage API
        await bot.sendMessage(chatId, "☁️ Uploading to storage server...");
        await uploadFileToUrl(uploadUrl, tempFilePath);

        await bot.sendMessage(chatId, `✅ <b>Success!</b>\nFile "<code>${escapeHtml(filename)}</code>" has been uploaded successfully.`, { parse_mode: 'HTML' });

    } catch (error) {
        console.error('Upload Handler Error:', error);
        await bot.sendMessage(chatId, `❌ <b>Error:</b> ${escapeHtml(error.message)}`, { parse_mode: 'HTML' });
    } finally {
        // 6. Cleanup Temp File
        if (tempFilePath) {
            cleanupTempFile(tempFilePath);
        }
    }
}

module.exports = { handleStart, handleSearch, handleEpisodes, handleUpload };