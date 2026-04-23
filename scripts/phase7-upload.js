#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

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

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const parseTags = (raw) => {
  return String(raw || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
};

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const escapeXml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const hashString = (value) => {
  const raw = String(value || 'dtunes');
  let hash = 0;
  for (let index = 0; index < raw.length; index++) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const pickThemePalette = (seed) => {
  const palettes = [
    {
      bgStart: '#0b1220',
      bgEnd: '#1f2937',
      accent: '#22d3ee',
      accentSoft: '#93c5fd',
      text: '#f8fafc',
      subText: '#cbd5e1',
    },
    {
      bgStart: '#1a102f',
      bgEnd: '#2b164f',
      accent: '#f59e0b',
      accentSoft: '#fcd34d',
      text: '#fff7ed',
      subText: '#fed7aa',
    },
    {
      bgStart: '#081c15',
      bgEnd: '#1b4332',
      accent: '#52b788',
      accentSoft: '#95d5b2',
      text: '#f1faee',
      subText: '#b7e4c7',
    },
    {
      bgStart: '#1f1300',
      bgEnd: '#3f2a14',
      accent: '#fb7185',
      accentSoft: '#fda4af',
      text: '#fff1f2',
      subText: '#fecdd3',
    },
  ];
  return palettes[seed % palettes.length];
};

const splitHeadline = (value, maxChars = 22, maxLines = 3) => {
  const words = cleanText(value).split(' ').filter(Boolean);
  if (words.length === 0) {
    return ['Lyrical Video'];
  }

  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || current.length === 0) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) {
        break;
      }
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxChars - 1))}…`;
  }

  return lines;
};

const YOUTUBE_ALLOWED_CATEGORIES = new Set([
  '1',
  '2',
  '10',
  '15',
  '17',
  '19',
  '20',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
]);

const COMMON_LANGUAGE_MAP = {
  english: 'en',
  hindi: 'hi',
  hinglish: 'hi',
  punjabi: 'pa',
  tamil: 'ta',
  telugu: 'te',
  kannada: 'kn',
  malayalam: 'ml',
  bengali: 'bn',
  marathi: 'mr',
  gujarati: 'gu',
  urdu: 'ur',
};

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

const sanitizeCategoryId = (value, fallback = '10') => {
  const normalized = cleanText(value);
  if (YOUTUBE_ALLOWED_CATEGORIES.has(normalized)) {
    return normalized;
  }
  return fallback;
};

const sanitizeLanguageTag = (value, fallback = 'en') => {
  const raw = cleanText(value).toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (COMMON_LANGUAGE_MAP[raw]) {
    return COMMON_LANGUAGE_MAP[raw];
  }

  // Accept simple IETF BCP-47 language tags such as en, hi, en-US.
  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(raw)) {
    return raw;
  }

  return fallback;
};

const sanitizeYoutubeTags = (tags, fallbackTags = []) => {
  const normalized = uniqueTags(Array.isArray(tags) ? tags : fallbackTags)
    .map((tag) => cleanText(tag).replace(/[\r\n#]/g, ''))
    .filter(Boolean)
    .map((tag) => tag.slice(0, 100));

  const output = [];
  let totalChars = 0;

  for (const tag of normalized) {
    const nextCost = tag.length + (output.length > 0 ? 1 : 0);
    if (totalChars + nextCost > 450) {
      break;
    }
    output.push(tag);
    totalChars += nextCost;
  }

  return output;
};

const buildUploadSnippet = ({title, description, tags, categoryId, defaultLanguage, defaultAudioLanguage, defaults}) => {
  const safeTitle = cleanText(title || defaults.title).slice(0, 100) || defaults.title;
  const safeDescription = String(description || defaults.description || '').trim().slice(0, 5000);
  const safeCategoryId = sanitizeCategoryId(categoryId, '10');
  const safeDefaultLanguage = sanitizeLanguageTag(defaultLanguage, 'en');
  const safeDefaultAudioLanguage = sanitizeLanguageTag(defaultAudioLanguage, safeDefaultLanguage);
  const safeTags = sanitizeYoutubeTags(tags, defaults.tags);

  return {
    title: safeTitle,
    description: safeDescription,
    tags: safeTags,
    categoryId: safeCategoryId,
    defaultLanguage: safeDefaultLanguage,
    defaultAudioLanguage: safeDefaultAudioLanguage,
  };
};

const buildDefaultMetadata = (phase3Data) => {
  const song = phase3Data?.song || {};
  const songName = cleanText(song.name || 'Lyrics Video');
  const artistName = cleanText(song.artist || 'Unknown Artist');
  const albumName = cleanText(song.album || '');
  const songYear = cleanText(song.year || '');
  const sourceUrl = cleanText(song.url || '');

  const title = `${songName} - ${artistName} | D'Tunes Lyrical Video`;

  const hashtags = ['#lyrics', '#music', '#lyricvideo', '#dtunes', '#adfree'];

  const creditsLines = [
    'Credits:',
    `Song: ${songName}`,
    `Artist: ${artistName}`,
    albumName ? `Album: ${albumName}` : '',
    songYear ? `Year: ${songYear}` : '',
    sourceUrl ? `Source: ${sourceUrl}` : '',
    'All rights belong to the respective owners. D\'Tunes presents lyrical animation only.',
  ].filter(Boolean);
  const creditsBlock = creditsLines.join('\n');

  const descriptionLines = [
    `D'Tunes Lyrical Video: ${songName} by ${artistName}.`,
    'High Quality Lyrics Animations. Ad-Free, Lyrical.',
    '',
    'Listen to more music on DVerse: https://play.dverse.fun',
    '',
    'Subscribe for daily lyrical experiences, trending songs, and timeless hits.',
    '',
    ...creditsLines,
    '',
    hashtags.join(' '),
  ].filter(Boolean);

  const tags = uniqueTags([
    songName,
    artistName,
    `${songName} lyrics`,
    `${songName} lyrical video`,
    `${songName} dtunes lyrics`,
    `${artistName} lyrics`,
    `${songName} ad free lyrical`,
    'lyrics',
    'lyrical video',
    'music',
    'high quality lyrics animation',
    'dtunes',
    'play dverse',
  ]);

  const annotationPlan = [
    {
      atSeconds: 30,
      text: 'Subscribe for daily D\'Tunes lyrical videos',
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
    'YouTube thumbnail design for a D\'Tunes lyrical video',
    `Song title centered and dominant: "${songName}"`,
    `Credits text below title: "${artistName}${albumName ? ` • ${albumName}` : ''}${songYear ? ` • ${songYear}` : ''}"`,
    'Must include exact text: "Ad-Free, Lyrical"',
    'Consistent style: cinematic gradient background, modern typography, high contrast, clean composition',
    'No explicit or copyrighted logos, no clutter, no watermark, 16:9, YouTube-ready',
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
    creditsBlock,
  };
};

const sanitizeMetadata = (metadata, defaults) => {
  const title = cleanText(metadata?.title || defaults.title).slice(0, 100) || defaults.title;

  let description = String(metadata?.description || defaults.description || '').trim();
  if (!description.includes('play.dverse.fun')) {
    description = `${description}\n\nListen to more music on DVerse: https://play.dverse.fun`.trim();
  }
  if (defaults.creditsBlock && !description.toLowerCase().includes('credits:')) {
    description = `${description}\n\n${defaults.creditsBlock}`.trim();
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
    '- Brand positioning must be D\'Tunes Lyrical Video (High Quality Lyrics Animations).',
    '- Never claim Original/Official song ownership; this is a lyrical animation presentation.',
    '- Description must include a natural CTA with https://play.dverse.fun',
    '- Description must include ethical credits with song/artist/album/year/source where available.',
    '- Tags should target lyrical music discovery.',
    '- Hashtags max 6.',
    '- Thumbnail prompt style must be consistent: centered song title, credits below, include exact text "Ad-Free, Lyrical".',
    '',
    `Song name: ${song.name || ''}`,
    `Artist: ${song.artist || ''}`,
    `Album: ${song.album || ''}`,
    `Year: ${song.year || ''}`,
    `Source URL: ${song.url || ''}`,
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

  const createCodeThumbnail = async () => {
    const seed = hashString(`${metadata?.title || ''}|${metadata?.thumbnailPrompt || ''}`);
    const palette = pickThemePalette(seed);

    const songName = cleanText(metadata?.songName || '').slice(0, 120);
    const artistName = cleanText(metadata?.artistName || '').slice(0, 80);
    const albumName = cleanText(metadata?.albumName || '').slice(0, 60);
    const year = cleanText(metadata?.songYear || '').slice(0, 8);

    const titleLines = splitHeadline(songName || metadata?.title || 'Lyrical Video', 20, 3)
      .map((line) => escapeXml(line));

    const creditsRaw = [artistName, albumName, year].filter(Boolean).join(' • ');
    const credits = escapeXml(creditsRaw || 'D\'Tunes Music');

    const lineElements = titleLines
      .map((line, index) => `<text x="80" y="${210 + (index * 92)}" font-family="Noto Sans, Arial, sans-serif" font-size="76" font-weight="800" fill="${palette.text}">${line}</text>`)
      .join('');

    const overlaySvg = `
      <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.bgStart}"/>
            <stop offset="100%" stop-color="${palette.bgEnd}"/>
          </linearGradient>
          <radialGradient id="orb" cx="0.85" cy="0.2" r="0.8">
            <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.32"/>
            <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#bg)"/>
        <rect width="1280" height="720" fill="url(#orb)"/>
        <rect x="72" y="110" width="20" height="510" rx="10" fill="${palette.accent}" opacity="0.95"/>
        <text x="108" y="90" font-family="Noto Sans, Arial, sans-serif" font-size="38" font-weight="700" fill="${palette.accentSoft}">D'Tunes • Lyrical Video</text>
        ${lineElements}
        <text x="82" y="560" font-family="Noto Sans, Arial, sans-serif" font-size="34" font-weight="600" fill="${palette.subText}">${credits}</text>
        <rect x="80" y="598" width="360" height="62" rx="16" fill="${palette.accent}" opacity="0.96"/>
        <text x="106" y="640" font-family="Noto Sans, Arial, sans-serif" font-size="34" font-weight="800" fill="#081018">Ad-Free, Lyrical</text>
      </svg>
    `;

    const composites = [
      {
        input: Buffer.from(overlaySvg),
        left: 0,
        top: 0,
      },
    ];

    const coverUrl = cleanText(metadata?.songImage || '');
    if (coverUrl) {
      try {
        const coverSize = 430;
        const coverRaw = await fetchBinary(coverUrl, 35000);
        const roundedMask = Buffer.from(
          `<svg width="${coverSize}" height="${coverSize}"><rect x="0" y="0" width="${coverSize}" height="${coverSize}" rx="34" ry="34" fill="white"/></svg>`,
        );
        const framedCover = await sharp(coverRaw)
          .resize(coverSize, coverSize, {fit: 'cover'})
          .composite([{input: roundedMask, blend: 'dest-in'}])
          .png()
          .toBuffer();

        const frameSvg = Buffer.from(`
          <svg width="470" height="470" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="6" width="458" height="458" rx="40" ry="40" fill="none" stroke="${palette.accentSoft}" stroke-opacity="0.95" stroke-width="8"/>
          </svg>
        `);

        composites.push({input: framedCover, left: 790, top: 145});
        composites.push({input: frameSvg, left: 770, top: 125});
      } catch (error) {
        // Keep thumbnail generation resilient even if cover download fails.
      }
    }

    await fsPromises.mkdir(path.dirname(outputPath), {recursive: true});
    await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: '#0b1220',
      },
    })
      .composite(composites)
      .jpeg({quality: 92, chromaSubsampling: '4:4:4'})
      .toFile(outputPath);

    return {
      filePath: outputPath,
      usedAi: false,
      reason: 'generated-code-theme',
      prompt: metadata?.thumbnailPrompt || '',
      url: null,
    };
  };

  const createAiThumbnail = async () => {
    const prompt = cleanText(metadata?.thumbnailPrompt || 'cinematic lyrical music thumbnail');
    const url = `${POLLINATIONS_IMAGE_BASE_URL}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model || 'gptimage-large')}&width=1280&height=720&nologo=true`;
    const imageBuffer = await fetchBinary(url, 90000);
    await fsPromises.mkdir(path.dirname(outputPath), {recursive: true});
    await fsPromises.writeFile(outputPath, imageBuffer);

    return {
      filePath: outputPath,
      usedAi: true,
      reason: 'generated-ai-model',
      prompt,
      url,
    };
  };

  const mode = cleanText(process.env.YOUTUBE_THUMBNAIL_MODE || 'code').toLowerCase();
  if (mode === 'ai') {
    return createAiThumbnail();
  }

  return createCodeThumbnail();
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryYoutubeError = (error) => {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  const reasons = Array.isArray(error?.response?.data?.error?.errors)
    ? error.response.data.error.errors.map((entry) => String(entry?.reason || '').toLowerCase())
    : [];

  if (status >= 500 || status === 429 || status === 408) {
    return true;
  }

  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'].includes(code)) {
    return true;
  }

  return reasons.some((reason) => [
    'backenderror',
    'internalerror',
    'ratelimitexceeded',
    'userratelimitexceeded',
    'quotaexceeded',
    'uploadratelimitexceeded',
  ].includes(reason));
};

const runWithRetry = async ({label, attempts, baseDelayMs, operation, shouldRetry}) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[phase7] Retry attempt ${attempt}/${attempts} for ${label}`);
      }
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry(error);
      if (!retryable || attempt >= attempts) {
        break;
      }
      const waitMs = baseDelayMs * attempt;
      console.warn(`[phase7] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${waitMs}ms`);
      await delay(waitMs);
    }
  }

  throw lastError;
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
  const youtubeUploadAttempts = parsePositiveInt(process.env.YOUTUBE_UPLOAD_RETRIES || '3', 3);
  const youtubeApiTimeoutMs = parsePositiveInt(process.env.YOUTUBE_API_TIMEOUT_MS || '240000', 240000);

  const defaultMetadata = buildDefaultMetadata(phase3Data || {});
  const aiMetadataResult = enableAiMetadata
    ? await generateAiMetadata({phase3Data: phase3Data || {}, model: metadataModel})
    : {metadata: defaultMetadata, usedAi: false, rawText: 'AI metadata disabled'};

  const metadata = aiMetadataResult.metadata;

  if (phase3Data?.song) {
    metadata.songName = cleanText(phase3Data.song.name || '');
    metadata.artistName = cleanText(phase3Data.song.artist || '');
    metadata.albumName = cleanText(phase3Data.song.album || '');
    metadata.songYear = cleanText(phase3Data.song.year || '');
    metadata.songImage = cleanText(phase3Data.song.image || '');
  }

  const title = cleanText(process.env.YOUTUBE_TITLE || metadata.title || defaultMetadata.title).slice(0, 100);
  const description = String(process.env.YOUTUBE_DESCRIPTION || metadata.description || defaultMetadata.description).trim();
  const tagsFromInput = parseTags(process.env.YOUTUBE_TAGS || '');
  const tags = tagsFromInput.length > 0 ? tagsFromInput : metadata.tags;

  const categoryId = sanitizeCategoryId(process.env.YOUTUBE_CATEGORY_ID || metadata.categoryId || '10', '10');
  const defaultLanguage = sanitizeLanguageTag(process.env.YOUTUBE_DEFAULT_LANGUAGE || metadata.defaultLanguage || 'en', 'en');
  const defaultAudioLanguage = sanitizeLanguageTag(
    process.env.YOUTUBE_DEFAULT_AUDIO_LANGUAGE || metadata.defaultAudioLanguage || defaultLanguage,
    defaultLanguage,
  );

  const privacyStatus = ['private', 'public', 'unlisted'].includes(process.env.YOUTUBE_PRIVACY_STATUS || '')
    ? process.env.YOUTUBE_PRIVACY_STATUS
    : 'unlisted';

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri: 'http://127.0.0.1',
  });

  oauth2Client.setCredentials({refresh_token: refreshToken});

  google.options({
    timeout: youtubeApiTimeoutMs,
  });

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });

  const uploadSnippet = buildUploadSnippet({
    title,
    description,
    tags,
    categoryId,
    defaultLanguage,
    defaultAudioLanguage,
    defaults: defaultMetadata,
  });

  let insertResponse;
  try {
    insertResponse = await runWithRetry({
      label: 'videos.insert',
      attempts: youtubeUploadAttempts,
      baseDelayMs: 2000,
      shouldRetry: shouldRetryYoutubeError,
      operation: async () => youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: uploadSnippet,
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
      }),
    });
  } catch (error) {
    const apiErrors = error?.errors || error?.response?.data?.error?.errors || [];
    const hasInvalidMetadata = Array.isArray(apiErrors)
      && apiErrors.some((entry) => String(entry?.reason || '').toUpperCase() === 'INVALID_REQUEST_METADATA');

    if (!hasInvalidMetadata) {
      throw error;
    }

    const safeRetrySnippet = {
      title: cleanText(defaultMetadata.title).slice(0, 100) || 'Lyrics Video',
      description: String(defaultMetadata.description || 'D\'Tunes lyrical video').slice(0, 5000),
      categoryId: '10',
      tags: sanitizeYoutubeTags(defaultMetadata.tags, []),
    };

    console.warn('[phase7] INVALID_REQUEST_METADATA received; retrying with minimal safe snippet');

    insertResponse = await runWithRetry({
      label: 'videos.insert(minimal-snippet)',
      attempts: youtubeUploadAttempts,
      baseDelayMs: 2000,
      shouldRetry: shouldRetryYoutubeError,
      operation: async () => youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: safeRetrySnippet,
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
      }),
    });
  }

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
        await runWithRetry({
          label: 'thumbnails.set',
          attempts: Math.max(2, youtubeUploadAttempts),
          baseDelayMs: 1500,
          shouldRetry: shouldRetryYoutubeError,
          operation: async () => youtube.thumbnails.set({
            videoId,
            media: {
              body: fs.createReadStream(thumbnailResult.filePath),
            },
          }),
        });
      } catch (error) {
        thumbnailResult.reason = `thumbnail-upload-failed: ${error.message || error}`;
      }
    }

    const targetPlaylistId = cleanText(process.env.YOUTUBE_PLAYLIST_ID || '');
    if (targetPlaylistId) {
      try {
        await runWithRetry({
          label: 'playlistItems.insert',
          attempts: 2,
          baseDelayMs: 1200,
          shouldRetry: shouldRetryYoutubeError,
          operation: async () => youtube.playlistItems.insert({
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
          }),
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
    tags: uploadSnippet.tags,
    categoryId: uploadSnippet.categoryId,
    defaultLanguage: uploadSnippet.defaultLanguage,
    defaultAudioLanguage: uploadSnippet.defaultAudioLanguage,
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

const summarizeUploadError = (error) => {
  const responseStatus = error?.response?.status || null;
  const responseStatusText = error?.response?.statusText || null;
  const responseErrors = Array.isArray(error?.response?.data?.error?.errors)
    ? error.response.data.error.errors.map((item) => ({
      reason: cleanText(item?.reason || ''),
      message: cleanText(item?.message || ''),
      domain: cleanText(item?.domain || ''),
    }))
    : [];

  return {
    message: cleanText(error?.message || 'Unknown upload error'),
    code: cleanText(error?.code || ''),
    status: responseStatus,
    statusText: responseStatusText,
    errors: responseErrors,
    stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 12).join('\n') : null,
  };
};

const writeFailureOutput = async (summary) => {
  const outputFile = path.resolve(process.env.PHASE7_OUTPUT_JSON || path.join(PROJECT_ROOT, 'data', 'phase7-youtube-upload.json'));
  const videoFile = path.resolve(process.env.PHASE7_VIDEO_FILE || path.join(PROJECT_ROOT, 'output', 'phase7-video.mp4'));
  const phase3File = path.resolve(process.env.PHASE7_PHASE3_JSON || path.join(PROJECT_ROOT, 'data', 'phase3-lyrics.json'));

  const payload = {
    uploadedAt: new Date().toISOString(),
    videoId: null,
    success: false,
    sourceVideo: path.relative(PROJECT_ROOT, videoFile),
    sourcePhase3Json: path.relative(PROJECT_ROOT, phase3File),
    error: summary,
  };

  await fsPromises.mkdir(path.dirname(outputFile), {recursive: true});
  await fsPromises.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  return outputFile;
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
    const summary = summarizeUploadError(error);

    console.error(`[phase7] Failed: ${summary.message}`);
    if (summary.status) {
      console.error(`[phase7] HTTP status: ${summary.status}${summary.statusText ? ` ${summary.statusText}` : ''}`);
    }
    if (summary.code) {
      console.error(`[phase7] Error code: ${summary.code}`);
    }
    if (summary.errors.length > 0) {
      console.error(`[phase7] API errors: ${JSON.stringify(summary.errors)}`);
    }
    if (summary.stack) {
      console.error(summary.stack);
    }

    writeFailureOutput(summary)
      .then((outputFile) => {
        console.error(`[phase7] Failure output written to: ${path.relative(PROJECT_ROOT, outputFile)}`);
        process.exit(1);
      })
      .catch((writeError) => {
        console.error(`[phase7] Failed to write failure output: ${writeError.message || writeError}`);
        process.exit(1);
      });
  });
}

module.exports = {
  runPhase7Upload,
};
