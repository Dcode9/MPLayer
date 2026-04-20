#!/usr/bin/env node
'use strict';

const path = require('node:path');

const {runPhase5Render} = require('./phase5-render');

const PROJECT_ROOT = path.resolve(__dirname, '..');

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
    out: path.join(PROJECT_ROOT, 'output', 'phase5-video-16x9-logo.mp4'),
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
    } else if (arg.startsWith('--max-seconds=')) {
      args.maxSeconds = parsePositiveNumber(arg.slice('--max-seconds='.length).trim());
    }
  }

  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const result = await runPhase5Render({
    ...args,
    compositionId: 'LyricsTemplateVideo16x9Logo',
  });

  console.log('[phase5-16x9-logo] Render complete');
  console.log(`[phase5-16x9-logo] Output: ${path.relative(PROJECT_ROOT, result.out)}`);
  console.log(
    `[phase5-16x9-logo] Video: ${result.width}x${result.height} @ ${result.fps}fps, ${result.durationInSeconds.toFixed(2)}s`,
  );
};

main().catch((error) => {
  console.error(`[phase5-16x9-logo] Failed: ${error.message || error}`);
  process.exit(1);
});
