#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const templateSongData = require('../remotion/template-song-data.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LRCLIB_API = process.env.LRCLIB_API || 'https://lrclib.net/api';
const DEFAULT_HISTORY_FILE = path.join(PROJECT_ROOT, 'data', 'rendered-song-history.json');
const DEFAULT_JIOSAAVN_ENDPOINTS = [
  'https://jiosaavn-api-taupe-phi.vercel.app/api',
  'https://saavn.dev/api',
  'https://jiosaavn-api-v2.vercel.app/api',
  'https://saavn.me/api',
  'https://jio-saavn-api-red.vercel.app/api',
];

const parseArgs = (argv) => {
  const args = {
    out: path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'),
    songId: '',
    query: '',
    autoMode: '',
    allowRepeat: false,
    historyFile: DEFAULT_HISTORY_FILE,
  };

  for (const arg of argv) {
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      args.out = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--song-id=')) {
      args.songId = arg.slice('--song-id='.length).trim();
    } else if (arg.startsWith('--query=')) {
      args.query = arg.slice('--query='.length).trim();
    } else if (arg.startsWith('--auto=')) {
      args.autoMode = arg.slice('--auto='.length).trim();
    } else if (arg.startsWith('--allow-repeat=')) {
      args.allowRepeat = ['1', 'true', 'yes'].includes(arg.slice('--allow-repeat='.length).trim().toLowerCase());
    } else if (arg.startsWith('--history-file=')) {
      const value = arg.slice('--history-file='.length).trim();
      args.historyFile = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    }
  }

  return args;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const clamp = (value, min, max) => {
  return Math.min(max, Math.max(min, value));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeBaseUrl = (url) => String(url || '').trim().replace(/\/+$/, '');

const loadEndpoints = () => {
  const fromEnv = String(process.env.JIOSAAVN_API_ENDPOINTS || '')
    .split(',')
    .map((part) => normalizeBaseUrl(part))
    .filter(Boolean);

  return (fromEnv.length > 0 ? fromEnv : DEFAULT_JIOSAAVN_ENDPOINTS).map((base) => normalizeBaseUrl(base));
};

const ensureRoute = (route) => {
  if (/^https?:\/\//i.test(route)) {
    return route;
  }

  return `/${String(route || '').replace(/^\/+/, '')}`;
};

const joinUrl = (base, route) => {
  if (/^https?:\/\//i.test(route)) {
    return route;
  }

  const safeBase = normalizeBaseUrl(base);
  const safeRoute = ensureRoute(route);
  return `${safeBase}${safeRoute}`;
};

const requestJson = async (url, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.success === false) {
      throw new Error(payload?.message || 'Upstream API rejected request');
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
};

const requestViaJiosaavnApis = async (routes, retries = 2) => {
  const endpointCandidates = loadEndpoints();
  const routeCandidates = (Array.isArray(routes) ? routes : [routes]).map((route) => ensureRoute(route));
  const errors = [];

  for (const route of routeCandidates) {
    for (const endpoint of endpointCandidates) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        const url = joinUrl(endpoint, route);
        try {
          return await requestJson(url);
        } catch (error) {
          errors.push(`${url} (${error.message || error})`);
          if (attempt < retries) {
            await delay(300);
          }
        }
      }
    }
  }

  throw new Error(`JioSaavn API request failed across all endpoints. Last attempts: ${errors.slice(-4).join(' | ')}`);
};

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const loadHistory = async (historyFile) => {
  const payload = await readJsonIfExists(historyFile);
  if (!payload || !Array.isArray(payload.songs)) {
    return {
      updatedAt: null,
      songs: [],
    };
  }

  return {
    updatedAt: payload.updatedAt || null,
    songs: payload.songs,
  };
};

const saveHistory = async (historyFile, history) => {
  const next = {
    updatedAt: new Date().toISOString(),
    songs: Array.isArray(history?.songs) ? history.songs.slice(-500) : [],
  };

  await fs.mkdir(path.dirname(historyFile), {recursive: true});
  await fs.writeFile(historyFile, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
};

const pickImageUrl = (image) => {
  if (Array.isArray(image) && image.length > 0) {
    const urls = image
      .map((entry) => (typeof entry === 'string' ? entry : entry?.url || ''))
      .filter(Boolean);

    if (urls.length > 0) {
      return urls[urls.length - 1];
    }
  }

  if (typeof image === 'string' && image) {
    return image;
  }

  return templateSongData.song?.image || '';
};

const pickAudioUrl = (song) => {
  const downloadUrl = Array.isArray(song?.downloadUrl) ? song.downloadUrl : [];
  const sorted = downloadUrl
    .map((entry) => ({
      quality: Number(entry?.quality || 0),
      bitrate: Number(String(entry?.quality || '').replace(/[^0-9]/g, '')),
      url: entry?.url || '',
    }))
    .filter((entry) => entry.url)
    .sort((a, b) => (b.bitrate || b.quality) - (a.bitrate || a.quality));

  if (sorted.length > 0) {
    return sorted[0].url;
  }

  return song?.audioUrl || song?.url || '';
};

const pickArtist = (song) => {
  const primary = song?.artists?.primary;
  if (Array.isArray(primary) && primary.length > 0) {
    return primary
      .map((entry) => entry?.name)
      .filter(Boolean)
      .join(', ');
  }

  if (song?.artist) {
    return song.artist;
  }

  if (song?.primaryArtists) {
    return song.primaryArtists;
  }

  if (song?.subtitle) {
    return song.subtitle;
  }

  return 'Unknown Artist';
};

const normalizeSong = (song) => {
  if (!song) {
    return null;
  }

  const id = String(song.id || song.songid || '').trim();
  if (!id) {
    return null;
  }

  const name = String(song.name || song.title || '').trim() || 'Unknown Title';
  const artist = String(pickArtist(song)).trim() || 'Unknown Artist';
  const album = String(song.album?.name || song.album || song.more_info?.album || '').trim();
  const duration = clamp(Number(song.duration || 0), 0, Number.MAX_SAFE_INTEGER);
  const image = pickImageUrl(song.image || song.images || song.more_info?.image);
  const audioUrl = pickAudioUrl(song);

  return {
    id,
    name,
    artist,
    album,
    duration,
    language: song.language || song.lang || 'unknown',
    year: String(song.year || song.releaseYear || '').trim(),
    url: song.url || song.perma_url || '',
    audioUrl,
    image,
    hasLyrics: Boolean(song.hasLyrics || song.has_lyrics),
    source: 'jiosaavn',
  };
};

const extractSongResults = (payload) => {
  const data = payload?.data || payload;

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  if (Array.isArray(data?.songs?.results)) {
    return data.songs.results;
  }

  if (Array.isArray(data?.songs)) {
    return data.songs;
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  return [];
};

const scoreByQuery = (song, query) => {
  const q = String(query || '').toLowerCase().trim();
  if (!q) {
    return 0;
  }

  const full = `${song.name} ${song.artist}`.toLowerCase();
  if (full === q) {
    return 200;
  }

  if (song.name.toLowerCase() === q) {
    return 180;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (song.name.toLowerCase().includes(token)) {
      score += 24;
    }
    if (song.artist.toLowerCase().includes(token)) {
      score += 10;
    }
    if (full.includes(token)) {
      score += 6;
    }
  }

  if (song.hasLyrics) {
    score += 4;
  }

  return score;
};

const searchSongs = async (query, limit = 20) => {
  const q = encodeURIComponent(query);
  const payload = await requestViaJiosaavnApis([
    `/search/songs?query=${q}&limit=${limit}`,
    `/search/song?query=${q}&limit=${limit}`,
    `/search?query=${q}&type=song&limit=${limit}`,
  ]);

  return extractSongResults(payload).map(normalizeSong).filter(Boolean);
};

const getSongById = async (songId) => {
  const encoded = encodeURIComponent(songId);
  const payload = await requestViaJiosaavnApis([
    `/songs/${encoded}`,
    `/songs?id=${encoded}`,
    `/song?id=${encoded}`,
  ]);

  const songs = extractSongResults(payload).map(normalizeSong).filter(Boolean);
  return songs[0] || null;
};

const getPlaylistSongs = async (playlistId) => {
  const encoded = encodeURIComponent(playlistId);
  const payload = await requestViaJiosaavnApis([
    `/playlists?id=${encoded}`,
    `/playlist?id=${encoded}`,
  ]);

  const data = payload?.data || payload;
  const songs = Array.isArray(data?.songs) ? data.songs : [];
  return songs.map(normalizeSong).filter(Boolean);
};

const dedupeSongs = (songs) => {
  const seen = new Set();
  const deduped = [];

  for (const song of songs) {
    if (!song?.id || seen.has(song.id)) {
      continue;
    }
    seen.add(song.id);
    deduped.push(song);
  }

  return deduped;
};

const getTrendingCandidates = async () => {
  const playlistIds = ['110858205', '153448588', '55220604'];
  const searchSeeds = [
    'top 50 india',
    'viral songs',
    'hindi trending songs',
    'global trending songs',
    'new releases bollywood',
  ];

  const candidates = [];

  for (const playlistId of playlistIds) {
    try {
      const songs = await getPlaylistSongs(playlistId);
      candidates.push(...songs);
    } catch (error) {
      continue;
    }
  }

  for (const seed of searchSeeds) {
    try {
      const songs = await searchSongs(seed, 14);
      candidates.push(...songs);
    } catch (error) {
      continue;
    }
  }

  return dedupeSongs(candidates);
};

const parseSyncedLyrics = (syncedLyrics, fallbackDuration) => {
  const entries = [];
  const lines = String(syncedLyrics || '').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (!match) {
      continue;
    }

    const minutes = Number(match[1] || 0);
    const seconds = Number(match[2] || 0);
    const msRaw = String(match[3] || '').padEnd(3, '0');
    const millis = Number(msRaw || 0);
    const text = String(match[4] || '').trim();

    if (!text) {
      continue;
    }

    const start = minutes * 60 + seconds + (millis / 1000);
    entries.push({text, start});
  }

  entries.sort((a, b) => a.start - b.start);

  if (entries.length === 0) {
    return [];
  }

  const output = [];
  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const next = entries[i + 1];
    const safeEnd = next ? next.start : Math.max(Number(fallbackDuration || 0), current.start + 2);
    const end = Math.max(current.start + 0.5, safeEnd);
    output.push({
      text: current.text,
      start: Number(current.start.toFixed(3)),
      end: Number(end.toFixed(3)),
    });
  }

  return output;
};

const buildPlainTimeline = (plainLyrics, duration) => {
  const plainLines = String(plainLyrics || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (plainLines.length === 0) {
    return [];
  }

  const usableDuration = Math.max(Number(duration || 0), plainLines.length * 2);
  const slot = usableDuration / plainLines.length;
  const output = [];

  for (let i = 0; i < plainLines.length; i++) {
    const start = i * slot;
    const end = (i + 1) * slot;
    output.push({
      text: plainLines[i],
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
    });
  }

  return output;
};

const fetchLyricsFromLrclib = async (song) => {
  const params = new URLSearchParams({
    track_name: song.name,
    artist_name: song.artist,
  });

  if (song.album) {
    params.set('album_name', song.album);
  }

  const searchUrl = `${normalizeBaseUrl(LRCLIB_API)}/search?${params.toString()}`;
  const payload = await requestJson(searchUrl, 18000);
  const candidates = Array.isArray(payload) ? payload : [];

  if (candidates.length === 0) {
    return {
      provider: 'lrclib',
      hasSyncedLyrics: false,
      hasPlainLyrics: false,
      reference: null,
      lines: [],
    };
  }

  const songDuration = Number(song.duration || 0);
  const ranked = candidates
    .map((entry) => {
      const title = String(entry?.trackName || '').toLowerCase();
      const artist = String(entry?.artistName || '').toLowerCase();
      const titleScore = title.includes(song.name.toLowerCase()) ? 40 : 0;
      const artistScore = artist.includes(song.artist.toLowerCase().split(',')[0]) ? 30 : 0;
      const syncedScore = entry?.syncedLyrics ? 40 : 0;
      const plainScore = entry?.plainLyrics ? 12 : 0;
      const durationDelta = Math.abs(Number(entry?.duration || 0) - songDuration);
      const durationScore = songDuration > 0 ? Math.max(0, 20 - Math.min(20, durationDelta / 2)) : 0;

      return {
        entry,
        score: titleScore + artistScore + syncedScore + plainScore + durationScore,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.entry;
  const syncedLines = parseSyncedLyrics(best?.syncedLyrics || '', songDuration);
  const plainLines = buildPlainTimeline(best?.plainLyrics || '', songDuration);

  return {
    provider: 'lrclib',
    hasSyncedLyrics: syncedLines.length > 0,
    hasPlainLyrics: plainLines.length > 0,
    reference: {
      id: best?.id || null,
      trackName: best?.trackName || song.name,
      artistName: best?.artistName || song.artist,
      albumName: best?.albumName || song.album,
    },
    lines: syncedLines.length > 0 ? syncedLines : plainLines,
  };
};

const selectSong = async ({songId, query, autoMode, history, allowRepeat}) => {
  const historyIds = new Set((history?.songs || []).map((entry) => entry?.id).filter(Boolean));

  if (songId) {
    const direct = await getSongById(songId);
    if (!direct) {
      throw new Error(`Song with ID "${songId}" was not found`);
    }

    return {
      song: direct,
      selectionMethod: 'direct-id',
      sourceCount: 1,
    };
  }

  if (query) {
    const songs = await searchSongs(query, 30);
    if (songs.length === 0) {
      throw new Error(`No songs found for query "${query}"`);
    }

    const ranked = songs
      .map((song) => {
        const repeatPenalty = historyIds.has(song.id) && !allowRepeat ? -250 : 0;
        return {
          song,
          score: scoreByQuery(song, query) + repeatPenalty,
        };
      })
      .sort((a, b) => b.score - a.score);

    const chosen = ranked[0]?.song;
    if (!chosen) {
      throw new Error(`Unable to choose a song for query "${query}"`);
    }

    return {
      song: chosen,
      selectionMethod: 'query-best-match',
      sourceCount: songs.length,
    };
  }

  if (autoMode === 'trending' || !query) {
    const trending = await getTrendingCandidates();
    if (trending.length === 0) {
      throw new Error('Unable to fetch trending candidates from JioSaavn');
    }

    let chosen = trending.find((song) => !historyIds.has(song.id));
    if (!chosen) {
      chosen = trending[0];
    }

    return {
      song: chosen,
      selectionMethod: 'trending-auto',
      sourceCount: trending.length,
    };
  }

  throw new Error('No valid song selection mode found');
};

const buildTemplatePayload = ({songId, query}) => {
  const payload = cloneJson(templateSongData);

  payload.metadata = payload.metadata || {};
  payload.metadata.generatedAt = new Date().toISOString();
  payload.metadata.phase = 3;
  payload.metadata.pipelineMode = 'template-only';

  if (songId) {
    payload.song = payload.song || {};
    payload.song.id = songId;
    payload.metadata.songSelectionMethod = 'direct-id-template';
  }

  if (query) {
    payload.metadata.query = query;
    if (!songId) {
      payload.metadata.songSelectionMethod = 'query-template';
    }
  }

  return payload;
};

const buildProductionPayload = ({song, lyrics, selectionMethod, query, autoMode}) => {
  const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];
  const fallbackLines =
    lines.length > 0
      ? lines
      : [
          {
            text: `${song.name} - ${song.artist}`,
            start: 0,
            end: Math.max(Number(song.duration || 0), 12),
          },
        ];

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 3,
      timingMode: lyrics?.hasSyncedLyrics ? 'synced' : 'estimated',
      songSelectionMethod: selectionMethod,
      sourceApis: {
        jiosaavn: loadEndpoints(),
        lyrics: 'lrclib',
        lyricsMatchMode: lyrics?.hasSyncedLyrics ? 'search-synced' : 'search-plain-fallback',
      },
      pipelineMode: 'production-auto',
      autoMode: autoMode || 'manual',
      query: query || '',
    },
    song,
    lyricsRaw: {
      provider: 'lrclib',
      hasSyncedLyrics: Boolean(lyrics?.hasSyncedLyrics),
      hasPlainLyrics: Boolean(lyrics?.hasPlainLyrics),
      reference: lyrics?.reference || null,
    },
    lines: fallbackLines,
  };
};

const runPhase3Build = async ({songId, query, autoMode, allowRepeat, historyFile, out}) => {
  if (songId === 'TEST_TEMPLATE') {
    const payload = buildTemplatePayload({songId, query});
    await fs.mkdir(path.dirname(out), {recursive: true});
    await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

    return {
      out,
      lineCount: payload.lines?.length || 0,
      song: payload.song?.name || '',
      artist: payload.song?.artist || '',
      selectionMethod: payload.metadata?.songSelectionMethod || 'direct-id-template',
      historyFile,
      historyUpdated: false,
    };
  }

  const history = await loadHistory(historyFile);
  const selection = await selectSong({songId, query, autoMode, history, allowRepeat});
  const lyrics = await fetchLyricsFromLrclib(selection.song);
  const payload = buildProductionPayload({
    song: selection.song,
    lyrics,
    selectionMethod: selection.selectionMethod,
    query,
    autoMode,
  });

  const nextHistory = {
    ...history,
    songs: [
      ...(history?.songs || []),
      {
        id: selection.song.id,
        name: selection.song.name,
        artist: selection.song.artist,
        selectedAt: new Date().toISOString(),
        selectionMethod: selection.selectionMethod,
        query: query || null,
      },
    ],
  };

  await fs.mkdir(path.dirname(out), {recursive: true});
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  await saveHistory(historyFile, nextHistory);

  return {
    out,
    lineCount: payload.lines?.length || 0,
    song: payload.song?.name || '',
    artist: payload.song?.artist || '',
    selectionMethod: selection.selectionMethod,
    historyFile,
    historyUpdated: true,
    sourceCount: selection.sourceCount,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPhase3Build(args);

  console.log('[phase3] Lyrics payload generated');
  console.log(`[phase3] Output: ${path.relative(PROJECT_ROOT, result.out)}`);
  console.log(`[phase3] Song: ${result.song} - ${result.artist}`);
  console.log(`[phase3] Selection: ${result.selectionMethod}`);
  console.log(`[phase3] Timeline lines: ${result.lineCount}`);
  if (result.historyUpdated) {
    console.log(`[phase3] History updated: ${path.relative(PROJECT_ROOT, result.historyFile)}`);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[phase3] Failed: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  runPhase3Build,
};
