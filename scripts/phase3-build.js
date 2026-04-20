#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const templateSongData = require('../remotion/template-song-data.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TRENDING_FALLBACK_QUERY = String(process.env.PHASE3_TRENDING_FALLBACK_QUERY || 'Aaj Ki Raat').trim() || 'Aaj Ki Raat';
const TRENDING_FETCH_TIMEOUT_MS = Number(process.env.PHASE3_TRENDING_FETCH_TIMEOUT_MS || 5000);
const APPLE_MUSIC_TRENDING_URL = 'https://rss.applemarketingtools.com/api/v2/in/music/most-played/25/songs.json';

const parseArgs = (argv) => {
  const args = {
    out: path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'),
    songId: '',
    query: '',
    autoTrending: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      args.out = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--song-id=')) {
      args.songId = arg.slice('--song-id='.length).trim();
    } else if (arg.startsWith('--query=')) {
      args.query = arg.slice('--query='.length).trim();
    } else if (arg === '--auto-trending') {
      args.autoTrending = true;
    }
  }

  return args;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const fetchTrendingSongQuery = async () => {
  try {
    const response = await fetch(APPLE_MUSIC_TRENDING_URL, {
      signal: AbortSignal.timeout(TRENDING_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {query: TRENDING_FALLBACK_QUERY, source: 'fallback'};
    }

    const payload = await response.json();
    const firstSong = payload?.feed?.results?.[0];
    const title = String(firstSong?.name || '').trim();
    const artist = String(firstSong?.artistName || '').trim();

    if (!title || !artist) {
      return {query: TRENDING_FALLBACK_QUERY, source: 'fallback'};
    }

    return {
      query: `${title} ${artist}`,
      source: 'apple-music-trending',
    };
  } catch (_error) {
    return {query: TRENDING_FALLBACK_QUERY, source: 'fallback'};
  }
};

const buildTemplatePayload = ({songId, query, songSelectionMethod, trendingSource}) => {
  const payload = cloneJson(templateSongData);

  payload.metadata = payload.metadata || {};
  payload.metadata.generatedAt = new Date().toISOString();
  payload.metadata.phase = 3;
  payload.metadata.pipelineMode = 'template-only';
  payload.metadata.songSelectionMethod = songSelectionMethod || payload.metadata.songSelectionMethod || 'template-default';

  if (songId) {
    payload.song = payload.song || {};
    payload.song.id = songId;
  }

  if (query) {
    payload.metadata.query = query;
  }

  if (trendingSource) {
    payload.metadata.trendingSource = trendingSource;
  }

  return payload;
};

const runPhase3Build = async ({songId, query, out, autoTrending}) => {
  const normalizedSongId = String(songId || '').trim();
  let normalizedQuery = String(query || '').trim();
  let songSelectionMethod = 'template-default';
  let trendingSource = '';

  if (normalizedSongId) {
    songSelectionMethod = 'direct-id-template';
  } else if (normalizedQuery) {
    songSelectionMethod = 'query-template';
  } else if (autoTrending || String(process.env.PHASE3_AUTO_TRENDING || '').trim() === '1') {
    const trending = await fetchTrendingSongQuery();
    normalizedQuery = trending.query;
    trendingSource = trending.source;
    songSelectionMethod = 'auto-trending-template';
  }

  const payload = buildTemplatePayload({
    songId: normalizedSongId,
    query: normalizedQuery,
    songSelectionMethod,
    trendingSource,
  });

  await fs.mkdir(path.dirname(out), {recursive: true});
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  return {
    out,
    lineCount: payload.lines?.length || 0,
    song: payload.song?.name || '',
    artist: payload.song?.artist || '',
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPhase3Build(args);

  console.log('[phase3] Template lyrics payload generated');
  console.log(`[phase3] Output: ${path.relative(PROJECT_ROOT, result.out)}`);
  console.log(`[phase3] Song: ${result.song} - ${result.artist}`);
  console.log(`[phase3] Timeline lines: ${result.lineCount}`);
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
