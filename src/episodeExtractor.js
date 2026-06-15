cat << 'EOF' > /home/ubuntu/anime.bot/src/episodeExtractor.js
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { ProxyAgent } = require('proxy-agent');

const BASE_URL = 'https://anikai.watch';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': BASE_URL + '/'
};

async function getEpisodes(animeUrl) {
    try {
        let slugMatch = animeUrl.match(/\/([^/]+?)(?:-episode-\d+|-ep-\d+)?(?:-in-english-(?:subbed|dubbed))?\/?$/i);
        let slug = slugMatch ? slugMatch[1] : animeUrl.split('/').filter(Boolean).pop();
        let seriesUrl = animeUrl;
        if (animeUrl.includes('-episode-') || animeUrl.includes('-ep-')) {
            seriesUrl = BASE_URL + '/series/' + slug + '/';
        }
        let htmlRes;
        try {
            htmlRes = await axios.get(seriesUrl, { headers: headers, timeout: 10000 });
        } catch (err) {
            seriesUrl = BASE_URL + '/' + slug + '/';
            htmlRes = await axios.get(seriesUrl, { headers: headers, timeout: 10000 });
        }
        const $ = cheerio.load(htmlRes.data);
        const episodes = [];
        $('a').each(function(i, el) {
            const href = $(el).attr('href');
            if (href && (href.includes('-episode-') || href.includes('-ep-')) && href.includes(BASE_URL)) {
                const epNumMatch = href.match(/(?:-episode-|-ep-)(\d+)/i);
                const epNum = epNumMatch ? epNumMatch[1] : 'Ep ' + (i + 1);
                if (!episodes.find(function(ep) { return ep.url === href; })) {
                    episodes.push({ number: epNum, url: href, id: href });
                }
            }
        });
        if (episodes.length === 0) {
            const epNumMatch = animeUrl.match(/(?:-episode-|-ep-)(\d+)/i);
            const epNum = epNumMatch ? epNumMatch[1] : '1';
            episodes.push({ number: epNum, url: animeUrl, id: animeUrl });
        }
        return episodes;
    } catch (error) {
        throw new Error('Failed to fetch episode list: ' + error.message);
    }
}

async function getVideoSourceUrl(episodeUrl, proxyConfig) {
    let browser;
    try {
        const launchArgs = [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--no-zygote', '--disable-extensions',
            '--disable-background-networking', '--disable-blink-features=AutomationControlled'
        ];
        
        // 🚀 CRITICAL FIX: Pass proxy WITHOUT credentials to Chromium
        const proxyServerUrl = `http://${proxyConfig.ipPort}`;
        launchArgs.push('--proxy-server=' + proxyServerUrl);
        console.log('[Puppeteer] 🌐 Using Proxy Server: ' + proxyServerUrl);

        browser = await puppeteer.launch({
            headless: true, ignoreHTTPSErrors: true,
            args: launchArgs, timeout: 30000 
        });

        const page = await browser.newPage();
        
        // 🚀 CRITICAL FIX: Authenticate the proxy using Puppeteer's built-in method
        if (proxyConfig.username && proxyConfig.password) {
            await page.authenticate({ username: proxyConfig.username, password: proxyConfig.password });
            console.log('[Puppeteer] 🔑 Proxy credentials applied.');
        }

        await page.evaluateOnNewDocument(function() { Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } }); });
        await page.setUserAgent(headers['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': 'https://anikai.watch/' });

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        let playerUrl = null;

        client.on('Network.responseReceived', function(event) {
            const url = event.response.url;
            const type = event.type;
            if (type === 'Document' && !url.includes('anikai.watch') && !url.includes('cloudflare') && !url.includes('google')) {
                if (url.includes('megaplay') || url.includes('stream') || url.includes('player') || url.includes('video') || url.includes('embed') || url.includes('buzz')) {
                    if (!playerUrl) playerUrl = url;
                }
            }
        });

        console.log('[Puppeteer] 🌐 Navigating to episode page...');
        await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(function(resolve) { setTimeout(resolve, 3000); });
        try { await page.evaluate(function() { const btn = document.querySelector('.btn-play, .play-button, a[href="#player"], .vscontrol, .play-btn, button, .player-overlay, .play'); if (btn) btn.click(); }); } catch (e) {}
        await new Promise(function(resolve) { setTimeout(resolve, 3000); });

        if (!playerUrl) throw new Error('Could not intercept video host URL from main page.');

        let videoId = null;
        const streamMatch = playerUrl.match(/\/(?:stream|embed)[^/]*\/(\d+)/);
        if (streamMatch && streamMatch[1]) videoId = streamMatch[1];
        else {
            const fallbackMatch = playerUrl.match(/\/(\d{4,})(?:\/|$)/);
            if (fallbackMatch && fallbackMatch[1]) videoId = fallbackMatch[1];
        }
        if (!videoId) throw new Error('Could not extract ID from player URL: ' + playerUrl);

        const apiUrl = 'https://megaplay.buzz/stream/getSources?id=' + videoId;
        
        // 🚀 For Axios, we CAN use the full URL with inline auth via proxy-agent
        const axiosConfig = {
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': playerUrl, 'User-Agent': headers['User-Agent'] },
            timeout: 15000,
            httpsAgent: new ProxyAgent(proxyConfig.fullHttp),
            proxy: false 
        };

        const apiRes = await axios.get(apiUrl, axiosConfig);

        if (apiRes.data && apiRes.data.sources && apiRes.data.sources.file) {
            const videoUrl = apiRes.data.sources.file;
            console.log('[Debug] ✅ SUCCESS! Extracted video URL via API.');
            return videoUrl;
        } else {
            throw new Error('MegaPlay API did not return a video source.');
        }
    } catch (error) {
        throw new Error('Failed to extract video URL: ' + error.message);
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { getEpisodes: getEpisodes, getVideoSourceUrl: getVideoSourceUrl };
EOF
