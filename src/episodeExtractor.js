const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://anikai.watch';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': BASE_URL
};

/**
 * Extracts Anime ID and Episode list from the anime page
 */
async function getEpisodes(animeUrl) {
    try {
        // 1. Get the anime page to find the data-id
        const htmlRes = await axios.get(animeUrl, { headers: { ...headers, 'X-Requested-With': undefined } });
        const $ = cheerio.load(htmlRes.data);
        
        // AnimeKai/Zoro clones usually store the anime ID in a data attribute or hidden input
        const animeId = $('#syncData').data('id') || $('html').attr('data-id') || animeUrl.match(/\/(\d+)-/)?.[1];
        
        if (!animeId) throw new Error('Could not extract Anime ID from page.');

        // 2. Fetch episodes via AJAX
        const epRes = await axios.get(`${BASE_URL}/ajax/v2/episode/list/${animeId}`, { headers });
        const epHtml = epRes.data.html;
        const $$ = cheerio.load(epHtml);
        
        const episodes = [];
        $$('.ss-list a').each((i, el) => {
            const epNum = $$(el).find('.e-dinumber').text().trim() || $$(el).attr('title');
            const epId = $$(el).attr('data-id');
            episodes.push({ number: epNum, id: epId });
        });

        return episodes;
    } catch (error) {
        console.error('Episode Extraction Error:', error.message);
        throw new Error('Failed to fetch episode list.');
    }
}

/**
 * Extracts the direct MP4/M3U8 video URL for a specific episode
 * NOTE: Anime sites use encrypted players. This uses the standard Zoro-clone AJAX flow.
 */
async function getVideoSourceUrl(episodeId) {
    try {
        // 1. Get servers (usually Sub and Dub)
        const serverRes = await axios.get(`${BASE_URL}/ajax/v2/episode/servers?episodeId=${episodeId}`, { headers });
        const $$ = cheerio.load(serverRes.data.html);
        
        // Grab the first available server ID (usually Sub)
        const serverId = $$('.server-item').first().attr('data-id');
        if (!serverId) throw new Error('No video servers found.');

        // 2. Get the actual video source
        const sourceRes = await axios.get(`${BASE_URL}/ajax/v2/episode/sources?id=${serverId}`, { headers });
        
        // The API usually returns { link: "https://...", tracks: [...] }
        const videoUrl = sourceRes.data.link || sourceRes.data.sources?.[0]?.file;
        
        if (!videoUrl) throw new Error('Video source link not found in API response.');
        
        return videoUrl;
    } catch (error) {
        console.error('Video Source Error:', error.message);
        throw new Error('Failed to extract video URL. The site may have updated its player encryption.');
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };
