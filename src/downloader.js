
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function downloadWithYtDlp(videoUrl, tempFilePath, refererUrl, userAgent) {
    return new Promise((resolve, reject) => {
        const args = [
            videoUrl, '-o', tempFilePath,
            '--add-header', 'Referer: ' + refererUrl,
            '--add-header', 'User-Agent: ' + userAgent,
            '--add-header', 'Origin: https://megaplay.buzz',
            '--no-check-certificate', '--no-warnings', '--no-mtime', '--no-part',
            '--socket-timeout', '20',
            '--retries', '3'
        ];

        // 🚀 yt-dlp natively reads http_proxy/https_proxy from process.env
        const ytDlp = spawn('yt-dlp', args, { env: process.env });
        let stderr = '';
        ytDlp.stderr.on('data', (data) => { stderr += data.toString(); });
        ytDlp.on('close', (code) => { if (code === 0) resolve(true); else reject(new Error(stderr)); });
        ytDlp.on('error', (err) => reject(err));
    });
}

async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum, episodeUrl) {
    const tempDir = os.tmpdir();
    const safeName = (animeName + '_Ep' + episodeNum).replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, safeName + '_' + Date.now() + '.mp4');

    const referers = ['https://megaplay.buzz/', 'https://mewstream.buzz/', episodeUrl, 'https://anikai.watch/'];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    for (let i = 0; i < referers.length; i++) {
        const referer = referers[i];
        try {
            await downloadWithYtDlp(videoUrl, tempFilePath, referer, userAgent);
            console.log('[yt-dlp] ✅ SUCCESS! Downloaded via ENV proxy.');
            return tempFilePath;
        } catch (err) {
            const errorMsg = err.message.slice(-300);
            if (errorMsg.includes('403') || errorMsg.includes('HTTP Error') || errorMsg.includes('Unable to download') || errorMsg.includes('ERROR:')) {
                // Expected failure, move to next referer
            } else {
                console.log('[yt-dlp] ⚠️ Error: ' + errorMsg.slice(-150));
            }
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            continue;
        }
    }
    
    throw new Error('yt-dlp failed with all referers.');
}

function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { downloadAndConvertToMp4: downloadAndConvertToMp4, cleanupTempFile: cleanupTempFile };
