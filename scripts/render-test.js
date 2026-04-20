#!/usr/bin/env node
'use strict';

const path = require('node:path');

const {runPhase3Build} = require('./phase3-build');
const {runPhase5Render} = require('./phase5-render');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const main = async () => {
  const lyricsOut = path.join(PROJECT_ROOT, 'data', 'test-lyrics.json');
  const videoOut = path.join(PROJECT_ROOT, 'output', 'test-video.mp4');

  await runPhase3Build({
    songId: 'TEST_TEMPLATE',
    query: 'template test render',
    out: lyricsOut,
  });

  const renderResult = await runPhase5Render({
    lyrics: lyricsOut,
    out: videoOut,
    compositionId: 'LyricsTemplateVideo',
    maxSeconds: 12,
    concurrency: 2,
    crf: 24,
  });

  console.log('[render:test] Test render complete');
  console.log(`[render:test] Output: ${path.relative(PROJECT_ROOT, renderResult.out)}`);
};

main().catch((error) => {
  console.error(`[render:test] Failed: ${error.message || error}`);
  process.exit(1);
});
