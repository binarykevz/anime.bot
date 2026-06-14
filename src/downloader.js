
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Proxifly = require('proxifly');

// 🚀 Initialize Proxifly. 
// If you have an API key, paste it inside the quotes to remove rate limits.
const proxifly = new Proxifly({ apiKey: '' }); 

async function fetchFreshProxy() {
    try {
        console.log('[Proxifly] 🌐 Fetching a fresh elite US proxy...');
        const proxyData = await proxifly.getProxy({
            protocol: 'http',
            anonymity: 'elite',
            country: 'US', // US proxies work best for most anime CDNs
            https: true,
            format: 'json',
            quantity: 1
        });
        
        if (proxyData && proxyData.length > 0) {
            const p = proxyData[0];
            const proxyUrl = `http://${p.ip}:${p.port}`;
            console.log(`[Proxifly] ✅ Got proxy: ${proxyUrl}`);
            return proxyUrl;
        }
        return null;
    } catch (err) {
        console.error('[Proxifly] ⚠️ Failed to fetch proxy:', err.message);
        return null;
    }
}

async function downloadWithYtDlp(videoUrl, tempFilePath, refererUrl, userAgent, proxyUrl) {
    return new Promise((resolve, reject) => {
        const args = [
            videoUrl,
            '-o', tempFilePath,
            '--add-header', `Referer: ${refererUrl}`,
            '--add-header', `User-Agent: ${userAgent}`,
            '--add-header', 'Origin: https://megaplay.buzz',
            '--no-check-certificate',
            '--no-warnings',
            '--no-mtime',
            '--no-part',
            '--socket-timeout', '20',
            '--connect-timeout', '15',            '--retries', '2',
            '--fragment-retries', '2'
        ];

        if (proxyUrl) {
            args.push('--proxy', proxyUrl);
        }

        const ytDlp = spawn('yt-dlp', args);
        let stderr = '';
        
        ytDlp.stderr.on('data', (data) => { stderr += data.toString(); });

        ytDlp.on('close', (code) => {
            if (code === 0) resolve(true);
            else reject(new Error(stderr));
        });

        ytDlp.on('error', (err) => reject(err));
    });
}

async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum, episodeUrl, cookies) {
    const tempDir = os.tmpdir();
    const safeName = (animeName + '_Ep' + episodeNum).replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, safeName + '_' + Date.now() + '.mp4');

    const referers = [
        'https://megaplay.buzz/',
        'https://mewstream.buzz/',
        episodeUrl,
        'https://anikai.watch/'
    ];

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const MAX_ATTEMPTS = 5; // Try up to 5 fresh proxies before giving up

    console.log(`[yt-dlp] 🚀 Starting download with dynamic Proxifly proxies...`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`\n[yt-dlp] --- Attempt ${attempt}/${MAX_ATTEMPTS} ---`);
        
        // 1. Fetch a brand new proxy for this attempt
        const proxyUrl = await fetchFreshProxy();
        if (!proxyUrl) {
            console.log('[yt-dlp] ⚠️ Could not fetch proxy. Trying direct connection...');
        }

        // 2. Try the different referers with this new proxy        for (let i = 0; i < referers.length; i++) {
            const referer = referers[i];
            console.log(`[yt-dlp] 📡 Using Referer: ${referer}`);
            
            try {
                await downloadWithYtDlp(videoUrl, tempFilePath, referer, userAgent, proxyUrl);
                console.log(`[yt-dlp] ✅ SUCCESS! Downloaded via Proxy: ${proxyUrl || 'Direct'}`);
                return tempFilePath;
            } catch (err) {
                const errorMsg = err.message.slice(-300);
                if (errorMsg.includes('403') || errorMsg.includes('HTTP Error') || errorMsg.includes('Unable to download') || errorMsg.includes('ERROR:')) {
                    // Expected failure, move to next referer/proxy
                } else {
                    console.log(`[yt-dlp]    ⚠️ Error: ${errorMsg.slice(-150)}`);
                }
                
                // Clean up partial files before trying the next one
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                continue;
            }
        }
    }
    
    console.log('[yt-dlp] ❌ ALL ATTEMPTS FAILED.');
    throw new Error('Download failed. All dynamic proxies returned 403 or timed out. The video URL might be expired.');


function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { downloadAndConvertToMp4, cleanupTempFile };
