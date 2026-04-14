const REQUEST_TIMEOUT_MS = Number(process.env.PHASE3_HTTP_TIMEOUT_MS || 12000);
const LRCLIB_BASE_URL = process.env.LRCLIB_BASE_URL || 'https://lrclib.net';
const LYRICS_OVH_BASE_URL = process.env.LYRICS_OVH_BASE_URL || 'https://api.lyrics.ovh';

const unique = (values) => [...new Set(values.filter(Boolean))];

const cleanToken = (value) =>
  String(value || '')
    .replace(/\s+\([^)]*\)$/g, '')
    .replace(/\s+-\s+[^-]+$/g, '')
    .replace(/\s+feat\.?\s+.+$/i, '')
    .trim();

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeForScore = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scoreLyricCandidate = (candidate, songName, artistName) => {
  const title = normalizeForScore(candidate.trackName || candidate.name);
  const artist = normalizeForScore(candidate.artistName);
  const targetTitle = normalizeForScore(songName);
  const targetArtist = normalizeForScore(artistName);

  let score = 0;
  if (title === targetTitle) {
    score += 80;
  }
  if (title.includes(targetTitle)) {
    score += 30;
  }
  if (artist.includes(targetArtist)) {
    score += 25;
  }
  if (candidate.syncedLyrics) {
    score += 15;
  }

  return score;
};

const getFromLrcLib = async ({songName, artistName}) => {
  const query = new URLSearchParams({
    track_name: songName,
    artist_name: artistName,
  });

  const directUrl = `${LRCLIB_BASE_URL}/api/get?${query.toString()}`;
  const direct = await fetchJson(directUrl);
  if (direct && (direct.syncedLyrics || direct.plainLyrics)) {
    return {
      provider: 'lrclib',
      matchedBy: 'direct-get',
      syncedLyrics: direct.syncedLyrics || '',
      plainLyrics: direct.plainLyrics || '',
      raw: {
        id: direct.id || null,
        trackName: direct.trackName || songName,
        artistName: direct.artistName || artistName,
        albumName: direct.albumName || null,
      },
    };
  }

  const searchUrl = `${LRCLIB_BASE_URL}/api/search?${query.toString()}`;
  const results = await fetchJson(searchUrl);
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const best = results
    .map((item) => ({item, score: scoreLyricCandidate(item, songName, artistName)}))
    .sort((a, b) => b.score - a.score)[0]?.item;

  if (!best || (!best.syncedLyrics && !best.plainLyrics)) {
    return null;
  }

  return {
    provider: 'lrclib',
    matchedBy: 'search',
    syncedLyrics: best.syncedLyrics || '',
    plainLyrics: best.plainLyrics || '',
    raw: {
      id: best.id || null,
      trackName: best.trackName || songName,
      artistName: best.artistName || artistName,
      albumName: best.albumName || null,
    },
  };
};

const getFromLyricsOvh = async ({songName, artistName}) => {
  const endpoint = `${LYRICS_OVH_BASE_URL}/v1/${encodeURIComponent(artistName)}/${encodeURIComponent(songName)}`;
  const response = await fetchJson(endpoint);

  if (!response || !response.lyrics) {
    return null;
  }

  return {
    provider: 'lyrics.ovh',
    matchedBy: 'plain-lyrics-fallback',
    syncedLyrics: '',
    plainLyrics: response.lyrics,
    raw: {
      artistName,
      trackName: songName,
      endpoint,
    },
  };
};

const fetchLyricsWithFallback = async (song) => {
  const primaryArtist = cleanToken((song.artist || '').split(',')[0]);
  const titleCandidates = unique([song.name, cleanToken(song.name)]);
  const artistCandidates = unique([primaryArtist, song.artist]);

  for (const title of titleCandidates) {
    for (const artist of artistCandidates) {
      const lrcResult = await getFromLrcLib({songName: title, artistName: artist});
      if (lrcResult) {
        return lrcResult;
      }
    }
  }

  for (const title of titleCandidates) {
    for (const artist of artistCandidates) {
      const fallback = await getFromLyricsOvh({songName: title, artistName: artist});
      if (fallback) {
        return fallback;
      }
    }
  }

  return {
    provider: 'none',
    matchedBy: 'none',
    syncedLyrics: '',
    plainLyrics: '',
    raw: null,
  };
};

module.exports = {
  fetchLyricsWithFallback,
};
