const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE_URL = 'https://anikai.watch';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE_URL}/`
};

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
    console.log(`[Debug] Launching Puppeteer (Deep Debug Mode) for: ${episodeUrl}`);
    
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

        await page.setUserAgent(headers['User-Agent']);        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        await client.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });

        let videoUrl = null;
        let allRequests = [];

        // 🚀 LOG EVERY NETWORK REQUEST
        client.on('Network.responseReceived', (event) => {
            const url = event.response.url;
            const type = event.type;
            allRequests.push({ type, url });
            
            // Log everything except standard WP assets
            if (!url.includes('.css') && !url.includes('.js') && !url.includes('.png') && !url.includes('.jpg') && !url.includes('.woff')) {
                console.log(`[Net] ${type}: ${url.substring(0, 150)}`);
            }

            // Strict video check
            const isVideoFile = url.includes('.m3u8') || url.includes('.mp4') || url.includes('.ts');
            const isNotAsset = !url.includes('.woff') && !url.includes('.css') && !url.includes('.js') && 
                               !url.includes('.png') && !url.includes('.jpg') && !url.includes('.svg');

            if (isVideoFile && isNotAsset) {
                if (!url.includes('ads') && !url.includes('preroll') && !url.includes('tracking')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted STRICT video URL via CDP: ${videoUrl}`);
                    }
                }
            }
        });

        console.log(`[Debug] Navigating to episode page...`);
        await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Wait longer for JS to render the player
        console.log(`[Debug] Waiting 5 seconds for player to render...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 🚀 DUMP PAGE HTML FOR INSPECTION
        const htmlContent = await page.content();
        fs.writeFileSync('/tmp/anikai_page.html', htmlContent);
        console.log(`[Debug] 📄 Page HTML dumped to /tmp/anikai_page.html`);

        // Try to click play button
        await page.evaluate(() => {
            const selectors = ['.btn-play', '.play-button', 'a[href="#player"]', '.vscontrol', '.play-btn', 'button', '.player-overlay'];            for (const selector of selectors) {
                const btn = document.querySelector(selector);
                if (btn) { 
                    btn.click(); 
                    console.log(`[Debug] Clicked: ${selector}`);
                    break; 
                }
            }
        }).catch(() => {});

        await new Promise(resolve => setTimeout(resolve, 3000));

        if (videoUrl) {
            console.log(`[Debug] ⏭️ Success: Real video URL captured by CDP!`);
            return videoUrl;
        }

        // 🚀 DEEP DOM SCAN: Find ANY iframe, video tag, or base64 string
        console.log(`[Debug] Performing deep DOM scan...`);
        const domData = await page.evaluate(() => {
            const data = { iframes: [], videos: [], scripts: [], base64: [] };
            
            // 1. Find ALL iframes
            document.querySelectorAll('iframe').forEach(iframe => {
                data.iframes.push(iframe.src || iframe.getAttribute('data-src'));
            });
            
            // 2. Find ALL video tags
            document.querySelectorAll('video, video source').forEach(vid => {
                data.videos.push(vid.src || vid.getAttribute('src'));
            });

            // 3. Find ALL script tags containing URLs
            document.querySelectorAll('script').forEach(script => {
                const text = script.innerHTML;
                if (text.includes('http') && text.length < 5000) {
                    data.scripts.push(text.substring(0, 500));
                }
            });

            // 4. Find base64 strings in select options
            document.querySelectorAll('select option').forEach(opt => {
                const val = opt.value;
                if (val && val.length > 50) {
                    try {
                        const decoded = atob(val);
                        data.base64.push(decoded);
                    } catch (e) {}
                }
            });
            return data;
        }).catch(() => null);

        if (domData) {
            console.log(`[Debug] 🔍 Found ${domData.iframes.length} iframes:`, domData.iframes);
            console.log(`[Debug] 🔍 Found ${domData.videos.length} video tags:`, domData.videos);
            console.log(`[Debug] 🔍 Found ${domData.base64.length} base64 strings.`);
            
            if (domData.iframes.length > 0) {
                videoUrl = domData.iframes[0];
                console.log(`[Debug] ✅ Using first iframe found: ${videoUrl}`);
                return videoUrl;
            }
            if (domData.videos.length > 0) {
                videoUrl = domData.videos[0];
                console.log(`[Debug] ✅ Using first video tag found: ${videoUrl}`);
                return videoUrl;
            }
        }

        if (!videoUrl) {
            console.error(`[Debug] ❌ FAILED: No video URL found.`);
            console.error(`[Debug] Total network requests captured: ${allRequests.length}`);
            throw new Error('Could not intercept video URL. Check /tmp/anikai_page.html and the network logs above.');
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