const fs = require('fs');
const { getSearchResults } = require('./scraper');
const { getEpisodes, getVideoSourceUrl } = require('./episodeExtractor');
const { downloadAndConvertToMp4, cleanupTempFile } = require('./downloader');
const { initUpload, uploadFileToUrl } = require('./storage');

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Helper to cleanly extract Anime Name and Episode Number from WordPress-style URLs
 * Example: "dr-stone-science-future-part-3-episode-10-in-english-subbed" 
 * Returns: { animeName: "Dr Stone Science Future Part 3", epNum: "10" }
 */
function parseAnimeInfoFromUrl(url) {
    const urlParts = url.split('/').filter(Boolean);
    const slug = urlParts[urlParts.length - 1];
    
    // Clean up slug: remove "-in-english-subbed" or "-in-english-dubbed"
    let cleanSlug = slug.replace(/-in-english-(subbed|dubbed)/i, '');
    
    // Extract episode number
    const epNumMatch = cleanSlug.match(/(?:-episode-|-ep-)(\d+)/i);
    const epNum = epNumMatch ? epNumMatch[1] : '1';
    
    // Extract anime name by removing the episode part
    let animeName = cleanSlug.replace(/(?:-episode-|-ep-)\d+.*/i, '');
    animeName = animeName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    return { animeName, epNum };
}

async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const welcomeMessage = `
👋 <b>Welcome to the AnimeKai Bot!</b>

<b>Commands:</b>
/search &lt;name&gt; - Search for an anime
/episodes &lt;anime_url&gt; - List episodes of an anime
/upload &lt;episode_url&gt; - Process a single episode
/auto &lt;anime_url&gt; [start] [end] - 🤖 <b>Auto-Batch</b> process multiple episodes!

<i>Example:</i> <code>/auto https://anikai.watch/series/one-piece 1 3</code>
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
        message += `\n<i>Use /episodes &lt;url&gt; or /auto &lt;url&gt;.</i>`;
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) {
        await bot.sendMessage(chatId, '⚠️ Error searching anime.');
    }
}

// ==========================================
// UPDATED: Handle single episode upload
// ==========================================
async function handleUpload(bot, msg, match) {
    const chatId = msg.chat.id;
    const episodeUrl = match[1]?.trim();
    
    if (!episodeUrl || !episodeUrl.includes('http')) {
        return bot.sendMessage(chatId, "⚠️ Usage: <code>/upload &lt;episode_url&gt;</code>\nExample: <code>/upload https://anikai.watch/dr-stone-episode-1/</code>", { parse_mode: 'HTML' });
    }

    await bot.sendMessage(chatId, "⏳ Starting process... This may take a few minutes.");
    await bot.sendChatAction(chatId, 'upload_video');

    let tempFilePath = null;

    try {
        // 1. Parse Name and Episode from the new URL structure
        const { animeName, epNum } = parseAnimeInfoFromUrl(episodeUrl);

        // 2. Get Video Source URL (Puppeteer handles the full URL directly now)
        await bot.sendMessage(chatId, "🔍 Extracting video source (this may take a minute)...");
        const videoUrl = await getVideoSourceUrl(episodeUrl);

        // 3. Download & Convert to MP4
        await bot.sendChatAction(chatId, 'upload_video');
        await bot.sendMessage(chatId, "⬇️ Downloading and converting to MP4...");
        tempFilePath = await downloadAndConvertToMp4(videoUrl, animeName, epNum);
                const stats = fs.statSync(tempFilePath);
        const fileSize = stats.size;
        
        const filename = `${animeName}, Episode ${epNum}.mp4`;

        // 4. Initialize Upload
        await bot.sendMessage(chatId, `📤 Initializing upload for "${filename}" (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);
        const initData = await initUpload(filename, fileSize);
        
        const uploadUrl = initData.upload_url || initData.url || initData.presigned_url;
        if (!uploadUrl) throw new Error('Storage API did not return an upload URL.');

        // 5. Stream to Storage API
        await bot.sendMessage(chatId, "☁️ Uploading to storage server...");
        await uploadFileToUrl(uploadUrl, tempFilePath);

        // 6. Extract final link
        const finalLink = initData.file_url || initData.link || `https://storage.to/f/${initData.file_id || initData.id}`;

        await bot.sendMessage(chatId, `✅ <b>Success!</b>\nFile "<code>${escapeHtml(filename)}</code>" has been uploaded.\n🔗 <a href="${finalLink}">Download/Watch Link</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });

    } catch (error) {
        console.error('Upload Handler Error:', error);
        await bot.sendMessage(chatId, `❌ <b>Error:</b> ${escapeHtml(error.message)}`, { parse_mode: 'HTML' });
    } finally {
        if (tempFilePath) {
            cleanupTempFile(tempFilePath);
        }
    }
}

// ==========================================
// UPDATED: Handle Auto-Batch
// ==========================================
async function handleAutoBatch(bot, msg, match) {
    const chatId = msg.chat.id;
    const animeUrl = match[1]?.trim();
    const startEp = parseInt(match[2]) || 1;
    const endEp = parseInt(match[3]) || 3; 

    if (!animeUrl || !animeUrl.includes('http')) {
        return bot.sendMessage(chatId, "⚠️ Usage: <code>/auto &lt;anime_url&gt; [start_ep] [end_ep]</code>", { parse_mode: 'HTML' });
    }

    await bot.sendMessage(chatId, `🤖 <b>Auto-Batch Started!</b>\nProcessing episodes ${startEp} to ${endEp}.`, { parse_mode: 'HTML' });

    let tempFilePath = null;

    try {
        const episodes = await getEpisodes(animeUrl);        if (episodes.length === 0) throw new Error('No episodes found.');
        
        // Extract series name from the main URL
        const { animeName } = parseAnimeInfoFromUrl(animeUrl);

        const targetEpisodes = episodes.slice(startEp - 1, endEp);
        const generatedLinks = [];

        for (const ep of targetEpisodes) {
            try {
                await bot.sendMessage(chatId, `⏳ <b>Processing Episode ${ep.number}...</b>\n1. Extracting source...`, { parse_mode: 'HTML' });
                
                // 1. Get Video URL (Pass the full episode URL)
                const videoUrl = await getVideoSourceUrl(ep.url);
                
                // 2. Download & Convert to MP4
                await bot.sendChatAction(chatId, 'upload_video');
                tempFilePath = await downloadAndConvertToMp4(videoUrl, animeName, ep.number);
                const fileSize = fs.statSync(tempFilePath).size;
                
                // 3. Initialize Upload
                const filename = `${animeName}, Episode ${ep.number}.mp4`;
                await bot.sendMessage(chatId, `📤 Uploading "${filename}" (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`, { parse_mode: 'HTML' });
                
                const initData = await initUpload(filename, fileSize);
                const uploadUrl = initData.upload_url || initData.url || initData.presigned_url;
                if (!uploadUrl) throw new Error('Storage API did not return an upload URL.');

                // 4. Stream to Storage
                await uploadFileToUrl(uploadUrl, tempFilePath);
                
                // 5. Extract final link
                const finalLink = initData.file_url || initData.link || `https://storage.to/f/${initData.file_id || initData.id}`;
                generatedLinks.push({ ep: ep.number, link: finalLink });
                
            } catch (epError) {
                console.error(`Error on Ep ${ep.number}:`, epError);
                generatedLinks.push({ ep: ep.number, link: `❌ Failed: ${epError.message}` });
            } finally {
                if (tempFilePath) cleanupTempFile(tempFilePath);
            }
        }

        // 6. Send Summary
        let summary = `✅ <b>Batch Complete!</b>\n\nGenerated Links:\n`;
        generatedLinks.forEach(item => {
            if (item.link.startsWith('http')) {
                summary += `🔹 <b>Episode ${item.ep}:</b> <a href="${item.link}">Download/Watch</a>\n`;
            } else {
                summary += `🔹 <b>Episode ${item.ep}:</b> ${escapeHtml(item.link)}\n`;            }
        });

        await bot.sendMessage(chatId, summary, { parse_mode: 'HTML', disable_web_page_preview: true });

    } catch (error) {
        console.error('Auto Batch Error:', error);
        await bot.sendMessage(chatId, `❌ <b>Batch Failed:</b> ${escapeHtml(error.message)}`, { parse_mode: 'HTML' });
    }
}

module.exports = { handleStart, handleSearch, handleUpload, handleAutoBatch };