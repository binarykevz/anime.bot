
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function downloadWithYtDlp(videoUrl, tempFilePath, refererUrl, userAgent) {
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
            '--no-part'
        ];

        const ytDlp = spawn('yt-dlp', args);
        let stderr = '';
        
        ytDlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                reject(new Error(stderr));
            }
        });

        ytDlp.on('error', (err) => {
            reject(err);
        });
    });
}

async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum, episodeUrl, cookies) {
    const tempDir = os.tmpdir();
    const safeName = (animeName + '_Ep' + episodeNum).replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, safeName + '_' + Date.now() + '.mp4');

    // yt-dlp will try these referers in order until one works
    const referers = [
        'https://megaplay.buzz/',
        'https://mewstream.buzz/',
        episodeUrl,
        'https://anikai.watch/'
    ];

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    for (let i = 0; i < referers.length; i++) {
        const referer = referers[i];
        console.log(`[yt-dlp] Attempt ${i + 1} with Referer: ${referer}`);
        
        try {
            await downloadWithYtDlp(videoUrl, tempFilePath, referer, userAgent);
            console.log(`[yt-dlp] ✅ Success with Referer: ${referer}`);
            return tempFilePath;
        } catch (err) {
            const errorMsg = err.message.slice(-200);
            if (errorMsg.includes('403') || errorMsg.includes('HTTP Error 403')) {
                console.log(`[yt-dlp] ⚠️ 403 Forbidden with ${referer}. Trying next...`);
            } else {
                console.log(`[yt-dlp] ⚠️ Failed with ${referer}: ${errorMsg}`);
            }
            
            // Clean up partial files before trying the next referer
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            continue;
        }
    }
    
    console.log('[yt-dlp] ❌ ALL ATTEMPTS FAILED.');
    console.log('[yt-dlp] 💡 TIP: If all attempts fail with 403, the video CDN is blocking your VPS IP address.');
    console.log('[yt-dlp] 💡 TIP: To fix IP blocks, you must run the bot on a local machine (Residential IP) or use a residential proxy.');
    
    throw new Error('yt-dlp failed with all referer attempts. The video URL might be expired, strictly geo-blocked, or your VPS IP is blocked by the CDN.');
}

function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { downloadAndConvertToMp4, cleanupTempFile };
