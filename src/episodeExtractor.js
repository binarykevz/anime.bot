const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

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
        
        let slugMatch = animeUrl.match(/\/([^/]+?)(?:-episode-\d+|-ep-\d+)?(?:-in-english-(?:subbed|dubbed))?\/?$/i);
        let slug = slugMatch ? slugMatch[1] : animeUrl.split('/').filter(Boolean).pop();
        
        let seriesUrl = animeUrl;
        if (animeUrl.includes('-episode-') || animeUrl.includes('-ep-')) {
            seriesUrl = `${BASE_URL}/series/${slug}/`;
        }

        console.log(`[Debug] Fetching series page: ${seriesUrl}`);
        let htmlRes;
        try {
            htmlRes = await axios.get(seriesUrl, { headers, timeout: 10000 });
        } catch (err) {
            console.log(`[Debug] Series URL failed, trying fallback: ${BASE_URL}/${slug}/`);
            seriesUrl = `${BASE_URL}/${slug}/`;
            htmlRes = await axios.get(seriesUrl, { headers, timeout: 10000 });
        }
        
        const $ = cheerio.load(htmlRes.data);
        const episodes = [];
        
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('-episode-') || href.includes('-ep-')) && href.includes(BASE_URL)) {
                const epNumMatch = href.match(/(?:-episode-|-ep-)(\d+)/i);
                const epNum = epNumMatch ? epNumMatch[1] : `Ep ${i + 1}`;
                
                if (!episodes.find(ep => ep.url === href)) {
                    episodes.push({ number: epNum, url: href, id: href });
                }
            }
        });
        if (episodes.length === 0) {
            console.log(`[Debug] No episodes found on series page. Assuming the provided URL is the target.`);
            const epNumMatch = animeUrl.match(/(?:-episode-|-ep-)(\d+)/i);
            const epNum = epNumMatch ? epNumMatch[1] : '1';
            episodes.push({ number: epNum, url: animeUrl, id: animeUrl });
        }

        console.log(`[Debug] ✅ Found ${episodes.length} episodes.`);
        return episodes;

    } catch (error) {
        console.error('Episode Extraction Error:', error.message);
        throw new Error(`Failed to fetch episode list: ${error.message}`);
    }
}

async function getVideoSourceUrl(episodeUrl) {
    console.log(`[Debug] Launching Puppeteer (Safe Extraction) for: ${episodeUrl}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, 
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote', '--disable-extensions',
                '--disable-background-networking', '--disable-default-apps',
                '--no-first-run', '--disable-sync', '--disable-translate',
                '--metrics-recording-only', '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection', '--disable-blink-features=AutomationControlled'
            ],
            timeout: 30000 
        });

        const page = await browser.newPage();
        
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });

        // 🛡️ SAFE RESOURCE BLOCKER: Only blocks heavy assets, NEVER blocks scripts or API calls
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.isInterceptResolutionHandled()) return;
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                return req.abort();            }
            return req.continue();
        });

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');

        let videoUrl = null;
        let playerUrl = null;

        // 🚀 MAIN PAGE CDP LISTENER
        client.on('Network.responseReceived', (event) => {
            const url = event.response.url;
            const type = event.type;
            
            // 1. Catch direct video files
            if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts')) {
                if (!url.includes('ads') && !url.includes('preroll') && !url.includes('tracking') && !url.includes('.woff')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted direct video URL: ${videoUrl}`);
                    }
                }
            }
            
            // 2. Catch the video host document (e.g., megaplay.buzz)
            if (type === 'Document' && !url.includes('anikai.watch') && !url.includes('cloudflare') && !url.includes('google')) {
                if (url.includes('megaplay') || url.includes('stream') || url.includes('player') || url.includes('video') || url.includes('embed') || url.includes('buzz')) {
                    if (!playerUrl) {
                        playerUrl = url;
                        console.log(`[Debug] ✅ Intercepted Video Host Document: ${playerUrl}`);
                    }
                }
            }
        });

        console.log(`[Debug] Navigating to episode page...`);
        await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Wait for JS to render the player
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Try to click play button
        await page.evaluate(() => {
            const btn = document.querySelector('.btn-play, .play-button, a[href="#player"], .vscontrol, .play-btn, button, .player-overlay, .play');
            if (btn) btn.click();
        }).catch(() => {});

        await new Promise(resolve => setTimeout(resolve, 3000));
        if (videoUrl) {
            console.log(`[Debug] ⏭️ Success: Direct video URL captured!`);
            return videoUrl;
        }

        // 🚀 IF WE FOUND THE PLAYER HOST, OPEN IT IN A NEW TAB
        if (playerUrl) {
            console.log(`[Debug] Opening Video Host in new tab: ${playerUrl}`);
            const playerPage = await browser.newPage();
            
            await playerPage.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });
            await playerPage.setUserAgent(headers['User-Agent']);
            await playerPage.setExtraHTTPHeaders({ 'Referer': episodeUrl });
            
            // 🛡️ SAFE RESOURCE BLOCKER for the player page too
            await playerPage.setRequestInterception(true);
            playerPage.on('request', (req) => {
                if (req.isInterceptResolutionHandled()) return;
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                    return req.abort();
                }
                return req.continue();
            });

            const playerClient = await playerPage.target().createCDPSession();
            await playerClient.send('Network.enable');

            playerClient.on('Network.responseReceived', (event) => {
                const url = event.response.url;
                if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts')) {
                    if (!url.includes('ads') && !url.includes('preroll') && !url.includes('tracking') && !url.includes('.woff')) {
                        if (!videoUrl) {
                            videoUrl = url;
                            console.log(`[Debug] ✅ Intercepted video URL from player host: ${videoUrl}`);
                        }
                    }
                }
            });

            await playerPage.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Try clicking play on the player page
            await playerPage.evaluate(() => {
                const btn = document.querySelector('.btn-play, .play-button, .play, button, .vjs-big-play-button, .plyr__control, .video-js, .center-btn');
                if (btn) btn.click();
            }).catch(() => {});

            // Wait for the stream to start            await new Promise(resolve => setTimeout(resolve, 5000));
            
            if (videoUrl) {
                console.log(`[Debug] ⏭️ Success: Video URL captured from player host!`);
                return videoUrl;
            }
        }

        throw new Error('Could not intercept video URL from main page or player host.');

    } catch (error) {
        console.error('Video Source Error:', error.message);
        throw new Error(`Failed to extract video URL: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };