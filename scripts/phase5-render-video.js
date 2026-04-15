const fs = require('node:fs/promises');
const path = require('node:path');
const {bundle} = require('@remotion/bundler');
const {renderMedia, selectComposition} = require('@remotion/renderer');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENTRY_POINT = path.join(PROJECT_ROOT, 'remotion/index.jsx');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const HTTP_TIMEOUT_MS = Number(process.env.PHASE5_HTTP_TIMEOUT_MS || 20000);

const parseArgs = (argv) => {
  const options = {
    lyrics: process.env.PHASE5_LYRICS_JSON || 'data/phase3-lyrics.json',
    direction: process.env.PHASE5_DIRECTION_JSON || 'data/phase4-direction.json',
    output: process.env.PHASE5_OUTPUT_VIDEO || 'output/phase5-video.mp4',
    maxSeconds: Number(process.env.PHASE5_MAX_SECONDS || 0),
  };

  for (const arg of argv) {
    if (arg.startsWith('--lyrics=')) {
      options.lyrics = arg.slice('--lyrics='.length);
    } else if (arg.startsWith('--direction=')) {
      options.direction = arg.slice('--direction='.length);
    } else if (arg.startsWith('--out=')) {
      options.output = arg.slice('--out='.length);
    } else if (arg.startsWith('--max-seconds=')) {
      options.maxSeconds = Number(arg.slice('--max-seconds='.length));
    }
  }

  return options;
};

const resolveProjectPath = (targetPath) => {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.join(PROJECT_ROOT, targetPath);
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const inferAudioExtension = (audioUrl) => {
  const allowed = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.webm', '.mp4']);

  try {
    const parsed = new URL(audioUrl);
    const extension = path.extname(parsed.pathname).toLowerCase();
    return allowed.has(extension) ? extension : '.m4a';
  } catch (error) {
    return '.m4a';
  }
};

const downloadAudioToPublic = async (audioUrl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(audioUrl, {signal: controller.signal});
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const byteLength = arrayBuffer.byteLength || 0;
    if (byteLength < 1024) {
      throw new Error('Audio payload too small');
    }

    await fs.mkdir(PUBLIC_DIR, {recursive: true});
    const extension = inferAudioExtension(audioUrl);
    const fileName = `phase5-audio-source${extension}`;
    const targetPath = path.join(PUBLIC_DIR, fileName);
    await fs.writeFile(targetPath, Buffer.from(arrayBuffer));

    return {
      mode: 'static',
      src: fileName,
      sourceUrl: audioUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeDirection = (directionPayload) => {
  if (!directionPayload || typeof directionPayload !== 'object') {
    return {
      styleDescription: 'Fallback direction',
      palette: {},
      animationIdeas: [],
      sceneDirections: [],
      lineDirections: [],
    };
  }

  const direct = directionPayload.direction && typeof directionPayload.direction === 'object'
    ? directionPayload.direction
    : directionPayload;

  return {
    styleDescription: direct.styleDescription || 'Fallback direction',
    palette: direct.palette || {},
    animationIdeas: Array.isArray(direct.animationIdeas) ? direct.animationIdeas : [],
    sceneDirections: Array.isArray(direct.sceneDirections) ? direct.sceneDirections : [],
    lineDirections: Array.isArray(direct.lineDirections) ? direct.lineDirections : [],
  };
};

const normalizeLines = (payload) => {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  return lines
    .map((line) => ({
      text: String(line?.text || '').trim(),
      start: Number(line?.start),
      end: Number(line?.end),
    }))
    .filter((line) => line.text.length > 0)
    .filter((line) => Number.isFinite(line.start) && Number.isFinite(line.end))
    .filter((line) => line.end > line.start + 0.05)
    .sort((a, b) => a.start - b.start);
};

const trimPayloadForCi = ({lines, direction, maxSeconds}) => {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    return {lines, direction};
  }

  const lineIndexMap = new Map();
  const trimmedLines = [];

  lines.forEach((line, originalIndex) => {
    if (line.start >= maxSeconds) {
      return;
    }

    const end = Math.min(maxSeconds, line.end);
    if (end <= line.start + 0.05) {
      return;
    }

    const nextLine = {
      ...line,
      end,
    };

    lineIndexMap.set(originalIndex, trimmedLines.length);
    trimmedLines.push(nextLine);
  });

  const lineDirections = direction.lineDirections
    .map((lineDirection) => {
      const previous = Number(lineDirection?.lineIndex);
      if (!Number.isFinite(previous) || !lineIndexMap.has(previous)) {
        return null;
      }

      return {
        ...lineDirection,
        lineIndex: lineIndexMap.get(previous),
      };
    })
    .filter(Boolean);

  const sceneDirections = direction.sceneDirections
    .map((scene) => {
      const lineIndices = (Array.isArray(scene?.lineIndices) ? scene.lineIndices : [])
        .map((lineIndex) => Number(lineIndex))
        .filter((lineIndex) => Number.isFinite(lineIndex) && lineIndexMap.has(lineIndex))
        .map((lineIndex) => lineIndexMap.get(lineIndex));

      if (lineIndices.length === 0) {
        return null;
      }

      const start = Math.min(...lineIndices.map((lineIndex) => trimmedLines[lineIndex].start));
      const end = Math.max(...lineIndices.map((lineIndex) => trimmedLines[lineIndex].end));

      return {
        ...scene,
        start,
        end,
        lineIndices,
      };
    })
    .filter(Boolean);

  return {
    lines: trimmedLines,
    direction: {
      ...direction,
      sceneDirections,
      lineDirections,
    },
  };
};

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(2));

    const lyricsPath = resolveProjectPath(options.lyrics);
    const directionPath = resolveProjectPath(options.direction);
    const outputPath = resolveProjectPath(options.output);

    if (!(await fileExists(lyricsPath))) {
      throw new Error(`Lyrics input file not found: ${path.relative(PROJECT_ROOT, lyricsPath)}`);
    }

    console.log(`[phase-5] Reading lyrics timeline: ${path.relative(PROJECT_ROOT, lyricsPath)}`);
    const lyricsPayload = await readJson(lyricsPath);
    const lines = normalizeLines(lyricsPayload);

    if (lines.length === 0) {
      throw new Error('No valid lyric lines found in input.');
    }

    let directionPayload = {
      styleDescription: 'Fallback direction',
      palette: {},
      animationIdeas: [],
      sceneDirections: [],
      lineDirections: [],
    };

    if (await fileExists(directionPath)) {
      console.log(`[phase-5] Reading direction JSON: ${path.relative(PROJECT_ROOT, directionPath)}`);
      const directionJson = await readJson(directionPath);
      directionPayload = normalizeDirection(directionJson);
    } else {
      console.log(
        `[phase-5] Direction JSON missing at ${path.relative(PROJECT_ROOT, directionPath)}. Using graceful fallback direction.`
      );
    }

    const trimmed = trimPayloadForCi({
      lines,
      direction: directionPayload,
      maxSeconds: options.maxSeconds,
    });

    let audioInput = null;
    const songAudioUrl = String(lyricsPayload.song?.audioUrl || '').trim();
    if (songAudioUrl) {
      console.log('[phase-5] Preparing audio source...');
      try {
        audioInput = await downloadAudioToPublic(songAudioUrl);
        console.log(`[phase-5] Audio downloaded for static embedding: public/${audioInput.src}`);
      } catch (error) {
        audioInput = {
          mode: 'remote',
          src: songAudioUrl,
          sourceUrl: songAudioUrl,
        };
        console.log(`[phase-5] Audio download failed (${error.message}). Falling back to remote source.`);
      }
    } else {
      console.log('[phase-5] No audio URL found in song metadata. Rendering video without audio.');
    }

    const inputProps = {
      song: lyricsPayload.song || {},
      lines: trimmed.lines,
      direction: trimmed.direction,
      audio: audioInput,
      durationInSeconds:
        options.maxSeconds > 0
          ? options.maxSeconds
          : Math.max(
              Number(lyricsPayload.song?.duration || 0),
              trimmed.lines.reduce((maxValue, line) => Math.max(maxValue, line.end), 0),
              5
            ),
    };

    await fs.mkdir(path.dirname(outputPath), {recursive: true});

    console.log('[phase-5] Bundling Remotion project...');
    const bundled = await bundle({
      entryPoint: ENTRY_POINT,
      webpackOverride: (config) => config,
    });

    console.log('[phase-5] Selecting dynamic composition...');
    const composition = await selectComposition({
      serveUrl: bundled,
      id: 'LyricsVideo',
      inputProps,
    });

    console.log(`[phase-5] Rendering output video: ${path.relative(PROJECT_ROOT, outputPath)}`);
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      concurrency: Number(process.env.PHASE5_RENDER_CONCURRENCY || 2),
      crf: Number(process.env.PHASE5_RENDER_CRF || 22),
      outputLocation: outputPath,
      inputProps,
    });

    console.log('[phase-5] Render completed successfully.');
    console.log(`[phase-5] Lines rendered: ${trimmed.lines.length}`);
    console.log(`[phase-5] Scene directions used: ${trimmed.direction.sceneDirections.length}`);
    console.log(`[phase-5] Per-line directions used: ${trimmed.direction.lineDirections.length}`);
  } catch (error) {
    console.error('[phase-5] Failed:', error.message);
    process.exit(1);
  }
};

main();
