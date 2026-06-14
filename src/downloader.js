
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function tryDownload(videoUrl, tempFilePath, refererUrl) {
    return new Promise((resolve, reject) => {
        const args = [
            '-y',
            '-headers', `Referer: ${refererUrl}\r\nOrigin: ${refererUrl}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n`,
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-i', videoUrl,
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            tempFilePath
        ];

        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                reject(new Error(stderr));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });
}

async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum, episodeUrl) {
    const tempDir = os.tmpdir();
    const safeName = `${animeName}_Ep${episodeNum}`.replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, `${safeName}_${Date.now()}.mp4`);

    // 🚀 Try a sequence of referers. The CDN might strictly require the exact page that generated the token.
    const referers = [
        episodeUrl, // 1. The exact episode page on anikai.watch (Most likely to work)
        'https://megaplay.buzz/',
        'https://mewstream.buzz/',
        'https://anikai.watch/',
        'https://cdn.mewstream.buzz/' // 5. Sometimes CDNs require themselves as referer
    ];

    for (let i = 0; i < referers.length; i++) {
        const referer = referers[i];
        console.log(`[ffmpeg] Attempt ${i + 1} with Referer: ${referer}`);
        
        try {
            await tryDownload(videoUrl, tempFilePath, referer);
            console.log(`[ffmpeg] ✅ Success with Referer: ${referer}`);
            return tempFilePath;
        } catch (err) {
            if (err.message.includes('403 Forbidden') || err.message.includes('403')) {
                console.log(`[ffmpeg] ⚠️ 403 Forbidden with ${referer}. Trying next...`);
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                continue;
            } else {
                console.log(`[ffmpeg] ⚠️ Failed with ${referer}: ${err.message.slice(-100)}`);
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                continue;
            }
        }
    }

    throw new Error('ffmpeg failed with all referer attempts. The video URL might be expired or strictly geo-blocked.');
}

function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

module.exports = { downloadAndConvertToMp4, cleanupTempFile };
