const { gotScraping } = require('got-scraping');
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
        
        const response = await gotScraping.post('https://graphql.anilist.co', {
            json: {                query: query,
                variables: { id: parseInt(alId) }
            },
            responseType: 'json',
            timeout: { request: 10000 },
            headers: headers
        });
        
        const data = response.body;
        
        if (data.errors) {
            throw new Error(data.errors[0].message);
        }
        
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
        
        console.log(`[Debug] ✅ Generated ${episodes.length} episodes.`);
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
        const alMatch = episodeUrl.match(/[?&]al=(\d+)/);
        const epMatch = episodeUrl.match(/[?&]e=(\d+)/);
        
        if (!alMatch) {            throw new Error('Could not extract AniList ID from URL');
        }
        
        const alId = alMatch[1];
        const epNum = epMatch ? epMatch[1] : '1';
        
        const query = `
            query($id: Int) {
                Media(id: $id, type: ANIME) {
                    idMal
                }
            }
        `;
        
        const response = await gotScraping.post('https://graphql.anilist.co', {
            json: {
                query: query,
                variables: { id: parseInt(alId) }
            },
            responseType: 'json',
            timeout: { request: 10000 },
            headers: headers
        });
        
        const malId = response.body.data.Media.idMal;
        
        const source = VIDEO_SOURCES[0];
        let videoPageUrl = source.base + source.path
            .replace('{al}', alId)
            .replace('{mal}', malId || '')
            .replace('{e}', epNum);
        
        console.log(`[Debug] 🎬 Video page URL: ${videoPageUrl}`);
        
        console.log('[Puppeteer] 🌐 Setting up local proxy forwarder for ' + proxyConfig.ipPort + '...');
        localProxyUrl = await proxyChain.anonymizeProxy({
            host: proxyConfig.ipPort.split(':')[0],
            port: parseInt(proxyConfig.ipPort.split(':')[1]),
            username: proxyConfig.username,
            password: proxyConfig.password
        });
        console.log('[Puppeteer] ✅ Local proxy running at: ' + localProxyUrl);
        
        const launchArgs = [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--no-zygote', '--disable-extensions',
            '--disable-background-networking', '--disable-blink-features=AutomationControlled',
            '--proxy-server=' + localProxyUrl
        ];
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
        } catch (e) {}
        
        await new Promise(function(resolve) { setTimeout(resolve, 3000); });
        
        if (!videoUrl) {
            throw new Error('Could not intercept video URL from player page.');
        }
        
        return videoUrl;
        
    } catch (error) {
        throw new Error('Failed to extract video URL: ' + error.message);
    } finally {
        if (browser) await browser.close();        if (localProxyUrl) {
            await proxyChain.closeAnonymizedProxy(localProxyUrl, true);
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };