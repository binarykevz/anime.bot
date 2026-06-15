
const axios = require('axios');

const ANILIST_GRAPHQL = 'https://graphql.anilist.co';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

const SEARCH_QUERY = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      idMal
      title {
        romaji
        english
        native
      }
      coverImage {
        large
      }
      episodes
      status
      format
      seasonYear
    }
  }
}
`;

async function getSearchResults(query) {
    try {
        console.log(`[AniList] Searching for: ${query}`);
        
        const response = await axios.post(ANILIST_GRAPHQL, {
            query: SEARCH_QUERY,
            variables: {
                search: query,
                page: 1,
                perPage: 10
            }
        }, {
            headers: headers,
            timeout: 10000
        });

        if (response.data.errors) {
            throw new Error(response.data.errors[0].message);
        }

        const results = response.data.data.Page.media;
        const formattedResults = results.map(anime => {
            const title = anime.title.english || anime.title.romaji || 'Unknown';
            const year = anime.seasonYear || '';
            const eps = anime.episodes || '?';
            
            return {
                title: `${title} (${year}) - ${eps} eps`,
                url: `https://anidoor.me/watch/?al=${anime.id}`,
                id: anime.id,
                malId: anime.idMal,
                coverImage: anime.coverImage.large
            };
        });

        console.log(`[AniList] ✅ Found ${formattedResults.length} results.`);
        return formattedResults;

    } catch (error) {
        console.error('Search Error:', error.message);
        throw new Error(`Failed to search anime: ${error.message}`);
    }
}

module.exports = { getSearchResults };
