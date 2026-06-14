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

// 🛡️ CDP Blocklist: Wildcards are supported natively by Chrome
const BLOCKED_URLS = [
    '*doubleclick.net*', '*googlesyndication.com*', '*adservice.google.com*',
    '*popads.net*', '*popcash.net*', '*adnxs.com*', '*advertising.com*',
    '*google-analytics.com*', '*googletagmanager.com*', '*propellerads*', 
    '*exoclick*', '*juicyads*', '*analytics*', '*tracker*'
];

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
                const epNumMatch = href.match(/(?:-episode-|-ep-)(\d+)/i);                const epNum = epNumMatch ? epNumMatch[1] : `Ep ${i + 1}`;
                
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
    console.log(`[Debug] Launching Puppeteer (CDP AdBlocker) to extract video URL from: ${episodeUrl}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--single-process',        
                '--no-zygote',             
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--no-first-run',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only'
            ],
            timeout: 30000 
        });

        const page = await browser.newPage();        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });

        // 🚀 CDP SETUP: The bulletproof way to block ads without race conditions
        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        
        // Block ads at the browser engine level (No Node.js interception lag!)
        await client.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });

        let videoUrl = null;

        // Listen for network responses to catch the .m3u8 or .mp4
        client.on('Network.responseReceived', (event) => {
            const url = event.response.url;
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                if (url.length > 30 && !url.includes('ads') && !url.includes('tracking')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted video URL via CDP: ${videoUrl}`);
                    }
                }
            }
        });

        console.log(`[Debug] Navigating to episode page (fast + CDP adblocked)...`);
        await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Quick click on play buttons if they exist
        const playBtn = await page.$('.btn-play, .play-button, a[href="#player"], .vscontrol');
        if (playBtn) {
            await playBtn.click().catch(() => {}); 
        }

        // Find the iframe or video source URL
        const iframeUrl = await page.evaluate(() => {
            const iframes = document.querySelectorAll('iframe');
            for (let iframe of iframes) {
                if (iframe.src && !iframe.src.includes('youtube') && !iframe.src.includes('disqus') && !iframe.src.includes('facebook') && !iframe.src.includes('google')) {
                    return iframe.src;
                }
            }
            
            const options = document.querySelectorAll('select option');
            for (let opt of options) {
                const val = opt.value;
                if (val && val.length > 50) {
                    try {
                        const decoded = atob(val); 
                        const match = decoded.match(/src="([^"]+)"/);                        if (match && match[1]) return match[1];
                    } catch (e) {}
                }
            }
            return null;
        });

        if (iframeUrl) {
            console.log(`[Debug] ✅ Found iframe: ${iframeUrl}`);

            const iframePage = await browser.newPage();
            await iframePage.setUserAgent(headers['User-Agent']);
            await iframePage.setExtraHTTPHeaders({ 'Referer': episodeUrl });

            // 🚀 Apply SAME CDP AdBlocker to the iframe page
            const iframeClient = await iframePage.target().createCDPSession();
            await iframeClient.send('Network.enable');
            await iframeClient.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });

            iframeClient.on('Network.responseReceived', (event) => {
                const url = event.response.url;
                if (url.includes('.m3u8') || url.includes('.mp4')) {
                    if (url.length > 30 && !url.includes('ads') && !url.includes('tracking')) {
                        if (!videoUrl) {
                            videoUrl = url;
                            console.log(`[Debug] ✅ Intercepted video URL from iframe via CDP: ${videoUrl}`);
                        }
                    }
                }
            });

            console.log(`[Debug] Navigating to iframe (fast + CDP adblocked)...`);
            await iframePage.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }

        // Short wait to ensure the player JS has time to fire the .m3u8 request
        console.log(`[Debug] Waiting briefly for player initialization...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (!videoUrl) {
            throw new Error('Could not intercept .m3u8 or .mp4 URL. The site might be blocking Puppeteer or using a new player.');
        }

        return videoUrl;

    } catch (error) {
        console.error('Video Source Error:', error.message);
        throw new Error(`Failed to extract video URL: ${error.message}`);
    } finally {
        if (browser) {            await browser.close();
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };