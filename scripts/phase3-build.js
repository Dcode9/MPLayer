#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const fallbackTemplate = require('../remotion/template-song-data.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const JIOSAAVN_API_ENDPOINTS = [
  'https://jiosaavn-api-taupe-phi.vercel.app/api',
  'https://jiosaavn-api-v2.vercel.app/api',
  'https://saavn.me/api',
  'https://jio-saavn-api-red.vercel.app/api',
];

const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
const POLLINATIONS_TEXT_BASE_URL = 'https://text.pollinations.ai';

const AUTO_QUERY_FALLBACKS = [
  'global trending songs',
  'top hindi songs',
  'viral english songs',
  'indie pop hits',
  'old is gold classics',
  'retro bollywood hits',
];

const parsePositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
};

const parseBoolean = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const decodeHtml = (text) => {
  if (!text) {
    return '';
  }

  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
};

const roundTo = (value, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const parseArgs = (argv) => {
  const args = {
    out: path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'),
    historyFile: path.join(PROJECT_ROOT, 'data', 'song-history.json'),
    songId: '',
    query: '',
    mode: 'query',
    allowRepeat: false,
    pollinationsTextModel: process.env.POLLINATIONS_TEXT_MODEL || 'glm',
    autoPoolSize: parsePositiveNumber(process.env.PHASE3_AUTO_POOL_SIZE || '40') || 40,
  };

  for (const arg of argv) {
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      args.out = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--history=')) {
      const value = arg.slice('--history='.length).trim();
      args.historyFile = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--song-id=')) {
      args.songId = arg.slice('--song-id='.length).trim();
    } else if (arg.startsWith('--query=')) {
      args.query = arg.slice('--query='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      args.mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg.startsWith('--allow-repeat=')) {
      args.allowRepeat = parseBoolean(arg.slice('--allow-repeat='.length).trim());
    } else if (arg === '--auto-trending') {
      args.mode = 'auto-trending';
    } else if (arg.startsWith('--pollinations-text-model=')) {
      const value = arg.slice('--pollinations-text-model='.length).trim();
      if (value) {
        args.pollinationsTextModel = value;
      }
    } else if (arg.startsWith('--auto-pool-size=')) {
      const value = parsePositiveNumber(arg.slice('--auto-pool-size='.length).trim());
      if (value > 0) {
        args.autoPoolSize = value;
      }
    }
  }

  if (!args.songId && !args.query && args.mode === 'query') {
    args.mode = 'auto-trending';
  }

  return args;
};

const fetchJson = async (url, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MPLayer-Phase3/1.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const fetchText = async (url, timeoutMs = 25000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MPLayer-Phase3/1.0',
        Accept: 'text/plain, application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const fetchFromJioSaavn = async (buildPath) => {
  const errors = [];

  for (const endpoint of JIOSAAVN_API_ENDPOINTS) {
    const url = `${endpoint}${buildPath}`;

    try {
      const payload = await fetchJson(url);
      if (payload?.success === false) {
        throw new Error(payload?.message || 'API returned success=false');
      }
      return payload;
    } catch (error) {
      errors.push(`${endpoint}: ${error.message || error}`);
    }
  }

  throw new Error(`All JioSaavn endpoints failed. ${errors.join(' | ')}`);
};

const pickBestImage = (imageArray) => {
  if (!Array.isArray(imageArray) || imageArray.length === 0) {
    return '';
  }

  const highest = imageArray[imageArray.length - 1]?.url;
  if (highest) {
    return highest;
  }

  const mid = imageArray[Math.max(0, imageArray.length - 2)]?.url;
  if (mid) {
    return mid;
  }

  return imageArray[0]?.url || '';
};

const pickBestAudioUrl = (downloadUrls) => {
  if (!Array.isArray(downloadUrls) || downloadUrls.length === 0) {
    return '';
  }

  const qualityRank = (item) => {
    const qualityText = String(item?.quality || '0').replace(/[^0-9]/g, '');
    const quality = Number(qualityText || '0');
    return Number.isFinite(quality) ? quality : 0;
  };

  const sorted = [...downloadUrls].sort((a, b) => qualityRank(a) - qualityRank(b));
  const best = sorted[sorted.length - 1]?.url || '';
  if (best) {
    return best;
  }

  return downloadUrls[downloadUrls.length - 1]?.url || '';
};

const normalizeSong = (song) => {
  if (!song?.id) {
    return null;
  }

  const artistFromPrimary = song?.artists?.primary?.map((artist) => artist?.name).filter(Boolean).join(', ');

  const normalized = {
    id: String(song.id),
    name: decodeHtml(song?.name || song?.title || 'Unknown Song'),
    artist: decodeHtml(artistFromPrimary || song?.primaryArtists || 'Unknown Artist'),
    album: decodeHtml(song?.album?.name || song?.album?.title || 'Unknown Album'),
    duration: Number(song?.duration || 0),
    language: String(song?.language || 'unknown'),
    year: String(song?.year || ''),
    url: song?.url || '',
    audioUrl: pickBestAudioUrl(song?.downloadUrl),
    image: pickBestImage(song?.image),
    hasLyrics: Boolean(song?.hasLyrics),
    source: 'jiosaavn',
  };

  return normalized;
};

const searchSongs = async (query, limit = 12) => {
  if (!query) {
    return [];
  }

  const payload = await fetchFromJioSaavn(`/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`);
  const rawSongs = payload?.data?.results || [];
  return rawSongs.map(normalizeSong).filter(Boolean);
};

const getSongById = async (songId) => {
  if (!songId) {
    return null;
  }

  const payload = await fetchFromJioSaavn(`/songs/${encodeURIComponent(songId)}`);
  const rawSong = Array.isArray(payload?.data) ? payload.data[0] : null;
  return normalizeSong(rawSong);
};

const getTrendingSongs = async () => {
  const payload = await fetchFromJioSaavn('/playlists?id=110858205');
  const rawSongs = payload?.data?.songs || [];
  return rawSongs.map(normalizeSong).filter(Boolean);
};

const uniqueSongs = (songs) => {
  const seen = new Set();
  const result = [];

  for (const song of songs) {
    if (!song?.id || seen.has(song.id)) {
      continue;
    }
    seen.add(song.id);
    result.push(song);
  }

  return result;
};

const scoreSongForQuery = (song, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = `${song?.name || ''} ${song?.artist || ''}`.toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 5;
    }
    if ((song?.name || '').toLowerCase().includes(token)) {
      score += 8;
    }
  }

  if ((song?.name || '').toLowerCase() === normalizedQuery) {
    score += 20;
  }

  return score;
};

const parseJsonFromText = (rawText) => {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    const objectMatch = String(rawText).match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (innerError) {
        return null;
      }
    }
  }

  return null;
};

const fetchAiTrendingQueries = async (model) => {
  try {
    const prompt = [
      'System: You are a music trend assistant.',
      'Return valid JSON only with this exact schema:',
      '{"queries":["query1","query2","query3","query4","query5"]}',
      'Task: Provide five short search queries for globally popular songs and one retro-popular bucket for lyric videos.',
    ].join('\n');

    const url = `${POLLINATIONS_TEXT_BASE_URL}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model || 'glm')}`;
    const text = await fetchText(url, 25000);
    const parsed = parseJsonFromText(text);

    if (!parsed || !Array.isArray(parsed.queries)) {
      return [];
    }

    return parsed.queries
      .map((query) => String(query || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch (error) {
    return [];
  }
};

const loadHistory = async (historyFile) => {
  try {
    const raw = await fs.readFile(historyFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      updatedAt: parsed?.updatedAt || null,
      seenSongIds: Array.isArray(parsed?.seenSongIds) ? parsed.seenSongIds.map(String) : [],
      recentSongs: Array.isArray(parsed?.recentSongs) ? parsed.recentSongs : [],
    };
  } catch (error) {
    return {
      updatedAt: null,
      seenSongIds: [],
      recentSongs: [],
    };
  }
};

const saveHistory = async (historyFile, history) => {
  await fs.mkdir(path.dirname(historyFile), {recursive: true});
  await fs.writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`, 'utf-8');
};

const chooseSong = ({candidates, history, allowRepeat}) => {
  const deduped = uniqueSongs(candidates);
  if (deduped.length === 0) {
    return null;
  }

  if (allowRepeat) {
    return deduped[0];
  }

  const unseen = deduped.filter((song) => !history.seenSongIds.includes(song.id));
  if (unseen.length > 0) {
    return unseen[0];
  }

  const lastSongId = history.recentSongs[0]?.id || '';
  const notLatest = deduped.find((song) => song.id !== lastSongId);
  if (notLatest) {
    return notLatest;
  }

  return deduped[0];
};

const pickSong = async ({songId, query, mode, history, allowRepeat, autoPoolSize, pollinationsTextModel}) => {
  if (songId) {
    const directSong = await getSongById(songId);
    if (!directSong) {
      throw new Error(`Song not found for ID: ${songId}`);
    }
    return {
      song: directSong,
      songSelectionMethod: 'direct-id',
      candidateCount: 1,
      queryUsed: query || null,
    };
  }

  if (mode === 'auto-trending') {
    const candidates = [];

    const trending = await getTrendingSongs();
    candidates.push(...trending);

    const aiQueries = await fetchAiTrendingQueries(pollinationsTextModel);
    const queryPool = uniqueSongs(
      aiQueries
        .concat(AUTO_QUERY_FALLBACKS)
        .map((item) => ({id: item, name: item, artist: '', audioUrl: ''})),
    ).map((entry) => entry.id);

    for (const autoQuery of queryPool) {
      if (candidates.length >= autoPoolSize) {
        break;
      }
      try {
        const found = await searchSongs(autoQuery, 5);
        candidates.push(...found);
      } catch (error) {
        // Ignore individual auto query failures.
      }
    }

    const chosen = chooseSong({candidates, history, allowRepeat});
    if (!chosen) {
      throw new Error('Could not find a trending song candidate');
    }

    return {
      song: chosen,
      songSelectionMethod: 'auto-trending',
      candidateCount: uniqueSongs(candidates).length,
      queryUsed: null,
    };
  }

  if (!query) {
    throw new Error('Query mode requires --query');
  }

  const searchResults = await searchSongs(query, 12);
  const scored = [...searchResults]
    .map((song) => ({song, score: scoreSongForQuery(song, query)}))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.song);

  const chosen = chooseSong({candidates: scored, history, allowRepeat});
  if (!chosen) {
    throw new Error(`No song match found for query: ${query}`);
  }

  return {
    song: chosen,
    songSelectionMethod: 'search-best-match',
    candidateCount: scored.length,
    queryUsed: query,
  };
};

const parseSyncedLyrics = (syncedLyrics, songDuration) => {
  const raw = String(syncedLyrics || '').trim();
  if (!raw) {
    return [];
  }

  const regex = /^\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]\s*(.*)$/;
  const entries = [];

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(regex);
    if (!match) {
      continue;
    }

    const minute = Number(match[1] || '0');
    const seconds = Number(match[2] || '0');
    const text = String(match[3] || '').trim();

    if (!Number.isFinite(minute) || !Number.isFinite(seconds) || !text) {
      continue;
    }

    const start = (minute * 60) + seconds;
    entries.push({start, text});
  }

  entries.sort((a, b) => a.start - b.start);

  const deduped = [];
  let lastStart = -1;
  for (const entry of entries) {
    if (entry.start <= lastStart) {
      continue;
    }
    deduped.push(entry);
    lastStart = entry.start;
  }

  const resolvedDuration = Number(songDuration || 0) > 0 ? Number(songDuration) : 180;

  return deduped.map((entry, index) => {
    const nextStart = deduped[index + 1]?.start;
    let end = Number.isFinite(nextStart) ? nextStart : resolvedDuration;
    if (!Number.isFinite(end) || end <= entry.start) {
      end = entry.start + 2;
    }
    return {
      text: entry.text,
      start: roundTo(entry.start),
      end: roundTo(end),
    };
  });
};

const estimateLyricsFromPlainText = (plainLyrics, songDuration) => {
  const lines = String(plainLyrics || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 300);

  if (lines.length === 0) {
    return [];
  }

  const duration = Number(songDuration || 0) > 0 ? Number(songDuration) : Math.max(120, lines.length * 3);
  const perLine = duration / lines.length;

  return lines.map((text, index) => {
    const start = index * perLine;
    const end = (index + 1) * perLine;
    return {
      text,
      start: roundTo(start),
      end: roundTo(Math.max(end, start + 1.2)),
    };
  });
};

const fetchLyricsFromLrcLib = async (song) => {
  const trackName = song?.name || '';
  const artistName = song?.artist || '';
  const albumName = song?.album || '';

  if (!trackName || !artistName) {
    return {
      provider: 'lrclib',
      hasSyncedLyrics: false,
      hasPlainLyrics: false,
      reference: null,
      lines: [],
    };
  }

  const searchParams = new URLSearchParams({
    track_name: trackName,
    artist_name: artistName,
    album_name: albumName,
  });

  const url = `${LRCLIB_SEARCH_URL}?${searchParams.toString()}`;

  let results = [];
  try {
    const payload = await fetchJson(url, 25000);
    results = Array.isArray(payload) ? payload : [];
  } catch (error) {
    results = [];
  }

  if (results.length === 0) {
    const fallbackParams = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    });
    const fallbackUrl = `${LRCLIB_SEARCH_URL}?${fallbackParams.toString()}`;

    try {
      const payload = await fetchJson(fallbackUrl, 25000);
      results = Array.isArray(payload) ? payload : [];
    } catch (error) {
      results = [];
    }
  }

  const scored = results
    .map((entry) => {
      const entryTrack = String(entry?.trackName || '').toLowerCase();
      const entryArtist = String(entry?.artistName || '').toLowerCase();
      const entryDuration = Number(entry?.duration || 0);

      let score = 0;
      if (entryTrack.includes(trackName.toLowerCase())) {
        score += 30;
      }
      if (trackName.toLowerCase().includes(entryTrack)) {
        score += 15;
      }
      if (entryArtist.includes(artistName.toLowerCase()) || artistName.toLowerCase().includes(entryArtist)) {
        score += 25;
      }

      const durationGap = Math.abs(entryDuration - Number(song?.duration || 0));
      score -= Math.min(15, durationGap / 2);

      return {entry, score};
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.entry || null;

  if (!best) {
    return {
      provider: 'lrclib',
      hasSyncedLyrics: false,
      hasPlainLyrics: false,
      reference: null,
      lines: [],
    };
  }

  const syncedLines = parseSyncedLyrics(best?.syncedLyrics, song?.duration);
  const plainLines = estimateLyricsFromPlainText(best?.plainLyrics, song?.duration);
  const lines = syncedLines.length > 0 ? syncedLines : plainLines;

  return {
    provider: 'lrclib',
    hasSyncedLyrics: syncedLines.length > 0,
    hasPlainLyrics: plainLines.length > 0,
    reference: {
      id: best?.id || null,
      trackName: best?.trackName || null,
      artistName: best?.artistName || null,
      albumName: best?.albumName || null,
    },
    lines,
  };
};

const buildFallbackPayload = ({songId, query}) => {
  const payload = JSON.parse(JSON.stringify(fallbackTemplate));
  payload.metadata = payload.metadata || {};
  payload.metadata.generatedAt = new Date().toISOString();
  payload.metadata.phase = 3;
  payload.metadata.pipelineMode = 'fallback-template';
  payload.metadata.songSelectionMethod = songId ? 'direct-id-fallback' : 'query-fallback';
  payload.metadata.query = query || null;
  return payload;
};

const buildPhase3Payload = ({song, lyricsResult, songSelectionMethod, mode, query, candidateCount}) => {
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 3,
      timingMode: lyricsResult.hasSyncedLyrics ? 'synced' : 'estimated',
      songSelectionMethod,
      sourceApis: {
        jiosaavn: JIOSAAVN_API_ENDPOINTS[0],
        lyrics: 'lrclib',
        lyricsMatchMode: lyricsResult.hasSyncedLyrics ? 'synced-best-match' : 'plain-estimated',
      },
      pipelineMode: mode === 'auto-trending' ? 'production-auto-trending' : 'production-query',
      query: query || null,
      candidateCount,
    },
    song: {
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      language: song.language,
      year: song.year,
      url: song.url,
      audioUrl: song.audioUrl,
      image: song.image,
      hasLyrics: lyricsResult.lines.length > 0,
      source: 'jiosaavn',
    },
    lyricsRaw: {
      provider: lyricsResult.provider,
      hasSyncedLyrics: lyricsResult.hasSyncedLyrics,
      hasPlainLyrics: lyricsResult.hasPlainLyrics,
      reference: lyricsResult.reference,
    },
    lines: lyricsResult.lines,
  };
};

const runPhase3Build = async ({songId, query, out, historyFile, mode, allowRepeat, autoPoolSize, pollinationsTextModel}) => {
  const history = await loadHistory(historyFile);

  let payload;
  let selectedSong;
  let selectionSummary = {};

  try {
    const selection = await pickSong({
      songId,
      query,
      mode,
      history,
      allowRepeat,
      autoPoolSize,
      pollinationsTextModel,
    });

    const detailedSong = (await getSongById(selection.song.id)) || selection.song;
    selectedSong = {
      ...selection.song,
      ...detailedSong,
    };

    if (!selectedSong.audioUrl) {
      throw new Error(`Selected song has no streamable audio URL: ${selectedSong.id}`);
    }

    const lyricsResult = await fetchLyricsFromLrcLib(selectedSong);

    payload = buildPhase3Payload({
      song: selectedSong,
      lyricsResult,
      songSelectionMethod: selection.songSelectionMethod,
      mode,
      query: selection.queryUsed || query,
      candidateCount: selection.candidateCount,
    });

    history.updatedAt = new Date().toISOString();
    if (!history.seenSongIds.includes(selectedSong.id)) {
      history.seenSongIds.push(selectedSong.id);
    }
    history.recentSongs.unshift({
      id: selectedSong.id,
      name: selectedSong.name,
      artist: selectedSong.artist,
      selectedAt: history.updatedAt,
      mode,
      query: selection.queryUsed || query || null,
    });
    history.recentSongs = history.recentSongs.slice(0, 500);

    await saveHistory(historyFile, history);

    selectionSummary = {
      usedFallback: false,
      songSelectionMethod: selection.songSelectionMethod,
      candidateCount: selection.candidateCount,
    };
  } catch (error) {
    payload = buildFallbackPayload({songId, query});
    selectedSong = {
      name: payload?.song?.name || 'Unknown',
      artist: payload?.song?.artist || 'Unknown',
    };
    selectionSummary = {
      usedFallback: true,
      fallbackReason: error.message || String(error),
      songSelectionMethod: payload?.metadata?.songSelectionMethod || 'fallback',
      candidateCount: 0,
    };
  }

  await fs.mkdir(path.dirname(out), {recursive: true});
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  return {
    out,
    lineCount: payload?.lines?.length || 0,
    song: selectedSong?.name || '',
    artist: selectedSong?.artist || '',
    selectionSummary,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPhase3Build(args);

  console.log('[phase3] Lyrics payload generated');
  console.log(`[phase3] Output: ${path.relative(PROJECT_ROOT, result.out)}`);
  console.log(`[phase3] Song: ${result.song} - ${result.artist}`);
  console.log(`[phase3] Timeline lines: ${result.lineCount}`);

  if (result.selectionSummary?.usedFallback) {
    console.log(`[phase3] Fallback mode active: ${result.selectionSummary.fallbackReason}`);
  } else {
    console.log(`[phase3] Selection method: ${result.selectionSummary.songSelectionMethod}`);
    console.log(`[phase3] Candidate pool: ${result.selectionSummary.candidateCount}`);
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
