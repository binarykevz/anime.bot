const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = 'https://anikai.watch';

/**
 * Downloads a video stream (m3u8 or mp4) and converts it to a local MP4 file using ffmpeg.
 */
async function downloadAndConvertToMp4(videoUrl, animeName, episodeNum) {
    const tempDir = os.tmpdir();
    const safeName = `${animeName}_Ep${episodeNum}`.replace(/[\/\\:*?"<>|]/g, '_');
    const tempFilePath = path.join(tempDir, `${safeName}_${Date.now()}.mp4`);

    return new Promise((resolve, reject) => {
        // ffmpeg arguments:
        // -y: Overwrite output files without asking
        // -headers: Required by anime sites to bypass hotlink protection
        // -c copy: Copies streams without re-encoding (Extremely fast, no quality loss)
        // -bsf:a aac_adtstoasc: Required filter for converting m3u8 AAC audio to MP4 container
        const args = [
            '-y',
            '-headers', `Referer: ${BASE_URL}/\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n`,
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
                resolve(tempFilePath);
            } else {
                reject(new Error(`ffmpeg exited with code ${code}. ${stderr.slice(-200)}`));
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