const DEFAULT_JIOSAAVN_ENDPOINTS = [
  'https://jiosaavn-api-taupe-phi.vercel.app/api',
  'https://jiosaavn-api-v2.vercel.app/api',
  'https://saavn.me/api',
  'https://jio-saavn-api-red.vercel.app/api',
];

const REQUEST_TIMEOUT_MS = Number(process.env.PHASE3_HTTP_TIMEOUT_MS || 12000);
const RETRIES_PER_ENDPOINT = Number(process.env.PHASE3_JIOSAAVN_RETRIES || 2);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getEndpoints = () => {
  const custom = process.env.JIOSAAVN_API_ENDPOINTS;
  if (!custom) {
    return DEFAULT_JIOSAAVN_ENDPOINTS;
  }

  const parsed = custom
    .split(',')
    .map((endpoint) => endpoint.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : DEFAULT_JIOSAAVN_ENDPOINTS;
};

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} for ${url}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const requestWithEndpointFallback = async (pathWithQuery) => {
  const endpoints = getEndpoints();
  const errors = [];

  for (const endpoint of endpoints) {
    const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    const url = `${base}${path}`;

    for (let attempt = 1; attempt <= RETRIES_PER_ENDPOINT; attempt += 1) {
      try {
        const data = await fetchJson(url);
        return {data, endpoint: base};
      } catch (error) {
        errors.push(`${base} (attempt ${attempt}): ${error.message}`);
        if (attempt < RETRIES_PER_ENDPOINT) {
          await sleep(attempt * 400);
        }
      }
    }
  }

  const message = errors.length > 0 ? errors.join(' | ') : 'Unknown API error';
  throw new Error(`JioSaavn request failed across all endpoints. ${message}`);
};

const normalizeSong = (song) => {
  if (!song) {
    return null;
  }

  const artist =
    song.artists?.primary?.map((item) => item.name).join(', ') ||
    song.primaryArtists ||
    song.artist ||
    'Unknown Artist';

  const image =
    song.image?.[2]?.url ||
    song.image?.[1]?.url ||
    song.image?.[0]?.url ||
    null;

  return {
    id: song.id || null,
    name: song.name || song.title || 'Unknown Song',
    artist,
    album: song.album?.name || song.album || null,
    duration: Number(song.duration || 0),
    language: song.language || null,
    year: song.year || null,
    url: song.url || null,
    image,
    hasLyrics: Boolean(song.hasLyrics),
    source: 'jiosaavn',
  };
};

const extractSongsArray = (payload) => {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.data?.results)) {
    return payload.data.results;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  return [];
};

const normalizeForScore = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scoreSongCandidate = (song, query) => {
  const normalizedQuery = normalizeForScore(query);
  const name = normalizeForScore(song.name);
  const artist = normalizeForScore(song.artist);

  if (!normalizedQuery) {
    return 0;
  }

  let score = 0;
  if (name === normalizedQuery) {
    score += 100;
  }
  if (name.includes(normalizedQuery)) {
    score += 50;
  }
  if (normalizedQuery.includes(name) && name.length > 3) {
    score += 25;
  }
  if (artist.includes(normalizedQuery)) {
    score += 15;
  }

  return score;
};

const searchSongs = async (query, limit = 8) => {
  const encodedQuery = encodeURIComponent(query);
  const {data, endpoint} = await requestWithEndpointFallback(
    `/search/songs?query=${encodedQuery}&limit=${limit}`
  );

  const songs = extractSongsArray(data).map(normalizeSong).filter(Boolean);
  return {songs, endpoint};
};

const getSongById = async (songId) => {
  const {data, endpoint} = await requestWithEndpointFallback(`/songs/${encodeURIComponent(songId)}`);
  const songs = extractSongsArray(data).map(normalizeSong).filter(Boolean);
  return {song: songs[0] || null, endpoint};
};

const resolveSongMetadata = async ({songId, query}) => {
  if (songId) {
    const {song, endpoint} = await getSongById(songId);
    if (!song) {
      throw new Error(`Song not found for id: ${songId}`);
    }

    return {
      song,
      endpoint,
      selectionMethod: 'song-id',
    };
  }

  if (!query) {
    throw new Error('Either songId or query is required.');
  }

  const {songs, endpoint} = await searchSongs(query, 10);
  if (songs.length === 0) {
    throw new Error(`No songs found for query: ${query}`);
  }

  const ranked = songs
    .map((song) => ({song, score: scoreSongCandidate(song, query)}))
    .sort((a, b) => b.score - a.score);

  return {
    song: ranked[0].song,
    endpoint,
    selectionMethod: 'search-best-match',
    candidates: songs.slice(0, 5),
  };
};

module.exports = {
  resolveSongMetadata,
};
