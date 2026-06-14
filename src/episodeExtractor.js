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
    console.log(`[Debug] Launching Puppeteer (API Direct Strike) for: ${episodeUrl}`);
    
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

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');

        let playerUrl = null;

        client.on('Network.responseReceived', (event) => {            const url = event.response.url;
            const type = event.type;
            
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

        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
            await page.evaluate(() => {
                const btn = document.querySelector('.btn-play, .play-button, a[href="#player"], .vscontrol, .play-btn, button, .player-overlay, .play');
                if (btn) btn.click();
            });
        } catch (e) {
            console.log(`[Debug] Play button click failed or context destroyed.`);
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        if (!playerUrl) {
            throw new Error('Could not intercept video host URL from main page.');
        }

        console.log(`[Debug] Extracting ID from player URL: ${playerUrl}`);
        
        let videoId = null;
        
        const streamMatch = playerUrl.match(/\/(?:stream|embed)[^/]*\/(\d+)/);
        if (streamMatch && streamMatch[1]) {
            videoId = streamMatch[1];
        } else {
            const fallbackMatch = playerUrl.match(/\/(\d{4,})(?:\/|$)/);
            if (fallbackMatch && fallbackMatch[1]) {
                videoId = fallbackMatch[1];
            }
        }

        if (!videoId) {
            throw new Error(`Could not extract ID from player URL: ${playerUrl}`);
        }        
        console.log(`[Debug] ✅ Extracted Video ID: ${videoId}`);

        const apiUrl = `https://megaplay.buzz/stream/getSources?id=${videoId}`;
        console.log(`[Debug] Calling MegaPlay API: ${apiUrl}`);

        const apiRes = await axios.get(apiUrl, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': playerUrl,
                'User-Agent': headers['User-Agent']
            },
            timeout: 10000
        });

        if (apiRes.data && apiRes.data.sources && apiRes.data.sources.file) {
            const videoUrl = apiRes.data.sources.file;
            console.log(`[Debug] ✅ SUCCESS! Extracted video URL via API: ${videoUrl}`);
            return videoUrl;
        } else {
            console.error(`[Debug] ❌ API response did not contain video source:`, apiRes.data);
            throw new Error('MegaPlay API did not return a video source.');
        }

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