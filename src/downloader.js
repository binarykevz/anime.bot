
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 🚀 Webshare Residential Proxies
const PROXY_LIST = [
    '38.154.203.95:5863',
    '198.105.121.200:6462',
    '64.137.96.74:6641',
    '209.127.138.10:5784',
    '38.154.185.97:6370',
    '84.247.60.125:6095',
    '142.111.67.146:5611',
    '191.96.254.138:6185',
    '104.239.107.47:5699',
    '23.229.19.94:8689'
];
const PROXY_USER = 'bgfqfdjy';
const PROXY_PASS = 'xgrj384kx4yw';

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
            '--socket-timeout', '15', // Timeout after 15s if proxy is dead
            '--connect-timeout', '10',
            '--retries', '2',
            '--fragment-retries', '2'
        ];

        if (proxyUrl) {
            args.push('--proxy', proxyUrl);
        }

        const ytDlp = spawn('yt-dlp', args);
        let stderr = '';
        
        ytDlp.stderr.on('data', (data) => { stderr += data.toString(); });

        ytDlp.on('close', (code) => {            if (code === 0) resolve(true);
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

    // Format proxies with credentials
    const formattedProxies = PROXY_LIST.map(ipPort => `http://${PROXY_USER}:${PROXY_PASS}@${ipPort}`);

    console.log(`[yt-dlp] 🚀 Starting download with ${PROXY_LIST.length} Residential Proxies...`);

    // Loop through each proxy
    for (let p = 0; p < formattedProxies.length; p++) {
        const proxyUrl = formattedProxies[p];
        console.log(`[yt-dlp] 🌐 Trying Proxy ${p + 1}/${formattedProxies.length}: ${PROXY_LIST[p]}`);

        // Loop through referers for this proxy
        for (let i = 0; i < referers.length; i++) {
            const referer = referers[i];
            
            try {
                await downloadWithYtDlp(videoUrl, tempFilePath, referer, userAgent, proxyUrl);
                console.log(`[yt-dlp] ✅ SUCCESS! Downloaded via Proxy: ${PROXY_LIST[p]}`);
                return tempFilePath;
            } catch (err) {
                const errorMsg = err.message.slice(-300);
                
                // If it's a 403 or connection error, just try the next referer/proxy
                if (errorMsg.includes('403') || errorMsg.includes('HTTP Error') || errorMsg.includes('Unable to download') || errorMsg.includes('ERROR:')) {
                    // Silent fail for individual attempts, we just move to the next
                } else {
                    console.log(`[yt-dlp]    ⚠️ Unexpected error: ${errorMsg.slice(-100)}`);
                }
                                // Clean up partial files
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                continue;
            }
        }
        console.log(`[yt-dlp] ❌ Proxy ${p + 1} failed for all referers. Switching to next proxy...`);
    }
    
    console.log('[yt-dlp] ❌ ALL 10 PROXIES FAILED.');
    throw new Error('Download failed. All residential proxies returned 403 or timed out. The video URL might be expired.');
}

function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { downloadAndConvertToMp4, cleanupTempFile };
