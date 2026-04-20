#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {google} = require('googleapis');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const POLLINATIONS_METADATA_URL = 'https://text.pollinations.ai/';
const METADATA_FETCH_TIMEOUT_MS = Number(process.env.PHASE7_METADATA_FETCH_TIMEOUT_MS || 7000);
const YOUTUBE_TITLE_MAX_LENGTH = 95;
const YOUTUBE_DESCRIPTION_MAX_LENGTH = 450;
const YOUTUBE_TAG_MAX_LENGTH = 30;

const parseTags = (raw) => {
  return String(raw || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const normalizeTags = (tags) => {
  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, YOUTUBE_TAG_MAX_LENGTH)),
    ),
  ).slice(0, 15);
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

const parseJsonObjectFromText = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_nestedError) {
        return null;
      }
    }
    return null;
  }
};

const generateAutoMetadata = async ({songName, artistName}) => {
  if (String(process.env.PHASE7_AUTO_METADATA || '1').trim() === '0') {
    return null;
  }

  const prompt = [
    'Return only valid JSON with keys: title, description, tags.',
    `Song: ${songName}`,
    `Artist: ${artistName}`,
    'Style: SEO-friendly YouTube lyrics video metadata.',
    'Constraints:',
    '- title max 95 chars',
    '- description 2 short lines, max 450 chars',
    '- tags as array of 5-10 short strings',
  ].join('\n');

  try {
    const response = await fetch(`${POLLINATIONS_METADATA_URL}${encodeURIComponent(prompt)}`, {
      signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }

    const rawText = await response.text();
    const parsed = parseJsonObjectFromText(rawText);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const title = String(parsed.title || '').trim().slice(0, YOUTUBE_TITLE_MAX_LENGTH);
    const description = String(parsed.description || '').trim().slice(0, YOUTUBE_DESCRIPTION_MAX_LENGTH);
    const tags = normalizeTags(Array.isArray(parsed.tags) ? parsed.tags : []);

    if (!title || !description || tags.length === 0) {
      return null;
    }

    return {title, description, tags, source: 'pollinations'};
  } catch (_error) {
    return null;
  }
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
  const defaultDescription = [
    `${songName} by ${artistName}`,
    '',
    'Rendered with template-only Remotion pipeline.',
  ].join('\n');

  const manualTitle = (process.env.YOUTUBE_TITLE || '').trim();
  const manualDescription = (process.env.YOUTUBE_DESCRIPTION || '').trim();
  const tagsFromInput = parseTags(process.env.YOUTUBE_TAGS || '');

  const autoMetadata =
    !manualTitle || !manualDescription || tagsFromInput.length === 0
      ? await generateAutoMetadata({songName, artistName})
      : null;

  const title = manualTitle || autoMetadata?.title || defaultTitle;
  const description = manualDescription || autoMetadata?.description || defaultDescription;
  const tags = normalizeTags(
    tagsFromInput.length > 0 ? tagsFromInput : autoMetadata?.tags || [songName, artistName, 'lyrics', 'music'],
  );

  const hasManualMetadata = Boolean(manualTitle || manualDescription || tagsFromInput.length > 0);
  const metadataSource = hasManualMetadata ? 'manual-overrides' : autoMetadata?.source || 'template-default';

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
    metadataSource,
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
