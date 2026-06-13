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
    console.log(`[Debug] Launching Puppeteer to extract video URL from: ${episodeUrl}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, 
            dumpio: false, // Turned off to keep terminal clean and speed up I/O
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

        const page = await browser.newPage();
        
        // Block images, fonts, and unnecessary resources to speed up loading by 50%+
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {                req.continue();
            }
        });

        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });

        let videoUrl = null;

        // Intercept network requests immediately
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                if (!videoUrl) {
                    videoUrl = url;
                    console.log(`[Debug] ✅ Intercepted video URL: ${videoUrl}`);
                }
            }
        });

        console.log(`[Debug] Navigating to episode page (fast mode)...`);
        // CRITICAL CHANGE: Use 'domcontentloaded' instead of 'networkidle2'
        await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Quick click on play buttons if they exist
        try {
            const playBtn = await page.$('.btn-play, .play-button, a[href="#player"]');
            if (playBtn) {
                await playBtn.click().catch(() => {}); // Ignore if unclickable
            }
        } catch (e) {}

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
                        const match = decoded.match(/src="([^"]+)"/);
                        if (match && match[1]) return match[1];
                    } catch (e) {}                }
            }
            return null;
        });

        if (iframeUrl) {
            console.log(`[Debug] ✅ Found iframe: ${iframeUrl}`);

            const iframePage = await browser.newPage();
            
            // Also block heavy resources in the iframe
            await iframePage.setRequestInterception(true);
            iframePage.on('request', (req) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await iframePage.setUserAgent(headers['User-Agent']);
            await iframePage.setExtraHTTPHeaders({ 'Referer': episodeUrl });

            iframePage.on('response', async (response) => {
                const url = response.url();
                if (url.includes('.m3u8') || url.includes('.mp4')) {
                    if (!videoUrl) {
                        videoUrl = url;
                        console.log(`[Debug] ✅ Intercepted video URL from iframe: ${videoUrl}`);
                    }
                }
            });

            console.log(`[Debug] Navigating to iframe (fast mode)...`);
            await iframePage.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }

        // Short wait just to ensure the player JS has time to fire the .m3u8 request
        console.log(`[Debug] Waiting briefly for player initialization...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (!videoUrl) {
            throw new Error('Could not intercept .m3u8 or .mp4 URL. The site might be blocking Puppeteer or using a new player.');
        }

        return videoUrl;

    } catch (error) {
        console.error('Video Source Error:', error.message);
        throw new Error(`Failed to extract video URL: ${error.message}`);    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };