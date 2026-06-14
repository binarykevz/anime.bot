const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Downloads a video stream (m3u8 or mp4) and converts it to a local MP4 file using ffmpeg.
 */
async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum) {
    const tempDir = os.tmpdir();
    const safeName = `${animeName}_Ep${episodeNum}`.replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, `${safeName}_${Date.now()}.mp4`);

    return new Promise((resolve, reject) => {
        console.log(`[ffmpeg] Starting download with MegaPlay referer...`);
        
        // Primary attempt: Use megaplay.buzz as the referer
        const args = [
            '-y',
            '-headers', `Referer: https://megaplay.buzz/\r\nOrigin: https://megaplay.buzz\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n`,
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
                console.log(`[ffmpeg] ✅ Download and conversion successful!`);
                resolve(tempFilePath);
            } else {
                // 🚀 SMART FALLBACK: If the CDN blocks megaplay.buzz, try mewstream.buzz
                if (stderr.includes('403 Forbidden') || stderr.includes('403')) {
                    console.log(`[ffmpeg] ⚠️ 403 Forbidden detected. Retrying with Mewstream referer...`);
                    
                    const fallbackArgs = [
                        '-y',
                        '-headers', `Referer: https://mewstream.buzz/\r\nOrigin: https://mewstream.buzz\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n`,
                        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        '-i', videoUrl,
                        '-c', 'copy',
                        '-bsf:a', 'aac_adtstoasc',
                        tempFilePath
                    ];

                    const ffmpeg2 = spawn('ffmpeg', fallbackArgs);
                    let stderr2 = '';
                    
                    ffmpeg2.stderr.on('data', (data) => {
                        stderr2 += data.toString();
                    });

                    ffmpeg2.on('close', (code2) => {
                        if (code2 === 0) {
                            console.log(`[ffmpeg] ✅ Download successful on fallback!`);
                            resolve(tempFilePath);
                        } else {
                            reject(new Error(`ffmpeg failed on both attempts. Code: ${code2}. ${stderr2.slice(-300)}`));
                        }
                    });

                    ffmpeg2.on('error', (err) => {
                        reject(new Error(`Failed to start fallback ffmpeg: ${err.message}`));
                    });

                } else {
                    reject(new Error(`ffmpeg exited with code ${code}. ${stderr.slice(-300)}`));
                }
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`Failed to start ffmpeg: ${err.message}. Is ffmpeg installed on your system?`));
        });
    });
}

function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

module.exports = { downloadAndConvertToMp4, cleanupTempFile };