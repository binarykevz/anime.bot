const axios = require('axios');
const puppeteer = require('puppeteer');
const proxyChain = require('proxy-chain');

const BASE_URL = 'https://anidoor.me';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': BASE_URL + '/'
};

const VIDEO_SOURCES = [
    {
        id: "megaplay-sub",
        name: "MegaPlay Sub",
        base: "https://megaplay.buzz",
        path: "/stream/ani/{al}/{e}/sub",
        type: "anime",
        dub: false,
        default: true
    }
];

async function getEpisodes(watchUrl) {
    try {
        console.log(`[Debug] Fetching episodes from: ${watchUrl}`);
        
        const alMatch = watchUrl.match(/[?&]al=(\d+)/);
        if (!alMatch) {
            throw new Error('Could not extract AniList ID from URL');
        }
        const alId = alMatch[1];
        
        const query = `
            query($id: Int) {
                Media(id: $id, type: ANIME) {
                    id
                    idMal
                    episodes
                    title {
                        english
                        romaji
                    }
                }
            }
        `;
        
        const response = await axios.post('https://graphql.anilist.co', {
            query: query,            variables: { id: parseInt(alId, 10) }
        }, {
            headers: headers,
            timeout: 10000
        });
        
        const data = response.data;
        if (data.errors) throw new Error(data.errors[0].message);
        
        const animeData = data.data.Media;
        const malId = animeData.idMal;
        const totalEps = animeData.episodes || 12;
        const title = animeData.title.english || animeData.title.romaji || 'Unknown';
        
        console.log(`[Debug] ✅ Found anime: ${title} (MAL ID: ${malId}, Episodes: ${totalEps})`);
        
        const episodes = [];
        for (let i = 1; i <= totalEps; i++) {
            episodes.push({
                number: i.toString(),
                url: `${BASE_URL}/watch/?al=${alId}&e=${i}`,
                id: `${alId}-${i}`,
                alId: alId,
                malId: malId
            });
        }
        
        return episodes;
    } catch (error) {
        console.error('Episode Extraction Error:', error.message);
        throw new Error(`Failed to fetch episode list: ${error.message}`);
    }
}

async function getVideoSourceUrl(episodeUrl, proxyConfig) {
    let browser;
    let localProxyUrl = null;
    
    try {
        console.log('[Debug] 1. Starting getVideoSourceUrl. episodeUrl:', String(episodeUrl));
        
        if (typeof episodeUrl !== 'string' || !episodeUrl.includes('http')) {
            throw new Error('Invalid episode URL provided: ' + episodeUrl);
        }

        const alMatch = episodeUrl.match(/[?&]al=(\d+)/);
        const epMatch = episodeUrl.match(/[?&]e=(\d+)/);
        
        if (!alMatch) {
            throw new Error('Could not extract AniList ID from URL. URL: ' + episodeUrl);        }
        
        const alId = alMatch[1];
        const epNum = epMatch ? epMatch[1] : '1';
        console.log('[Debug] 2. Extracted alId:', alId, 'epNum:', epNum);
        
        const query = `
            query($id: Int) {
                Media(id: $id, type: ANIME) {
                    idMal
                }
            }
        `;
        
        console.log('[Debug] 3. Querying AniList for MAL ID...');
        const response = await axios.post('https://graphql.anilist.co', {
            query: query,
            variables: { id: parseInt(alId, 10) }
        }, {
            headers: headers,
            timeout: 10000
        });
        
        if (!response.data || !response.data.data || !response.data.data.Media) {
            throw new Error('Invalid response from AniList API');
        }
        
        const malId = response.data.data.Media.idMal;
        console.log('[Debug] 4. Extracted malId:', malId);
        
        const source = VIDEO_SOURCES[0];
        let videoPageUrl = source.base + source.path
            .replace('{al}', alId)
            .replace('{mal}', malId || '0')
            .replace('{e}', epNum);
        
        console.log('[Debug] 5. 🎬 Constructed Video page URL:', videoPageUrl);

        // Validate URL before passing to puppeteer
        try {
            new URL(videoPageUrl);
        } catch (e) {
            throw new Error('Constructed videoPageUrl is invalid: ' + videoPageUrl);
        }
        
        console.log('[Debug] 6. Proxy Config IP:', proxyConfig.ipPort);

        // 🚀 FIX: proxy-chain.anonymizeProxy expects a FULL URL STRING, not an object!
        const proxyUrlString = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.ipPort}`;
                console.log('[Puppeteer] 🌐 Setting up local proxy forwarder...');
        localProxyUrl = await proxyChain.anonymizeProxy(proxyUrlString);
        console.log('[Puppeteer] ✅ Local proxy running at: ' + localProxyUrl);
        
        const launchArgs = [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--no-zygote', '--disable-extensions',
            '--disable-background-networking', '--disable-blink-features=AutomationControlled',
            '--proxy-server=' + localProxyUrl
        ];
        
        console.log('[Debug] 7. Launching Puppeteer...');
        browser = await puppeteer.launch({
            headless: true, ignoreHTTPSErrors: true,
            args: launchArgs, timeout: 30000
        });
        
        const page = await browser.newPage();
        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': BASE_URL + '/' });
        
        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        
        let videoUrl = null;
        
        client.on('Network.responseReceived', function(event) {
            const url = event.response.url;
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                if (!url.includes('ads') && !url.includes('preroll') && !url.includes('.woff')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted video URL: ${videoUrl}`);
                    }
                }
            }
        });
        
        console.log('[Puppeteer] 🌐 Navigating to video page...');
        await page.goto(videoPageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        await new Promise(function(resolve) { setTimeout(resolve, 5000); });
        
        try {
            await page.evaluate(function() {
                const btn = document.querySelector('.btn-play, .play-button, .play, button, .vjs-big-play-button');
                if (btn) btn.click();
            });
        } catch (e) {
            console.log('[Debug] Play button click failed or not found:', e.message);        }
        
        await new Promise(function(resolve) { setTimeout(resolve, 3000); });
        
        if (!videoUrl) {
            throw new Error('Could not intercept video URL from player page.');
        }
        
        return videoUrl;
        
    } catch (error) {
        console.error('[Debug] ❌ ERROR CAUGHT IN getVideoSourceUrl:', error);
        throw new Error('Failed to extract video URL: ' + error.message);
    } finally {
        if (browser) await browser.close();
        if (localProxyUrl) {
            try {
                await proxyChain.closeAnonymizedProxy(localProxyUrl, true);
            } catch (e) {
                console.error('[Debug] Failed to close proxy:', e.message);
            }
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };