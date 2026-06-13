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

/**
 * Extracts the list of episodes from the WordPress series page
 */
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
                }            }
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

/**
 * Uses Puppeteer to load the episode page, find the video iframe/source, 
 * and intercept the .m3u8 or .mp4 video URL from the network traffic.
 */
async function getVideoSourceUrl(episodeUrl) {
    console.log(`[Debug] Launching Puppeteer to extract video URL from: ${episodeUrl}`);
    
    let browser;
    try {
        // 1. Launch browser with VPS-optimized flags
        browser = await puppeteer.launch({
            headless: true, 
            dumpio: true,   // Prints Chrome's internal logs to terminal
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--single-process',        
                '--no-zygote',             
                '--disable-extensions',
                '--disable-background-networking',
                '--no-first-run'
            ],
            timeout: 60000 
        });

        // 2. Create the page (This was missing in your previous edit!)
        const page = await browser.newPage();
        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });
        let videoUrl = null;

        // 3. Intercept network requests on the main page
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                if (!videoUrl) {
                    videoUrl = url;
                    console.log(`[Debug] ✅ Intercepted video URL: ${videoUrl}`);
                }
            }
        });

        console.log(`[Debug] Navigating to episode page...`);
        await page.goto(episodeUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // 4. Click "Play" buttons if the site hides the player
        const clickableSelectors = ['.btn-play', '.play-button', '.player-loading', 'a[href="#player"]', '.vscontrol'];
        for (const selector of clickableSelectors) {
            const el = await page.$(selector);
            if (el) {
                console.log(`[Debug] Clicking element to load player: ${selector}`);
                await el.click();
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // 5. Find the iframe or video source URL
        const iframeUrl = await page.evaluate(() => {
            const iframes = document.querySelectorAll('iframe');
            for (let iframe of iframes) {
                if (iframe.src && !iframe.src.includes('youtube') && !iframe.src.includes('disqus') && !iframe.src.includes('facebook')) {
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
                    } catch (e) {}
                }
            }
            
            const links = document.querySelectorAll('a[data-video], a[data-src], a[data-embed]');            for (let link of links) {
                const src = link.getAttribute('data-video') || link.getAttribute('data-src') || link.getAttribute('data-embed');
                if (src && src.startsWith('http')) return src;
            }

            const videos = document.querySelectorAll('video source, video');
            for (let vid of videos) {
                const src = vid.src || vid.getAttribute('src');
                if (src && (src.includes('.mp4') || src.includes('.m3u8'))) return src;
            }

            return null;
        });

        // 6. If an iframe was found, open it in a new tab to intercept its network requests
        if (iframeUrl) {
            console.log(`[Debug] ✅ Found iframe/video source: ${iframeUrl}`);

            const iframePage = await browser.newPage();
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

            console.log(`[Debug] Navigating to iframe...`);
            await iframePage.goto(iframeUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        } else {
            console.log(`[Debug] ⚠️ No iframe found. Relying solely on main page network interception.`);
        }

        // 7. Wait for the video player to initialize and request the stream
        console.log(`[Debug] Waiting for video player to load...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        if (!videoUrl) {
            throw new Error('Could not intercept .m3u8 or .mp4 URL. The site might be using a new player or blocking Puppeteer.');
        }

        return videoUrl;

    } catch (error) {
        console.error('Video Source Error:', error.message);        throw new Error(`Failed to extract video URL: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { getEpisodes, getVideoSourceUrl };