const fs = require('node:fs/promises');
const path = require('node:path');
const {generateAnimationDirection} = require('./lib/ai-director');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const parseArgs = (argv) => {
  const options = {
    input: process.env.PHASE4_INPUT_JSON || 'data/phase3-lyrics.json',
    output: process.env.PHASE4_OUTPUT_JSON || 'data/phase4-animation-direction.json',
  };

  for (const arg of argv) {
    if (arg.startsWith('--in=')) {
      options.input = arg.slice('--in='.length);
    } else if (arg.startsWith('--out=')) {
      options.output = arg.slice('--out='.length);
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

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const validatePhase3Input = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Input JSON is invalid.');
  }

  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new Error('Input JSON must include a non-empty lines array.');
  }
};

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const inputPath = resolveProjectPath(options.input);
    const outputPath = resolveProjectPath(options.output);

    console.log(`[phase-4] Reading lyrics timeline from ${path.relative(PROJECT_ROOT, inputPath)}...`);
    const phase3Data = await readJsonFile(inputPath);
    validatePhase3Input(phase3Data);

    console.log('[phase-4] Generating animation direction JSON via AI...');
    const aiResult = await generateAnimationDirection({
      song: phase3Data.song,
      lines: phase3Data.lines,
    });

    const outputPayload = {
      metadata: {
        generatedAt: new Date().toISOString(),
        phase: 4,
        sourceLyricsFile: path.relative(PROJECT_ROOT, inputPath),
        provider: aiResult.providerReport.provider,
        modelRequested: aiResult.providerReport.modelRequested,
        modelResolved: aiResult.providerReport.modelResolved,
        githubModelSupportedInPollinations: aiResult.providerReport.githubModelSupported,
        fallbackReason: aiResult.providerReport.fallbackReason,
      },
      song: phase3Data.song,
      direction: aiResult.direction,
    };

    await fs.mkdir(path.dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, JSON.stringify(outputPayload, null, 2));

    console.log(`[phase-4] Animation direction written to ${path.relative(PROJECT_ROOT, outputPath)}.`);
    console.log(`[phase-4] Provider used: ${outputPayload.metadata.provider}`);
    console.log(`[phase-4] Direction lines: ${outputPayload.direction.lineDirections.length}`);
    console.log(`[phase-4] Scene count: ${outputPayload.direction.sceneDirections.length}`);
  } catch (error) {
    console.error('[phase-4] Failed:', error.message);
    process.exit(1);
  }
};

main();
