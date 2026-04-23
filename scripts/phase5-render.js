#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {bundle} = require('@remotion/bundler');
const {renderMedia, selectComposition} = require('@remotion/renderer');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REMOTION_ENTRY = path.join(PROJECT_ROOT, 'remotion', 'index.jsx');

const parsePositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const parseArgs = (argv) => {
  const args = {
    lyrics: path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'),
    out: path.join(PROJECT_ROOT, 'output', 'phase5-video-4k-logo.mp4'),
    compositionId: 'LyricsTemplateVideo4kLogo',
    maxSeconds: parsePositiveNumber(process.env.PHASE5_MAX_SECONDS || '0'),
    concurrency: Number(process.env.PHASE5_RENDER_CONCURRENCY || 2),
    crf: Number(process.env.PHASE5_RENDER_CRF || 22),
  };

  for (const arg of argv) {
    if (arg.startsWith('--lyrics=')) {
      const value = arg.slice('--lyrics='.length).trim();
      args.lyrics = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      args.out = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--composition-id=')) {
      args.compositionId = arg.slice('--composition-id='.length).trim() || args.compositionId;
    } else if (arg.startsWith('--max-seconds=')) {
      args.maxSeconds = parsePositiveNumber(arg.slice('--max-seconds='.length).trim());
    }
  }

  return args;
};

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const estimateDurationSeconds = (songData) => {
  const songDuration = Number(songData?.song?.duration || 0);
  const lastLineEnd = Number(songData?.lines?.[songData.lines.length - 1]?.end || 0);
  const fallback = Math.max(songDuration, lastLineEnd);
  return fallback > 0 ? fallback : 30;
};

const runPhase5Render = async ({lyrics, out, compositionId, maxSeconds, concurrency, crf}) => {
  const songData = await readJsonFile(lyrics);
  const baseDurationSeconds = estimateDurationSeconds(songData);
  const boundedDurationSeconds = maxSeconds > 0 ? Math.min(baseDurationSeconds, maxSeconds) : baseDurationSeconds;

  const inputProps = {
    songData,
  };

  const serveUrl = await bundle({
    entryPoint: REMOTION_ENTRY,
    webpackOverride: (config) => config,
  });

  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
  });

  const durationInFrames = Math.max(1, Math.round(boundedDurationSeconds * composition.fps));

  const finalComposition = {
    ...composition,
    durationInFrames,
  };

  await fs.mkdir(path.dirname(out), {recursive: true});

  await renderMedia({
    composition: finalComposition,
    serveUrl,
    codec: 'h264',
    audioCodec: 'aac',
    outputLocation: out,
    inputProps,
    concurrency,
    crf,
    pixelFormat: 'yuv420p',
  });

  return {
    out,
    fps: finalComposition.fps,
    width: finalComposition.width,
    height: finalComposition.height,
    durationInSeconds: finalComposition.durationInFrames / finalComposition.fps,
    durationInFrames: finalComposition.durationInFrames,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPhase5Render(args);

  console.log('[phase5] Render complete');
  console.log(`[phase5] Output: ${path.relative(PROJECT_ROOT, result.out)}`);
  console.log(
    `[phase5] Video: ${result.width}x${result.height} @ ${result.fps}fps, ${result.durationInSeconds.toFixed(2)}s (${result.durationInFrames} frames)`,
  );
  console.log('[phase5] Render profile: production HQ');
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[phase5] Failed: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  runPhase5Render,
};
