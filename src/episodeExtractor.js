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

// 🛡️ Refined Blocklist: Removed generic '*analytics*' and '*tracker*' to prevent blocking legitimate video CDNs
const BLOCKED_URLS = [
    '*doubleclick.net*', '*googlesyndication.com*', '*adservice.google.com*',
    '*popads.net*', '*popcash.net*', '*adnxs.com*', '*advertising.com*',
    '*google-analytics.com*', '*googletagmanager.com*', '*propellerads*', 
    '*exoclick*', '*juicyads*'
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
    console.log(`[Debug] Launching Puppeteer (Anti-Detect + Debug Mode) for: ${episodeUrl}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, 
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--no-first-run',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--disable-blink-features=AutomationControlled' // 🛡️ Anti-detection
            ],
            timeout: 30000         });

        const page = await browser.newPage();
        
        // 🛡️ Anti-Detection: Spoof webdriver
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        await client.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });

        let videoUrl = null;

        // 🚀 Enhanced CDP Listener: Logs ALL media/XHR requests to help us debug
        client.on('Network.responseReceived', (event) => {
            const url = event.response.url;
            const type = event.type; // 'Media', 'XHR', 'Fetch', 'Document', etc.
            
            // Log all media or data requests for debugging
            if (type === 'Media' || type === 'XHR' || type === 'Fetch') {
                console.log(`[Debug] Network ${type}: ${url.substring(0, 120)}...`);
            }

            // Catch video streams
            if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts') || url.includes('video') || url.includes('stream')) {
                if (url.length > 30 && !url.includes('ads') && !url.includes('preroll') && !url.includes('tracking')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted potential video URL via CDP: ${videoUrl}`);
                    }
                }
            }
        });

        console.log(`[Debug] Navigating to episode page...`);
        await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Wait for player to render
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Try to click play button
        try {
            await page.evaluate(() => {
                const selectors = ['.btn-play', '.play-button', 'a[href="#player"]', '.vscontrol', '.play-btn'];
                for (const selector of selectors) {                    const btn = document.querySelector(selector);
                    if (btn) {
                        btn.click();
                        break;
                    }
                }
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (e) {
            console.log(`[Debug] ⚠️ Click ignored or context destroyed.`);
        }

        // 🚀 EARLY EXIT: If CDP caught it, we're done!
        if (videoUrl) {
            console.log(`[Debug] ⏭️ Success: Video URL captured by CDP!`);
            return videoUrl;
        }

        // 🚀 FALLBACK 1: Scan all <script> tags for hardcoded .m3u8 or .mp4 links
        console.log(`[Debug] Checking script tags for video URLs...`);
        const scriptVideoUrl = await page.evaluate(() => {
            const scripts = document.querySelectorAll('script');
            for (let script of scripts) {
                const text = script.innerHTML;
                if (text.includes('.m3u8') || text.includes('.mp4')) {
                    const match = text.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/);
                    if (match) return match[1];
                }
            }
            return null;
        });

        if (scriptVideoUrl && !videoUrl) {
            videoUrl = scriptVideoUrl;
            console.log(`[Debug] ✅ Found video URL in script tag: ${videoUrl}`);
            return videoUrl;
        }

        // 🚀 FALLBACK 2: Check for iframes if we still haven't found it
        let iframeUrl = null;
        try {
            iframeUrl = await page.evaluate(() => {
                const iframes = document.querySelectorAll('iframe');
                for (let iframe of iframes) {
                    if (iframe.src && !iframe.src.includes('youtube') && !iframe.src.includes('disqus') && !iframe.src.includes('facebook') && !iframe.src.includes('google')) {
                        return iframe.src;
                    }
                }
                
                const options = document.querySelectorAll('select option');                for (let opt of options) {
                    const val = opt.value;
                    if (val && val.length > 50) {
                        try {
                            const decoded = atob(val); 
                            const match = decoded.match(/src="([^"]+)"/);
                            if (match && match[1]) return match[1];
                        } catch (e) {}
                    }
                }
                return null;
            });
        } catch (e) {
            console.log(`[Debug] ⚠️ Could not evaluate DOM.`);
        }

        if (iframeUrl && !videoUrl) {
            console.log(`[Debug] ✅ Found iframe, opening to intercept: ${iframeUrl}`);

            const iframePage = await browser.newPage();
            await iframePage.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });
            await iframePage.setUserAgent(headers['User-Agent']);
            await iframePage.setExtraHTTPHeaders({ 'Referer': episodeUrl });

            const iframeClient = await iframePage.target().createCDPSession();
            await iframeClient.send('Network.enable');
            await iframeClient.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });

            iframeClient.on('Network.responseReceived', (event) => {
                const url = event.response.url;
                const type = event.type;
                if (type === 'Media' || type === 'XHR' || type === 'Fetch') {
                    console.log(`[Debug] Iframe Network ${type}: ${url.substring(0, 120)}...`);
                }
                if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts') || url.includes('video') || url.includes('stream')) {
                    if (url.length > 30 && !url.includes('ads') && !url.includes('preroll') && !url.includes('tracking')) {
                        if (!videoUrl) {
                            videoUrl = url;
                            console.log(`[Debug] ✅ Intercepted video URL from iframe via CDP: ${videoUrl}`);
                        }
                    }
                }
            });

            console.log(`[Debug] Navigating to iframe...`);
            try {
                await iframePage.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await new Promise(resolve => setTimeout(resolve, 3000));            } catch (e) {
                console.log(`[Debug] ⚠️ Iframe navigation error.`);
            }
        }

        if (!videoUrl) {
            console.error(`[Debug] ❌ FAILED: No video URL found. Check the network logs above to see what the site is actually loading.`);
            throw new Error('Could not intercept video URL. The site may be blocking Puppeteer or using a new player.');
        }

        return videoUrl;

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