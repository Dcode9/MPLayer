#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const templateSongData = require('../remotion/template-song-data.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const parseArgs = (argv) => {
  const args = {
    out: path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'),
    songId: '',
    query: '',
  };

  for (const arg of argv) {
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length).trim();
      args.out = path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
    } else if (arg.startsWith('--song-id=')) {
      args.songId = arg.slice('--song-id='.length).trim();
    } else if (arg.startsWith('--query=')) {
      args.query = arg.slice('--query='.length).trim();
    }
  }

  return args;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

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

const runPhase3Build = async ({songId, query, out}) => {
  const payload = buildTemplatePayload({songId, query});

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
