#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const {google} = require('googleapis');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const POLLINATIONS_TEXT_BASE_URL = 'https://text.pollinations.ai';
const POLLINATIONS_IMAGE_BASE_URL = 'https://image.pollinations.ai/prompt';

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseTags = (raw) => {
  return String(raw || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
};

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const fileExists = async (filePath) => {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
};

const readJsonIfExists = async (filePath) => {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const raw = await fsPromises.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const fetchText = async (url, timeoutMs = 25000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MPLayer-Phase7/1.0',
        Accept: 'text/plain, application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const fetchBinary = async (url, timeoutMs = 60000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MPLayer-Phase7/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
};

const parseJsonFromText = (rawText) => {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    const objectMatch = String(rawText).match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (innerError) {
        return null;
      }
    }
  }

  return null;
};

const uniqueTags = (items) => {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const value = cleanText(item);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }

  return output.slice(0, 30);
};

const buildDefaultMetadata = (phase3Data) => {
  const song = phase3Data?.song || {};
  const songName = cleanText(song.name || 'Lyrics Video');
  const artistName = cleanText(song.artist || 'Unknown Artist');
  const albumName = cleanText(song.album || '');

  const title = `${songName} - ${artistName} | Official 4K Lyrics Video`;

  const hashtags = ['#lyrics', '#music', '#lyricvideo', '#dtunes'];

  const descriptionLines = [
    `${songName} by ${artistName} - Official 4K lyric music video.`,
    albumName ? `Album: ${albumName}` : '',
    '',
    'Listen to more music on DVerse: https://play.dverse.fun',
    '',
    'Subscribe for daily lyric videos, trending songs, and timeless hits.',
    '',
    hashtags.join(' '),
  ].filter(Boolean);

  const tags = uniqueTags([
    songName,
    artistName,
    `${songName} lyrics`,
    `${songName} lyric video`,
    `${songName} 4k lyrics`,
    `${artistName} lyrics`,
    `${songName} official lyric`,
    'lyrics',
    'lyric video',
    'music',
    '4k music video',
    'dtunes',
    'play dverse',
  ]);

  const annotationPlan = [
    {
      atSeconds: 30,
      text: 'Subscribe for daily 4K lyric videos',
      action: 'subscribe',
    },
    {
      atSeconds: 75,
      text: 'Watch another trending lyric video',
      action: 'related-video',
    },
  ];

  const endScreenSuggestions = [
    {
      slot: 'left',
      idea: 'Latest trending lyric upload',
    },
    {
      slot: 'right',
      idea: 'Best-performing lyric video this week',
    },
    {
      slot: 'subscribe',
      idea: 'Channel subscribe element',
    },
  ];

  const thumbnailPrompt = [
    `${songName} by ${artistName}`,
    'cinematic 4K lyric-video thumbnail',
    'neon atmosphere, high contrast, artist-inspired colors',
    'clean typography zone, no watermark, youtube-ready',
  ].join(', ');

  return {
    title,
    description: descriptionLines.join('\n'),
    tags,
    hashtags,
    categoryId: '10',
    defaultLanguage: 'en',
    defaultAudioLanguage: String(song.language || 'en').slice(0, 12),
    annotationPlan,
    endScreenSuggestions,
    thumbnailPrompt,
  };
};

const sanitizeMetadata = (metadata, defaults) => {
  const title = cleanText(metadata?.title || defaults.title).slice(0, 100) || defaults.title;

  let description = String(metadata?.description || defaults.description || '').trim();
  if (!description.includes('play.dverse.fun')) {
    description = `${description}\n\nListen to more music on DVerse: https://play.dverse.fun`.trim();
  }

  const tags = uniqueTags([...(Array.isArray(metadata?.tags) ? metadata.tags : []), ...defaults.tags]);
  const hashtags = uniqueTags([...(Array.isArray(metadata?.hashtags) ? metadata.hashtags : []), ...defaults.hashtags])
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/\s+/g, '')}`))
    .slice(0, 10);

  const categoryId = cleanText(metadata?.categoryId || defaults.categoryId || '10') || '10';
  const thumbnailPrompt = cleanText(metadata?.thumbnailPrompt || defaults.thumbnailPrompt);

  const annotationPlan = Array.isArray(metadata?.annotationPlan) && metadata.annotationPlan.length > 0
    ? metadata.annotationPlan
    : defaults.annotationPlan;

  const endScreenSuggestions = Array.isArray(metadata?.endScreenSuggestions) && metadata.endScreenSuggestions.length > 0
    ? metadata.endScreenSuggestions
    : defaults.endScreenSuggestions;

  const defaultLanguage = cleanText(metadata?.defaultLanguage || defaults.defaultLanguage || 'en') || 'en';
  const defaultAudioLanguage = cleanText(metadata?.defaultAudioLanguage || defaults.defaultAudioLanguage || 'en') || 'en';

  const seoBlock = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';

  return {
    title,
    description: `${description}${seoBlock}`.trim(),
    tags,
    hashtags,
    categoryId,
    defaultLanguage,
    defaultAudioLanguage,
    annotationPlan,
    endScreenSuggestions,
    thumbnailPrompt,
  };
};

const generateAiMetadata = async ({phase3Data, model}) => {
  const defaults = buildDefaultMetadata(phase3Data);

  const song = phase3Data?.song || {};
  const lines = phase3Data?.lines || [];

  const prompt = [
    'System: You are an expert YouTube SEO strategist for lyrical music videos.',
    'Return strict JSON only with keys:',
    '{"title":"","description":"","tags":[],"hashtags":[],"categoryId":"10","defaultLanguage":"en","defaultAudioLanguage":"en","thumbnailPrompt":"","annotationPlan":[{"atSeconds":30,"text":"","action":""}],"endScreenSuggestions":[{"slot":"left","idea":""}]}',
    'Rules:',
    '- Keep title under 100 chars and highly clickable.',
    '- Description must include a natural CTA with https://play.dverse.fun',
    '- Tags should target lyrical music discovery.',
    '- Hashtags max 6.',
    '- Thumbnail prompt should be highly attractive and cinematic.',
    '',
    `Song name: ${song.name || ''}`,
    `Artist: ${song.artist || ''}`,
    `Album: ${song.album || ''}`,
    `Language: ${song.language || ''}`,
    `Lyrics lines count: ${lines.length}`,
  ].join('\n');

  try {
    const url = `${POLLINATIONS_TEXT_BASE_URL}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model || 'glm')}`;
    const text = await fetchText(url, 30000);
    const parsed = parseJsonFromText(text);

    if (!parsed || typeof parsed !== 'object') {
      return {
        metadata: sanitizeMetadata(null, defaults),
        usedAi: false,
        rawText: text,
      };
    }

    return {
      metadata: sanitizeMetadata(parsed, defaults),
      usedAi: true,
      rawText: text,
    };
  } catch (error) {
    return {
      metadata: sanitizeMetadata(null, defaults),
      usedAi: false,
      rawText: `AI metadata fallback: ${error.message || error}`,
    };
  }
};

const generateThumbnailIfNeeded = async ({metadata, outputPath, model, enabled}) => {
  if (!enabled) {
    return {
      filePath: null,
      usedAi: false,
      reason: 'thumbnail-generation-disabled',
    };
  }

  const prompt = cleanText(metadata?.thumbnailPrompt || 'cinematic lyrical music thumbnail');
  const url = `${POLLINATIONS_IMAGE_BASE_URL}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model || 'gptimage-large')}&width=1280&height=720&nologo=true`;

  const imageBuffer = await fetchBinary(url, 90000);
  await fsPromises.mkdir(path.dirname(outputPath), {recursive: true});
  await fsPromises.writeFile(outputPath, imageBuffer);

  return {
    filePath: outputPath,
    usedAi: true,
    reason: 'generated',
    prompt,
    url,
  };
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
  const thumbnailOutputFile = path.resolve(process.env.PHASE7_THUMBNAIL_FILE || path.join(PROJECT_ROOT, 'output', 'phase7-thumbnail.jpg'));

  if (!(await fileExists(videoFile))) {
    throw new Error(`Video file not found: ${videoFile}`);
  }

  const phase3Data = await readJsonIfExists(phase3File);

  const metadataModel = process.env.YOUTUBE_METADATA_MODEL || 'glm';
  const thumbnailModel = process.env.YOUTUBE_THUMBNAIL_MODEL || 'gptimage-large';
  const enableAiMetadata = parseBoolean(process.env.YOUTUBE_ENABLE_AI_METADATA, true);
  const enableThumbnailGeneration = parseBoolean(process.env.YOUTUBE_GENERATE_THUMBNAIL, true);

  const defaultMetadata = buildDefaultMetadata(phase3Data || {});
  const aiMetadataResult = enableAiMetadata
    ? await generateAiMetadata({phase3Data: phase3Data || {}, model: metadataModel})
    : {metadata: defaultMetadata, usedAi: false, rawText: 'AI metadata disabled'};

  const metadata = aiMetadataResult.metadata;

  const title = cleanText(process.env.YOUTUBE_TITLE || metadata.title || defaultMetadata.title).slice(0, 100);
  const description = String(process.env.YOUTUBE_DESCRIPTION || metadata.description || defaultMetadata.description).trim();
  const tagsFromInput = parseTags(process.env.YOUTUBE_TAGS || '');
  const tags = tagsFromInput.length > 0 ? tagsFromInput : metadata.tags;

  const categoryId = cleanText(process.env.YOUTUBE_CATEGORY_ID || metadata.categoryId || '10') || '10';
  const defaultLanguage = cleanText(process.env.YOUTUBE_DEFAULT_LANGUAGE || metadata.defaultLanguage || 'en') || 'en';
  const defaultAudioLanguage = cleanText(
    process.env.YOUTUBE_DEFAULT_AUDIO_LANGUAGE || metadata.defaultAudioLanguage || 'en',
  ) || 'en';

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

  const insertResponse = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId,
        defaultLanguage,
        defaultAudioLanguage,
      },
      status: {
        privacyStatus,
        embeddable: true,
        publicStatsViewable: true,
        selfDeclaredMadeForKids: false,
        license: 'youtube',
      },
    },
    media: {
      body: fs.createReadStream(videoFile),
    },
  });

  const videoId = insertResponse.data?.id || null;

  let thumbnailResult = {
    filePath: null,
    usedAi: false,
    reason: 'not-generated',
  };

  if (videoId) {
    const externalThumbnailPath = process.env.YOUTUBE_THUMBNAIL_FILE_PATH
      ? path.resolve(process.env.YOUTUBE_THUMBNAIL_FILE_PATH)
      : null;

    if (externalThumbnailPath && (await fileExists(externalThumbnailPath))) {
      thumbnailResult = {
        filePath: externalThumbnailPath,
        usedAi: false,
        reason: 'external-thumbnail',
      };
    } else {
      try {
        thumbnailResult = await generateThumbnailIfNeeded({
          metadata,
          outputPath: thumbnailOutputFile,
          model: thumbnailModel,
          enabled: enableThumbnailGeneration,
        });
      } catch (error) {
        thumbnailResult = {
          filePath: null,
          usedAi: false,
          reason: `thumbnail-generation-failed: ${error.message || error}`,
        };
      }
    }

    if (thumbnailResult.filePath && (await fileExists(thumbnailResult.filePath))) {
      try {
        await youtube.thumbnails.set({
          videoId,
          media: {
            body: fs.createReadStream(thumbnailResult.filePath),
          },
        });
      } catch (error) {
        thumbnailResult.reason = `thumbnail-upload-failed: ${error.message || error}`;
      }
    }

    const targetPlaylistId = cleanText(process.env.YOUTUBE_PLAYLIST_ID || '');
    if (targetPlaylistId) {
      try {
        await youtube.playlistItems.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              playlistId: targetPlaylistId,
              resourceId: {
                kind: 'youtube#video',
                videoId,
              },
            },
          },
        });
      } catch (error) {
        // Playlist insertion is optional.
      }
    }
  }

  const payload = {
    uploadedAt: new Date().toISOString(),
    videoId,
    title,
    description,
    privacyStatus,
    tags,
    categoryId,
    defaultLanguage,
    defaultAudioLanguage,
    sourceVideo: path.relative(PROJECT_ROOT, videoFile),
    sourcePhase3Json: path.relative(PROJECT_ROOT, phase3File),
    thumbnail: thumbnailResult.filePath
      ? {
          file: path.relative(PROJECT_ROOT, thumbnailResult.filePath),
          usedAi: thumbnailResult.usedAi,
          reason: thumbnailResult.reason,
          prompt: thumbnailResult.prompt || null,
          imageUrl: thumbnailResult.url || null,
        }
      : {
          file: null,
          usedAi: false,
          reason: thumbnailResult.reason,
          prompt: null,
          imageUrl: null,
        },
    aiMetadata: {
      usedAi: aiMetadataResult.usedAi,
      model: metadataModel,
      rawResponse: aiMetadataResult.rawText,
      annotationPlan: metadata.annotationPlan,
      endScreenSuggestions: metadata.endScreenSuggestions,
      hashtags: metadata.hashtags,
    },
    youtubeResponse: insertResponse.data || null,
  };

  await fsPromises.mkdir(path.dirname(outputFile), {recursive: true});
  await fsPromises.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  return {
    outputFile,
    videoId,
    title,
    thumbnailFile: thumbnailResult.filePath,
  };
};

const main = async () => {
  const result = await runPhase7Upload();
  console.log('[phase7] Upload complete');
  console.log(`[phase7] Video ID: ${result.videoId || 'unknown'}`);
  console.log(`[phase7] Output JSON: ${path.relative(PROJECT_ROOT, result.outputFile)}`);
  if (result.thumbnailFile) {
    console.log(`[phase7] Thumbnail: ${path.relative(PROJECT_ROOT, result.thumbnailFile)}`);
  }
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
