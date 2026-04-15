const fs = require('node:fs/promises');
const path = require('node:path');
const {bundle} = require('@remotion/bundler');
const {renderMedia, selectComposition} = require('@remotion/renderer');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENTRY_POINT = path.join(PROJECT_ROOT, 'remotion/index.jsx');
const INPUT_JSON = path.join(PROJECT_ROOT, 'data/test-lyrics.json');
const OUTPUT_VIDEO = path.join(PROJECT_ROOT, 'output/test-video.mp4');

const readInputProps = async () => {
  const contents = await fs.readFile(INPUT_JSON, 'utf-8');
  return JSON.parse(contents);
};

const main = async () => {
  try {
    console.log('[phase-1] Loading test lyrics JSON...');
    const inputProps = await readInputProps();

    await fs.mkdir(path.dirname(OUTPUT_VIDEO), {recursive: true});

    console.log('[phase-1] Bundling Remotion project...');
    const bundled = await bundle({
      entryPoint: ENTRY_POINT,
      webpackOverride: (config) => config,
    });

    console.log('[phase-1] Selecting composition...');
    const composition = await selectComposition({
      serveUrl: bundled,
      id: 'LyricsVideo',
      inputProps,
    });

    console.log('[phase-1] Rendering video to output/test-video.mp4...');
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      outputLocation: OUTPUT_VIDEO,
      inputProps,
    });

    console.log('[phase-1] Render completed successfully.');
  } catch (error) {
    console.error('[phase-1] Render failed:', error);
    process.exit(1);
  }
};

main();
