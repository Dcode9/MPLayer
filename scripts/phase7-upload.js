#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {google} = require('googleapis');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const parseTags = (raw) => {
  return String(raw || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const readJsonIfExists = async (filePath) => {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const runPhase7Upload = async () => {
  const clientId = process.env.YOUTUBE_CLIENT_ID || '';
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing YouTube OAuth credentials (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)');
  }

  const videoFile = path.resolve(process.env.PHASE7_VIDEO_FILE || path.join(PROJECT_ROOT, 'output', 'phase7-video.mp4'));
  const phase3File = path.resolve(process.env.PHASE7_PHASE3_JSON || path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'));
  const outputFile = path.resolve(process.env.PHASE7_OUTPUT_JSON || path.join(PROJECT_ROOT, 'data', 'phase7-youtube-upload.json'));

  if (!(await fileExists(videoFile))) {
    throw new Error(`Video file not found: ${videoFile}`);
  }

  const phase3Data = await readJsonIfExists(phase3File);
  const songName = phase3Data?.song?.name || 'Lyrics Video';
  const artistName = phase3Data?.song?.artist || 'Unknown Artist';

  const defaultTitle = `${songName} - ${artistName} | Lyrics Visualiser`;
  const title = (process.env.YOUTUBE_TITLE || '').trim() || defaultTitle;

  const defaultDescription = [
    `${songName} by ${artistName}`,
    '',
    'Rendered with template-only Remotion pipeline.',
  ].join('\n');

  const description = (process.env.YOUTUBE_DESCRIPTION || '').trim() || defaultDescription;

  const tagsFromInput = parseTags(process.env.YOUTUBE_TAGS || '');
  const tags = tagsFromInput.length > 0 ? tagsFromInput : [songName, artistName, 'lyrics', 'music'];

  const privacyStatus = ['private', 'public', 'unlisted'].includes(process.env.YOUTUBE_PRIVACY_STATUS || '')
    ? process.env.YOUTUBE_PRIVACY_STATUS
    : 'unlisted';

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri: 'http://127.0.0.1',
  });

  oauth2Client.setCredentials({refresh_token: refreshToken});

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: '10',
      },
      status: {
        privacyStatus,
      },
    },
    media: {
      body: require('node:fs').createReadStream(videoFile),
    },
  });

  const payload = {
    uploadedAt: new Date().toISOString(),
    videoId: response.data?.id || null,
    title,
    privacyStatus,
    tags,
    sourceVideo: path.relative(PROJECT_ROOT, videoFile),
    sourcePhase3Json: path.relative(PROJECT_ROOT, phase3File),
    youtubeResponse: response.data || null,
  };

  await fs.mkdir(path.dirname(outputFile), {recursive: true});
  await fs.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  return {
    outputFile,
    videoId: payload.videoId,
    title,
  };
};

const main = async () => {
  const result = await runPhase7Upload();
  console.log('[phase7] Upload complete');
  console.log(`[phase7] Video ID: ${result.videoId || 'unknown'}`);
  console.log(`[phase7] Output JSON: ${path.relative(PROJECT_ROOT, result.outputFile)}`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[phase7] Failed: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  runPhase7Upload,
};
