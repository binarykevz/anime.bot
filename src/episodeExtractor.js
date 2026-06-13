const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://anikai.watch';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE_URL}/`
};

async function getEpisodes(animeUrl) {
    try {
        console.log(`[Debug] Fetching anime page: ${animeUrl}`);
        const htmlRes = await axios.get(animeUrl, { headers, timeout: 10000 });
        const $ = cheerio.load(htmlRes.data);
        
        let animeId = null;

        // Strategy 1: Extract from URL (e.g., /watch/name-12345 or /name-12345)
        const urlMatch = animeUrl.match(/-([0-9]+)(?:\?|$|\/)/);
        if (urlMatch) animeId = urlMatch[1];

        // Strategy 2: #syncData div (Standard for AniWatch/Zoro clones)
        if (!animeId) {
            const syncData = $('#syncData');
            if (syncData.length) {
                animeId = syncData.attr('data-id') || syncData.attr('data-anime-id');
            }
        }

        // Strategy 3: Hidden inputs
        if (!animeId) {
            animeId = $('input#movie_id').val() || $('input#ani_id').val() || $('input#id').val();
        }

        // Strategy 4: Meta tags
        if (!animeId) {
            const metaUrl = $('meta[property="og:url"]').attr('content') || $('meta[property="al:web:url"]').attr('content');
            if (metaUrl) {
                const metaMatch = metaUrl.match(/-([0-9]+)(?:\?|$|\/)/);
                if (metaMatch) animeId = metaMatch[1];
            }
        }

        // Strategy 5: Inline scripts (JSON or variables)
        if (!animeId) {
            const scripts = $('script');
            for (let i = 0; i < scripts.length; i++) {                const scriptContent = $(scripts[i]).html();
                if (scriptContent) {
                    const match = scriptContent.match(/anime_id\s*=\s*['"]?(\d+)['"]?/i) || 
                                  scriptContent.match(/const\s+id\s*=\s*['"]?(\d+)['"]?/i) ||
                                  scriptContent.match(/"id"\s*:\s*["']?(\d+)["']?/i) ||
                                  scriptContent.match(/id:\s*(\d+)/i);
                    if (match) {
                        animeId = match[1];
                        break;
                    }
                }
            }
        }

        if (!animeId) {
            console.error('[Debug] Failed to find ID. HTML snippet:', $.html().substring(0, 500));
            throw new Error('Could not extract Anime ID from page. The site structure may have changed.');
        }

        console.log(`[Debug] ✅ Found Anime ID: ${animeId}`);

        // Strategy 6: Try different AJAX endpoints for episode list
        const endpoints = [
            `${BASE_URL}/ajax/v2/episode/list/${animeId}`,
            `${BASE_URL}/ajax/episode/list/${animeId}`
        ];

        let epHtml = null;
        for (const endpoint of endpoints) {
            try {
                console.log(`[Debug] Trying endpoint: ${endpoint}`);
                const epRes = await axios.get(endpoint, { 
                    headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 10000
                });
                
                if (epRes.data && epRes.data.html) {
                    epHtml = epRes.data.html;
                    break;
                } else if (epRes.data && typeof epRes.data === 'string' && epRes.data.includes('ss-list')) {
                    epHtml = epRes.data;
                    break;
                }
            } catch (e) {
                console.log(`[Debug] Endpoint failed: ${endpoint} - ${e.message}`);
            }
        }

        if (!epHtml) {
            throw new Error('Could not fetch episode list from any known AJAX endpoint.');        }

        const $$ = cheerio.load(epHtml);
        const episodes = [];
        
        // Try multiple selectors for episode items
        const epSelectors = ['.ss-list a', '.ep-item', '.episode-item', '.flw-item'];
        let foundEps = false;
        
        for (const selector of epSelectors) {
            const items = $$(selector);
            if (items.length > 0) {
                items.each((i, el) => {
                    const epNum = $$(el).find('.e-dinumber, .name, .film-name').text().trim() || 
                                  $$(el).attr('title') || 
                                  $$(el).text().trim() || 
                                  `Ep ${i + 1}`;
                    const epId = $$(el).attr('data-id') || $$(el).attr('data-episode-id') || $$(el).attr('href')?.match(/\/(\d+)/)?.[1];
                    
                    if (epId) {
                        episodes.push({ number: epNum, id: epId });
                        foundEps = true;
                    }
                });
                if (foundEps) break;
            }
        }

        if (episodes.length === 0) {
            console.error('[Debug] Episode HTML:', epHtml.substring(0, 500));
            throw new Error('Found episode container, but could not parse episode IDs.');
        }

        return episodes;

    } catch (error) {
        console.error('Episode Extraction Error:', error.message);
        throw new Error(`Failed to fetch episode list: ${error.message}`);
    }
}

async function getVideoSourceUrl(episodeId) {
    try {
        console.log(`[Debug] Fetching servers for episode ID: ${episodeId}`);
        
        const serverEndpoints = [
            `${BASE_URL}/ajax/v2/episode/servers?episodeId=${episodeId}`,
            `${BASE_URL}/ajax/episode/servers?episodeId=${episodeId}`
        ];
        let serverHtml = null;
        for (const endpoint of serverEndpoints) {
            try {
                const res = await axios.get(endpoint, { 
                    headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 10000
                });
                if (res.data && (res.data.html || typeof res.data === 'string')) {
                    serverHtml = res.data.html || res.data;
                    break;
                }
            } catch (e) { /* ignore */ }
        }

        if (!serverHtml) throw new Error('Could not fetch server list.');

        const $$ = cheerio.load(serverHtml);
        
        let serverId = $$('.server-item[data-type="sub"]').first().attr('data-id') || 
                       $$('.server-item').first().attr('data-id') ||
                       $$('.item').first().attr('data-id');

        if (!serverId) {
            console.error('[Debug] Server HTML:', serverHtml.substring(0, 500));
            throw new Error('No video servers found on the episode page.');
        }

        console.log(`[Debug] ✅ Found Server ID: ${serverId}`);

        const sourceEndpoints = [
            `${BASE_URL}/ajax/v2/episode/sources?id=${serverId}`,
            `${BASE_URL}/ajax/episode/sources?id=${serverId}`
        ];

        let videoUrl = null;
        for (const endpoint of sourceEndpoints) {
            try {
                const res = await axios.get(endpoint, { 
                    headers: { ...headers, 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 10000
                });
                if (res.data) {
                    videoUrl = res.data.link || res.data.sources?.[0]?.file || res.data.url;
                    if (videoUrl) break;
                }
            } catch (e) { /* ignore */ }
        }

        if (!videoUrl) {
            throw new Error('Video source link not found in API response.');        }

        console.log(`[Debug] ✅ Found Video URL`);
        return videoUrl;

    } catch (error) {
        console.error('Video Source Error:', error.message);
        throw new Error(`Failed to extract video URL: ${error.message}`);
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };