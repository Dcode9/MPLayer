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
  // Near-black minimal palettes for D'Tunes identity
  const palettes = [
    {
      bgStart: '#05070c',
      bgEnd: '#0e1218',
      accent: '#67e8f9',
      accentSoft: '#a5f3fc',
      text: '#f8fafc',
      subText: '#94a3b8',
    },
    {
      bgStart: '#07070b',
      bgEnd: '#12121a',
      accent: '#c4b5fd',
      accentSoft: '#ddd6fe',
      text: '#f8fafc',
      subText: '#a1a1aa',
    },
    {
      bgStart: '#06080c',
      bgEnd: '#10151c',
      accent: '#7dd3fc',
      accentSoft: '#bae6fd',
      text: '#f1f5f9',
      subText: '#94a3b8',
    },
    {
      bgStart: '#08060a',
      bgEnd: '#141018',
      accent: '#f0abfc',
      accentSoft: '#f5d0fe',
      text: '#fafafa',
      subText: '#a3a3a3',
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
    "All rights belong to the respective owners. D'Tunes presents lyrical animation only.",
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
      text: "Subscribe for daily D'Tunes lyrical videos",
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
    "YouTube thumbnail design for a D'Tunes lyrical video",
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
    "- Brand positioning must be D'Tunes Lyrical Video (High Quality Lyrics Animations).",
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

    // Left text / right album art layout (16:9 minimal black)
    const titleLines = splitHeadline(songName || metadata?.title || 'Lyrical Video', 18, 3)
      .map((line) => escapeXml(line));

    const creditsRaw = [artistName, albumName, year].filter(Boolean).join(' • ');
    const credits = escapeXml(creditsRaw || "D'Tunes Music");

    const lineElements = titleLines
      .map((line, index) => `<text x="72" y="${230 + (index * 88)}" font-family="Noto Sans, Arial, sans-serif" font-size="70" font-weight="800" fill="${palette.text}">${line}</text>`)
      .join('');

    const overlaySvg = `
      <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.bgStart}"/>
            <stop offset="100%" stop-color="${palette.bgEnd}"/>
          </linearGradient>
          <radialGradient id="softGlow" cx="0.75" cy="0.45" r="0.55">
            <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#bg)"/>
        <rect width="1280" height="720" fill="url(#softGlow)"/>
        <text x="72" y="88" font-family="Noto Sans, Arial, sans-serif" font-size="32" font-weight="700" fill="${palette.accentSoft}">D'Tunes • Lyrical</text>
        ${lineElements}
        <text x="72" y="520" font-family="Noto Sans, Arial, sans-serif" font-size="30" font-weight="600" fill="${palette.subText}">${credits}</text>
        <rect x="72" y="560" width="300" height="54" rx="14" fill="${palette.accent}" opacity="0.95"/>
        <text x="94" y="596" font-family="Noto Sans, Arial, sans-serif" font-size="28" font-weight="800" fill="#0a0a0f">Ad-Free, Lyrical</text>
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
        const coverSize = 460;
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
          <svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="6" width="488" height="488" rx="42" ry="42" fill="none" stroke="${palette.accentSoft}" stroke-opacity="0.9" stroke-width="7"/>
          </svg>
        `);

        composites.push({input: framedCover, left: 760, top: 130});
        composites.push({input: frameSvg, left: 740, top: 110});
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
        background: '#06080c',
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
