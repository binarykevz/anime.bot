const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Parses the HTML content to extract anime details.
 */
function parseHtml(html) {
    const $ = cheerio.load(html);
    const results = [];

    let items = $('a.aitem');
    if (items.length === 0) items = $('.flw-item');
    if (items.length === 0) items = $('.film_list-wrap .film-item');
    if (items.length === 0) items = $('.bsx'); 

    items.each((index, element) => {
        const item = $(element);
        let title = '', link = '', poster = '', japaneseTitle = '';
        let sub = '', dub = '', type = '', year = '';

        if (item.is('a.aitem')) {
            const titleTag = item.find('h6.title');
            title = titleTag.text().trim();
            japaneseTitle = titleTag.attr('data-jp') || '';
            link = item.attr('href') || '';
            
            const posterImg = item.find('.poster img');
            poster = posterImg.attr('src') || posterImg.attr('data-src') || '';

            item.find('.info span').each((i, span) => {
                const spanEl = $(span);
                const classes = spanEl.attr('class') || '';
                if (classes.includes('sub')) sub = spanEl.text().trim();
                else if (classes.includes('dub')) dub = spanEl.text().trim();
                else {
                    const bTag = spanEl.find('b');
                    if (bTag.length) {
                        const text = spanEl.text().trim();
                        if (!/^\d+$/.test(text)) type = text;
                    } else {
                        year = spanEl.text().trim();
                    }
                }
            });
        } else if (item.hasClass('flw-item')) {
            const titleTag = item.find('.film-name a, .dynamic-name');
            title = titleTag.text().trim();
            link = titleTag.attr('href') || '';
            
            const posterImg = item.find('.film-poster img');            poster = posterImg.attr('src') || posterImg.attr('data-src') || '';
            
            item.find('.fd-infor .fdi-item').each((i, fdItem) => {
                const text = $(fdItem).text().trim().toLowerCase();
                if (text.includes('sub')) sub = $(fdItem).text().trim();
                else if (text.includes('dub')) dub = $(fdItem).text().trim();
                else if (text.includes('tv') || text.includes('movie')) type = $(fdItem).text().trim();
                else if (/^\d{4}$/.test($(fdItem).text().trim())) year = $(fdItem).text().trim();
            });
        } else {
            const titleTag = item.find('h3 a, h2 a, .title a, a');
            title = titleTag.first().text().trim();
            link = titleTag.first().attr('href') || '';
            const posterImg = item.find('img');
            poster = posterImg.attr('src') || posterImg.attr('data-src') || '';
        }

        if (title && link) {
            if (link.startsWith('/')) link = `https://anikai.watch${link}`;
            results.push({ title, japaneseTitle, url: link, poster, sub: sub || '0', dub: dub || '0', type: type || 'N/A', year: year || 'N/A' });
        }
    });

    return results;
}

/**
 * Main function to fetch and parse search results
 */
async function getSearchResults(searchQuery) {
    const baseUrl = 'https://anikai.watch';
    const directUrl = `${baseUrl}/?s=${encodeURIComponent(searchQuery)}`;
    const ajaxUrl = `${baseUrl}/ajax/anime/search?keyword=${encodeURIComponent(searchQuery)}`;
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${baseUrl}/`
    };

    async function fetchAndParse(url, isAjax = false) {
        const reqHeaders = { ...headers };
        if (isAjax) {
            reqHeaders['X-Requested-With'] = 'XMLHttpRequest';
            reqHeaders['Accept'] = 'application/json, text/javascript, */*; q=0.01';
        }

        const response = await axios.get(url, { headers: reqHeaders, timeout: 10000 });
        let html = '';
                if (isAjax && typeof response.data === 'object' && response.data.result) {
            html = response.data.result.html || response.data.result;
        } else {
            html = response.data;
        }

        return parseHtml(html);
    }

    try {
        let results = await fetchAndParse(directUrl);
        if (results.length === 0) {
            results = await fetchAndParse(ajaxUrl, true);
        }
        return results;
    } catch (error) {
        console.error('Scraping Error:', error.message);
        throw new Error('Failed to fetch results from AnimeKai.');
    }
}

module.exports = { getSearchResults };