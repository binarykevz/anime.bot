const axios = require('axios');
const fs = require('fs');

const STORAGE_API_BASE = 'https://storage.to/api';
const VISITOR_TOKEN = 'GcIRtJileqZPHxfKNxDDlggi2EXdttHacieEpVVM52f37272';

async function initUpload(filename, fileSize) {
    try {
        const response = await axios.post(`${STORAGE_API_BASE}/upload/init`, {
            filename: filename,
            content_type: 'video/mp4',
            size: fileSize
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Visitor-Token': VISITOR_TOKEN
            }
        });

        // Return the full data object so we can get the upload_url AND the final file_id/link
        return response.data; 
    } catch (error) {
        console.error('Init Upload Error:', error.response?.data || error.message);
        throw new Error('Failed to initialize upload with Storage API.');
    }
}

async function uploadFileToUrl(uploadUrl, filePath) {
    const fileStream = fs.createReadStream(filePath);
    const stats = fs.statSync(filePath);

    try {
        await axios.put(uploadUrl, fileStream, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': stats.size
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
    } catch (error) {
        console.error('File Upload Error:', error.message);
        throw new Error('Failed to stream file to storage server.');
    }
}

module.exports = { initUpload, uploadFileToUrl };