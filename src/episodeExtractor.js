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
                    id idMal episodes title { english romaji }
                }
            }
        `;
        
        const response = await axios.post('https://graphql.anilist.co', {
            query: query,
            variables: { id: parseInt(alId, 10) }
        }, { headers: headers, timeout: 10000 });
        
        const data = response.data;
        if (data.errors) throw new Error(data.errors[0].message);
        
        const animeData = data.data.Media;        const malId = animeData.idMal;
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
        
        if (!response.data || !response.data.data || !response.data.data.Media) {
            throw new Error('Invalid response from AniList API');
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
        
        let videoUrl = null;
        
        // 🚀 CRITICAL FIX: Intercept the API RESPONSE directly!
        page.on('response', async function(response) {
            const url = response.url();
            
            // Catch the getSources or getSourcesNew API call
            if (url.includes('getSources')) {
                console.log(`[Debug] 🎯 Intercepted API response: ${url}`);
                try {
                    const json = await response.json();
                    console.log(`[Debug] 📦 API JSON Keys:`, Object.keys(json));
                    
                    if (json.sources) {
                        console.log(`[Debug] 📦 Sources structure:`, typeof json.sources, Array.isArray(json.sources) ? 'Array' : 'Object');
                        console.log(`[Debug] 📦 Sources preview:`, JSON.stringify(json.sources).substring(0, 300));
                        
                        // Extract URL based on different possible JSON structures
                        if (json.sources.file) {                            videoUrl = json.sources.file;
                        } else if (Array.isArray(json.sources) && json.sources.length > 0) {
                            if (json.sources[0].url) videoUrl = json.sources[0].url;
                            else if (json.sources[0].file) videoUrl = json.sources[0].file;
                        }
                        
                        if (videoUrl) {
                            console.log(`[Debug] ✅ SUCCESS! Extracted video URL from API response: ${videoUrl}`);
                        }
                    }
                } catch (e) {
                    console.log('[Debug] ⚠️ Could not parse API JSON:', e.message);
                }
            }
        });
        
        console.log('[Puppeteer] 🌐 Navigating to video page...');
        await page.goto(videoPageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Wait for the page to make the API call
        await new Promise(function(resolve) { setTimeout(resolve, 8000); });
        
        if (!videoUrl) {
            // Fallback: Check if the URL is hardcoded in the page scripts
            console.log('[Debug] 🔍 API interception failed. Scanning page scripts...');
            const scriptUrl = await page.evaluate(function() {
                const scripts = document.querySelectorAll('script');
                for (let script of scripts) {
                    const text = script.innerHTML;
                    if (text.includes('.m3u8') || text.includes('.mp4')) {
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

        if (!videoUrl) {
            throw new Error('Could not intercept video URL from API response or page scripts.');
        }
        
        return videoUrl;
        
    } catch (error) {
        console.error('[Debug] ❌ ERROR CAUGHT IN getVideoSourceUrl:', error.message);        throw new Error('Failed to extract video URL: ' + error.message);
    } finally {
        if (browser) await browser.close();
        if (localProxyUrl) {
            try {
                await proxyChain.closeAnonymizedProxy(localProxyUrl, true);
            } catch (e) {}
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };