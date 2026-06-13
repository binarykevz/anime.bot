const axios = require('axios');
const fs = require('fs');

const STORAGE_API_BASE = 'https://storage.to/api';
const VISITOR_TOKEN = '264|GcIRtJileqZPHxfKNxDDlggi2EXdttHacieEpVVM52f37272';

/**
 * Initializes the upload and returns the presigned upload URL
 */
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

        // Adjust 'upload_url' based on the actual JSON response from your API
        // Common variations: response.data.upload_url, response.data.url, response.data.presigned_url
        const uploadUrl = response.data.upload_url || response.data.url; 
        
        if (!uploadUrl) {
            throw new Error('Upload URL not found in API response: ' + JSON.stringify(response.data));
        }

        return uploadUrl;
    } catch (error) {
        console.error('Init Upload Error:', error.message);
        throw new Error('Failed to initialize upload with Storage API.');
    }
}

/**
 * Streams the local file to the presigned URL
 */
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
