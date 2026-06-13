const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Downloads a video URL to a temporary file
 */
async function downloadVideoToTemp(videoUrl) {
    // Create a unique temporary file path
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `anime_${Date.now()}.mp4`);
    
    const writer = fs.createWriteStream(tempFilePath);

    const response = await axios({
        url: videoUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000 // 60 seconds timeout
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(tempFilePath));
        writer.on('error', (err) => {
            fs.unlink(tempFilePath, () => {}); // Clean up on error
            reject(err);
        });
    });
}

/**
 * Cleans up the temporary file
 */
function cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

module.exports = { downloadVideoToTemp, cleanupTempFile };
