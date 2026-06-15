const fs = require('fs');
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
        if (!alMatch) throw new Error('Could not extract AniList ID from URL');
        const alId = alMatch[1];
        
        const query = `
            query($id: Int) {
                Media(id: $id, type: ANIME) {
                    id
                    idMal
                    episodes
                    title { english romaji }
                }
            }
        `;
        
        const response = await axios.post('https://graphql.anilist.co', {
            query: query,
            variables: { id: parseInt(alId, 10) }
        }, { headers: headers, timeout: 10000 });
        
        const data = response.data;        if (data.errors) throw new Error(data.errors[0].message);
        
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
        if (typeof episodeUrl !== 'string' || !episodeUrl.includes('http')) {
            throw new Error('Invalid episode URL provided: ' + episodeUrl);
        }

        const alMatch = episodeUrl.match(/[?&]al=(\d+)/);
        const epMatch = episodeUrl.match(/[?&]e=(\d+)/);
        if (!alMatch) throw new Error('Could not extract AniList ID from URL. URL: ' + episodeUrl);
        
        const alId = alMatch[1];
        const epNum = epMatch ? epMatch[1] : '1';
        
        const query = `query($id: Int) { Media(id: $id, type: ANIME) { idMal } }`;
        const response = await axios.post('https://graphql.anilist.co', {
            query: query,
            variables: { id: parseInt(alId, 10) }
        }, { headers: headers, timeout: 10000 });
        
        if (!response.data || !response.data.data || !response.data.data.Media) {            throw new Error('Invalid response from AniList API');
        }
        
        const malId = response.data.data.Media.idMal;
        
        const source = VIDEO_SOURCES[0];
        let videoPageUrl = source.base + source.path
            .replace('{al}', alId)
            .replace('{mal}', malId || '0')
            .replace('{e}', epNum);
        
        console.log('[Debug] 🎬 Video page URL:', videoPageUrl);

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
        
        // 🚀 LOG ALL NETWORK REQUESTS TO SEE WHAT THE PAGE IS DOING
        client.on('Network.responseReceived', function(event) {
            const url = event.response.url;
            const type = event.type;
            
            // Log all XHR/Fetch/Document requests
            if (type === 'XHR' || type === 'Fetch' || type === 'Document') {
                console.log(`[Net] ${type}: ${url.substring(0, 150)}`);
            }
            
            if (url.includes('.m3u8') || url.includes('.mp4')) {                if (!url.includes('ads') && !url.includes('preroll') && !url.includes('.woff')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted video URL via Network: ${videoUrl}`);
                    }
                }
            }
        });
        
        console.log('[Puppeteer] 🌐 Navigating to video page...');
        await page.goto(videoPageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Wait longer for player to render
        await new Promise(function(resolve) { setTimeout(resolve, 6000); });
        
        // 🚀 DEBUG: Dump HTML and Screenshot
        const htmlContent = await page.content();
        fs.writeFileSync('/tmp/megaplay_debug.html', htmlContent);
        await page.screenshot({ path: '/tmp/megaplay_debug.png', fullPage: true });
        console.log('[Debug] 📸 Saved debug screenshot to /tmp/megaplay_debug.png');
        console.log('[Debug] 📄 Saved debug HTML to /tmp/megaplay_debug.html');

        // 🚀 Try multiple ways to trigger play
        try {
            await page.evaluate(function() {
                const selectors = ['.btn-play', '.play-button', '.play', 'button', '.vjs-big-play-button', '.plyr__control', '.center-btn', '.jw-icon-display', 'video'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.click();
                        break;
                    }
                }
                // Click center of page
                document.body.click();
            });
        } catch (e) {}
        
        // Try pressing Spacebar (universal HTML5 play/pause toggle)
        await page.keyboard.press('Space');
        
        await new Promise(function(resolve) { setTimeout(resolve, 5000); });
        
        // 🚀 FALLBACK 1: Scan page scripts for hardcoded video URLs
        if (!videoUrl) {
            console.log('[Debug] 🔍 Network listener missed video URL. Scanning page scripts...');
            const scriptUrl = await page.evaluate(function() {
                const scripts = document.querySelectorAll('script');
                for (let script of scripts) {
                    const text = script.innerHTML;                    if (text.includes('.m3u8') || text.includes('.mp4')) {
                        const match = text.match(/(https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*)/);
                        if (match) return match[1];
                    }
                }
                return null;
            });
            if (scriptUrl) {
                videoUrl = scriptUrl;
                console.log(`[Debug] ✅ Found video URL in script tag: ${videoUrl}`);
            }
        }

        // 🚀 FALLBACK 2: Scan for iframes and video tags
        if (!videoUrl) {
            console.log('[Debug] 🔍 Scanning page for iframes and video tags...');
            const domData = await page.evaluate(function() {
                const iframes = [];
                document.querySelectorAll('iframe').forEach(function(iframe) {
                    if (iframe.src) iframes.push(iframe.src);
                });
                const videos = [];
                document.querySelectorAll('video, video source').forEach(function(v) {
                    if (v.src) videos.push(v.src);
                });
                return { iframes: iframes, videos: videos };
            });
            console.log('[Debug] 🔍 Found Iframes:', domData.iframes);
            console.log('[Debug] 🔍 Found Video Tags:', domData.videos);
            
            // If we found an iframe, that might be the real player!
            if (domData.iframes.length > 0) {
                console.log('[Debug] ⚠️ Video URL not found, but found iframe. The player might be inside this iframe.');
            }
        }
        
        if (!videoUrl) {
            throw new Error('Could not intercept video URL from player page. Check /tmp/megaplay_debug.png and terminal logs.');
        }
        
        return videoUrl;
        
    } catch (error) {
        console.error('[Debug] ❌ ERROR CAUGHT IN getVideoSourceUrl:', error.message);
        throw new Error('Failed to extract video URL: ' + error.message);
    } finally {
        if (browser) await browser.close();
        if (localProxyUrl) {
            try {
                await proxyChain.closeAnonymizedProxy(localProxyUrl, true);            } catch (e) {}
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };