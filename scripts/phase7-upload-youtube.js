const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {google} = require('googleapis');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOTENV_PATH = path.join(PROJECT_ROOT, '.env');

const loadLocalEnv = () => {
  if (!fs.existsSync(DOTENV_PATH)) {
    return;
  }

  const raw = fs.readFileSync(DOTENV_PATH, 'utf-8');
  const lines = raw.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

const DEFAULTS = {
  video: process.env.PHASE7_VIDEO_FILE || 'output/phase6-video.mp4',
  phase3: process.env.PHASE7_PHASE3_JSON || 'data/phase3-lyrics.json',
  output: process.env.PHASE7_OUTPUT_JSON || 'data/phase7-youtube-upload.json',
  title: process.env.YOUTUBE_TITLE || '',
  description: process.env.YOUTUBE_DESCRIPTION || '',
  tags: process.env.YOUTUBE_TAGS || '',
  privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || 'unlisted',
  categoryId: process.env.YOUTUBE_CATEGORY_ID || '10',
  dryRun: String(process.env.PHASE7_DRY_RUN || '').toLowerCase() === 'true',
};

const YOUTUBE_MAX_TITLE_LENGTH = 100;
const YOUTUBE_MAX_DESCRIPTION_LENGTH = 5000;

const parseArgs = (argv) => {
  const options = {...DEFAULTS};

  for (const arg of argv) {
    if (arg.startsWith('--video=')) {
      options.video = arg.slice('--video='.length);
    } else if (arg.startsWith('--phase3=')) {
      options.phase3 = arg.slice('--phase3='.length);
    } else if (arg.startsWith('--out=')) {
      options.output = arg.slice('--out='.length);
    } else if (arg.startsWith('--title=')) {
      options.title = arg.slice('--title='.length);
    } else if (arg.startsWith('--description=')) {
      options.description = arg.slice('--description='.length);
    } else if (arg.startsWith('--tags=')) {
      options.tags = arg.slice('--tags='.length);
    } else if (arg.startsWith('--privacy=')) {
      options.privacyStatus = arg.slice('--privacy='.length);
    } else if (arg.startsWith('--category=')) {
      options.categoryId = arg.slice('--category='.length);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
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
    await fsp.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const readJsonIfExists = async (filePath) => {
  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const clampText = (text, maxLength) => {
  const source = String(text || '').trim();
  if (source.length <= maxLength) {
    return source;
  }

  return `${source.slice(0, maxLength - 1).trim()}…`;
};

const normalizePrivacyStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = new Set(['private', 'unlisted', 'public']);
  return allowed.has(normalized) ? normalized : 'unlisted';
};

const dedupeTags = (tags) => {
  const seen = new Set();
  const unique = [];

  for (const rawTag of tags) {
    const tag = String(rawTag || '').trim();
    if (!tag) {
      continue;
    }

    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(tag);
  }

  return unique.slice(0, 30);
};

const buildUploadMetadata = ({phase3Payload, options}) => {
  const song = phase3Payload?.song || {};
  const songName = String(song.name || '').trim();
  const artist = String(song.artist || '').trim();
  const firstArtist = artist.split(',')[0]?.trim() || artist;

  const fallbackTitle = [songName, firstArtist].filter(Boolean).join(' - ');
  const titleCandidate = options.title || (fallbackTitle ? `${fallbackTitle} | Animated Lyrics` : 'Animated Lyrics Video');
  const title = clampText(titleCandidate, YOUTUBE_MAX_TITLE_LENGTH);

  const generatedDescription = [
    songName && artist ? `${songName} - ${artist}` : 'Animated lyrics video',
    '',
    'Generated with an automated Remotion motion-graphics pipeline.',
    `Generated at: ${new Date().toISOString()}`,
  ].join('\n');
  const description = clampText(options.description || generatedDescription, YOUTUBE_MAX_DESCRIPTION_LENGTH);

  const providedTags = String(options.tags || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const inferredTags = [
    songName,
    firstArtist,
    'lyrics',
    'animated lyrics',
    'motion graphics',
    'music',
  ];

  const tags = dedupeTags([...providedTags, ...inferredTags]);

  return {
    title,
    description,
    tags,
    categoryId: String(options.categoryId || '10'),
    privacyStatus: normalizePrivacyStatus(options.privacyStatus),
  };
};

const serializeUploadOutput = ({options, metadata, videoPath, phase3Path, responseData, dryRun}) => {
  const videoId = responseData?.id || null;

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 7,
      dryRun,
      videoFile: path.relative(PROJECT_ROOT, videoPath),
      sourcePhase3File: path.relative(PROJECT_ROOT, phase3Path),
      privacyStatus: metadata.privacyStatus,
      categoryId: metadata.categoryId,
    },
    request: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
    },
    response: {
      videoId,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      raw: responseData || null,
    },
  };
};

const getAuthEnv = () => {
  return {
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
  };
};

const ensureAuthConfigured = (authEnv) => {
  const missing = [];
  if (!authEnv.clientId) missing.push('YOUTUBE_CLIENT_ID');
  if (!authEnv.clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
  if (!authEnv.refreshToken) missing.push('YOUTUBE_REFRESH_TOKEN');

  if (missing.length > 0) {
    throw new Error(`Missing required YouTube credentials: ${missing.join(', ')}`);
  }
};

const parseUploadError = (error) => {
  const providerError = error?.response?.data?.error || error?.response?.data || error?.message || error;

  if (typeof providerError === 'string') {
    return providerError;
  }

  try {
    return JSON.stringify(providerError);
  } catch (jsonError) {
    return String(error?.message || 'Unknown upload error');
  }
};

const uploadVideo = async ({videoPath, metadata}) => {
  const authEnv = getAuthEnv();
  ensureAuthConfigured(authEnv);

  const oauth2Client = new google.auth.OAuth2(authEnv.clientId, authEnv.clientSecret);
  oauth2Client.setCredentials({refresh_token: authEnv.refreshToken});

  const youtube = google.youtube({version: 'v3', auth: oauth2Client});

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
      },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  return response.data;
};

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const videoPath = resolveProjectPath(options.video);
    const phase3Path = resolveProjectPath(options.phase3);
    const outputPath = resolveProjectPath(options.output);

    if (!(await fileExists(videoPath))) {
      throw new Error(`Video file not found: ${path.relative(PROJECT_ROOT, videoPath)}`);
    }

    const phase3Payload = await readJsonIfExists(phase3Path);
    const metadata = buildUploadMetadata({phase3Payload, options});

    console.log(`[phase-7] Upload target video: ${path.relative(PROJECT_ROOT, videoPath)}`);
    console.log(`[phase-7] Privacy: ${metadata.privacyStatus}`);
    console.log(`[phase-7] Title: ${metadata.title}`);

    let uploadResponse = null;
    if (options.dryRun) {
      console.log('[phase-7] Dry-run mode enabled; skipping YouTube upload call.');
    } else {
      console.log('[phase-7] Uploading video to YouTube...');
      uploadResponse = await uploadVideo({videoPath, metadata});
      console.log(`[phase-7] Upload successful. Video ID: ${uploadResponse.id}`);
    }

    const outputPayload = serializeUploadOutput({
      options,
      metadata,
      videoPath,
      phase3Path,
      responseData: uploadResponse,
      dryRun: options.dryRun,
    });

    await fsp.mkdir(path.dirname(outputPath), {recursive: true});
    await fsp.writeFile(outputPath, JSON.stringify(outputPayload, null, 2));

    console.log(`[phase-7] Upload metadata written to: ${path.relative(PROJECT_ROOT, outputPath)}`);
  } catch (error) {
    console.error('[phase-7] Failed:', parseUploadError(error));
    process.exit(1);
  }
};

main();
