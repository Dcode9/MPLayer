const fs = require('node:fs/promises');
const path = require('node:path');
const {resolveSongMetadata} = require('./lib/jiosaavn-client');
const {fetchLyricsWithFallback} = require('./lib/lyrics-client');
const {buildTimeline} = require('./lib/lyrics-transform');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const parseArgs = (argv) => {
  const options = {
    query: process.env.SONG_QUERY || '',
    songId: process.env.SONG_ID || '',
    out: process.env.PHASE3_OUTPUT_JSON || 'data/lyrics-video-input.json',
  };

  for (const arg of argv) {
    if (arg.startsWith('--query=')) {
      options.query = arg.slice('--query='.length);
    } else if (arg.startsWith('--song-id=')) {
      options.songId = arg.slice('--song-id='.length);
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
    }
  }

  if (!options.query && !options.songId) {
    throw new Error('Provide --query="song name" or --song-id="id" (or SONG_QUERY/SONG_ID env).');
  }

  return options;
};

const resolveOutputPath = (filePath) => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.join(PROJECT_ROOT, filePath);
};

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(2));

    console.log('[phase-3] Resolving song metadata from JioSaavn...');
    const songResolution = await resolveSongMetadata({
      songId: options.songId,
      query: options.query,
    });

    const {song} = songResolution;
    console.log(`[phase-3] Selected song: ${song.name} - ${song.artist}`);

    console.log('[phase-3] Fetching lyrics (prefer synced/LRC)...');
    const lyricPayload = await fetchLyricsWithFallback(song);

    console.log('[phase-3] Converting lyrics to Remotion timeline JSON...');
    const timeline = buildTimeline({
      syncedLyrics: lyricPayload.syncedLyrics,
      plainLyrics: lyricPayload.plainLyrics,
      durationInSeconds: song.duration,
    });

    if (timeline.lines.length === 0) {
      throw new Error('No lyrics found from synced or plain providers for this song.');
    }

    const output = {
      metadata: {
        generatedAt: new Date().toISOString(),
        phase: 3,
        timingMode: timeline.timingMode,
        songSelectionMethod: songResolution.selectionMethod,
        sourceApis: {
          jiosaavn: songResolution.endpoint,
          lyrics: lyricPayload.provider,
          lyricsMatchMode: lyricPayload.matchedBy,
        },
      },
      song,
      lyricsRaw: {
        provider: lyricPayload.provider,
        hasSyncedLyrics: Boolean(lyricPayload.syncedLyrics),
        hasPlainLyrics: Boolean(lyricPayload.plainLyrics),
        reference: lyricPayload.raw,
      },
      lines: timeline.lines,
    };

    const outputPath = resolveOutputPath(options.out);
    await fs.mkdir(path.dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

    console.log(`[phase-3] Lyrics JSON written to: ${path.relative(PROJECT_ROOT, outputPath)}`);
    console.log(`[phase-3] Timing mode: ${timeline.timingMode}`);
    console.log(`[phase-3] Total lyric lines: ${timeline.lines.length}`);
  } catch (error) {
    console.error('[phase-3] Failed:', error.message);
    process.exit(1);
  }
};

main();
