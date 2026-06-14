
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function tryDownload(videoUrl, tempFilePath, refererUrl, cookieString) {
    return new Promise((resolve, reject) => {
        const cookieHeader = cookieString ? 'Cookie: ' + cookieString + '\r\n' : '';
        const args = [
            '-y',
            '-headers', 
            'Referer: ' + refererUrl + '\r\n' +
            'Origin: https://megaplay.buzz\r\n' +
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n' +
            'Sec-Fetch-Site: cross-site\r\n' +
            'Sec-Fetch-Mode: no-cors\r\n' +
            'Sec-Fetch-Dest: video\r\n' +
            'Accept: */*\r\n' +
            'Accept-Language: en-US,en;q=0.9\r\n' +
            cookieHeader,
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-i', videoUrl,
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            tempFilePath
        ];

        const ffmpeg = spawn('ffmpeg', args);
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
        ffmpeg.on('close', (code) => {
            if (code === 0) resolve(true);
            else reject(new Error(stderr));
        });
        ffmpeg.on('error', (err) => reject(err));
    });
}

async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum, episodeUrl, cookies) {
    const tempDir = os.tmpdir();
    const safeName = (animeName + '_Ep' + episodeNum).replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, safeName + '_' + Date.now() + '.mp4');

    let cookieString = '';
    if (cookies && cookies.length > 0) {
        cookieString = cookies.map(function(c) { return c.split(';')[0]; }).join('; ');
        console.log('[ffmpeg] Using captured cookies: ' + cookieString);
    }

    const referers = [
        episodeUrl,
        'https://megaplay.buzz/',
        'https://mewstream.buzz/',
        'https://anikai.watch/',
        'https://cdn.mewstream.buzz/'
    ];

    for (let i = 0; i < referers.length; i++) {
        const referer = referers[i];
        console.log('[ffmpeg] Attempt ' + (i + 1) + ' with Referer: ' + referer);
        try {
            await tryDownload(videoUrl, tempFilePath, referer, cookieString);
            console.log('[ffmpeg] ✅ Success with Referer: ' + referer);
            return tempFilePath;
        } catch (err) {
            if (err.message.includes('403 Forbidden') || err.message.includes('403')) {
                console.log('[ffmpeg] ⚠️ 403 Forbidden with ' + referer + '. Trying next...');
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                continue;
            } else {
                console.log('[ffmpeg] ⚠️ Failed with ' + referer + ': ' + err.message.slice(-100));
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                continue;
            }
        }
    }
    throw new Error('ffmpeg failed with all referer attempts. The video URL might be expired or strictly geo-blocked.');
}

function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { downloadAndConvertToMp4: downloadAndConvertToMp4, cleanupTempFile: cleanupTempFile };
