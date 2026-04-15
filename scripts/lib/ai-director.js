const DEFAULT_TIMEOUT_MS = Number(process.env.PHASE4_HTTP_TIMEOUT_MS || 60000);
const MAX_AI_RETRIES = Number(process.env.PHASE4_AI_RETRIES || 2);
const POLLINATIONS_OPENAI_URL =
  process.env.POLLINATIONS_OPENAI_URL || 'https://text.pollinations.ai/openai';
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_API || '';
const POLLINATIONS_GITHUB_MODEL = process.env.POLLINATIONS_GITHUB_MODEL || 'github:gpt-4o-mini';
const POLLINATIONS_FALLBACK_MODEL = process.env.POLLINATIONS_FALLBACK_MODEL || 'openai-fast';
const GLM5_API_BASE_URL = process.env.GLM5_API_BASE_URL || '';
const GLM5_API_KEY = process.env.GLM5_API_KEY || '';
const GLM5_MODEL = process.env.GLM5_MODEL || 'glm-5';
const STRICT_GLM_FALLBACK =
  String(process.env.PHASE4_STRICT_GLM_FALLBACK || '').toLowerCase() === 'true';

const DEFAULT_PALETTE = {
  background: '#0f172a',
  primary: '#f8fafc',
  accent: '#22d3ee',
  secondary: '#f59e0b',
};

const DEFAULT_ANIMATION_IDEAS = [
  'Use kinetic typography that accelerates at emotional peaks.',
  'Blend gentle background parallax with lyric-driven transitions.',
  'Emphasize repeated hooks with slightly stronger scale pulses.',
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const asString = (value, fallback = '') => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return fallback;
};

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensureHexColor = (value, fallback) => {
  const color = asString(value);
  const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  return hexRegex.test(color) ? color.toLowerCase() : fallback;
};

const resolveChatCompletionUrl = (baseUrl) => {
  const cleaned = asString(baseUrl).replace(/\/+$/, '');
  if (!cleaned) {
    throw new Error('Missing API base URL for chat completion request.');
  }

  if (cleaned.endsWith('/chat/completions') || cleaned.endsWith('/openai')) {
    return cleaned;
  }

  return `${cleaned}/chat/completions`;
};

const fetchWithTimeout = async (url, options, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
};

const extractContentFromResponse = (payload) => {
  const firstChoice = payload?.choices?.[0]?.message;
  if (!firstChoice) {
    return '';
  }

  if (typeof firstChoice.content === 'string') {
    return firstChoice.content;
  }

  if (Array.isArray(firstChoice.content)) {
    return firstChoice.content
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .join('');
  }

  if (typeof firstChoice.reasoning_content === 'string') {
    return firstChoice.reasoning_content;
  }

  return '';
};

const callOpenAICompatible = async ({url, apiKey, model, messages, temperature = 0.2, maxTokens = 3500}) => {
  const endpoint = resolveChatCompletionUrl(url);
  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_AI_RETRIES + 1; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      const bodyText = await response.text();
      let payload;

      try {
        payload = JSON.parse(bodyText);
      } catch (error) {
        throw new Error(`AI provider returned non-JSON response: ${bodyText.slice(0, 240)}`);
      }

      if (!response.ok || payload.error) {
        const providerMessage =
          payload?.error?.message || payload?.error || bodyText.slice(0, 240) || `HTTP ${response.status}`;
        throw new Error(String(providerMessage));
      }

      const content = extractContentFromResponse(payload);
      if (!content) {
        throw new Error('AI provider returned an empty completion message.');
      }

      return {
        content,
        model: payload.model || model,
      };
    } catch (error) {
      lastError = error;
      if (attempt > MAX_AI_RETRIES) {
        break;
      }

      await sleep(attempt * 1200);
    }
  }

  throw lastError;
};

const extractJsonObject = (content) => {
  const trimmed = content.trim();

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw error;
    }

    const candidate = trimmed.slice(start, end + 1);
    return JSON.parse(candidate);
  }
};

const probePollinationsGithubModel = async () => {
  try {
    await callOpenAICompatible({
      url: POLLINATIONS_OPENAI_URL,
      apiKey: POLLINATIONS_API_KEY,
      model: POLLINATIONS_GITHUB_MODEL,
      temperature: 0,
      maxTokens: 32,
      messages: [
        {
          role: 'user',
          content: 'Return strict JSON only: {"supported":true}',
        },
      ],
    });

    return {
      supported: true,
      reason: 'Pollinations accepted GitHub model identifier.',
    };
  } catch (error) {
    const message = String(error.message || error);
    if (message.toLowerCase().includes('model not found') || message.includes('404')) {
      return {
        supported: false,
        reason: message,
      };
    }

    return {
      supported: false,
      reason: `GitHub-model probe failed: ${message}`,
    };
  }
};

const buildDirectionPrompt = ({song, lines}) => {
  const compactLines = lines.slice(0, 12).map((line, index) => ({
    lineIndex: index,
    text: line.text,
    start: line.start,
    end: line.end,
  }));

  const desiredSceneCount = clamp(Math.ceil(lines.length / 6), 3, 8);

  return [
    'You are a motion graphics director for an animated lyrics video.',
    'Return valid JSON only with no markdown.',
    'The JSON must follow this exact shape:',
    '{',
    '  "styleDescription": "string",',
    '  "palette": {"background":"#hex","primary":"#hex","accent":"#hex","secondary":"#hex"},',
    '  "animationIdeas": ["string", "string", "string"],',
    '  "sceneDirections": [',
    '    {"sceneId":"scene-1","lineStartIndex":0,"lineEndIndex":5,"mood":"string","cameraMotion":"string","backgroundTreatment":"string","entrance":"string","exit":"string","color":"#hex","motionIntensity":0.5}',
    '  ]',
    '}',
    'Constraints:',
    '- Keep colors readable for lyrics videos.',
    '- motionIntensity must be between 0 and 1 inclusive.',
    `- Return ${desiredSceneCount} sceneDirections covering all lyric lines.`,
    '- lineStartIndex and lineEndIndex must be valid indexes for the full lyrics list.',
    '- sceneIds should be unique.',
    '',
    `Song: ${song?.name || 'Unknown Song'} by ${song?.artist || 'Unknown Artist'}`,
    `Duration: ${song?.duration || 0} seconds`,
    `Total lyric lines: ${lines.length}`,
    `Sample lyric lines JSON (first ${compactLines.length} lines): ${JSON.stringify(compactLines)}`,
  ].join('\n');
};

const autoGenerateScenes = (lines, chunkSize = 6) => {
  const scenes = [];
  let sceneCounter = 1;

  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize);
    if (slice.length === 0) {
      continue;
    }

    scenes.push({
      sceneId: `scene-${sceneCounter}`,
      start: asNumber(slice[0].start, 0),
      end: asNumber(slice[slice.length - 1].end, asNumber(slice[0].end, 0)),
      mood: 'lyric-driven cinematic energy',
      cameraMotion: 'subtle push-in with gentle drift',
      backgroundTreatment: 'soft gradient with grain texture',
      lineIndices: slice.map((_, index) => i + index),
    });

    sceneCounter += 1;
  }

  return scenes;
};

const normalizeDirection = (rawDirection, lines) => {
  if (!rawDirection || typeof rawDirection !== 'object' || Array.isArray(rawDirection)) {
    throw new Error('Direction payload is not a JSON object.');
  }

  const palette = {
    background: ensureHexColor(rawDirection.palette?.background, DEFAULT_PALETTE.background),
    primary: ensureHexColor(rawDirection.palette?.primary, DEFAULT_PALETTE.primary),
    accent: ensureHexColor(rawDirection.palette?.accent, DEFAULT_PALETTE.accent),
    secondary: ensureHexColor(rawDirection.palette?.secondary, DEFAULT_PALETTE.secondary),
  };

  const ideas = Array.isArray(rawDirection.animationIdeas)
    ? rawDirection.animationIdeas.map((item) => asString(item)).filter(Boolean)
    : [];

  let sceneDirections = [];
  if (Array.isArray(rawDirection.sceneDirections)) {
    sceneDirections = rawDirection.sceneDirections
      .map((scene, idx) => {
        let lineIndices = [];

        if (Array.isArray(scene?.lineIndices)) {
          lineIndices = scene.lineIndices
            .map((lineIndex) => asNumber(lineIndex, -1))
            .filter((lineIndex) => lineIndex >= 0 && lineIndex < lines.length);
        }

        if (lineIndices.length === 0) {
          const startIndex = clamp(asNumber(scene?.lineStartIndex, 0), 0, Math.max(lines.length - 1, 0));
          const endIndex = clamp(
            asNumber(scene?.lineEndIndex, startIndex),
            startIndex,
            Math.max(lines.length - 1, startIndex)
          );

          lineIndices = [];
          for (let index = startIndex; index <= endIndex; index += 1) {
            lineIndices.push(index);
          }
        }

        const startFromLines =
          lineIndices.length > 0
            ? Math.min(...lineIndices.map((lineIndex) => asNumber(lines[lineIndex].start, 0)))
            : 0;
        const endFromLines =
          lineIndices.length > 0
            ? Math.max(...lineIndices.map((lineIndex) => asNumber(lines[lineIndex].end, startFromLines + 2)))
            : startFromLines + 2;

        const start = asNumber(scene?.start, startFromLines);
        const end = Math.max(start + 0.5, asNumber(scene?.end, endFromLines));

        return {
          sceneId: asString(scene?.sceneId, `scene-${idx + 1}`),
          start,
          end,
          mood: asString(scene?.mood, 'lyrical and cinematic'),
          cameraMotion: asString(scene?.cameraMotion, 'gentle push-in'),
          backgroundTreatment: asString(scene?.backgroundTreatment, 'gradient + texture'),
          entrance: asString(scene?.entrance, 'fade-up'),
          exit: asString(scene?.exit, 'soft fade-out'),
          color: ensureHexColor(scene?.color, palette.primary),
          motionIntensity: clamp(asNumber(scene?.motionIntensity, 0.45), 0, 1),
          lineIndices,
        };
      })
      .filter((scene) => scene.lineIndices.length > 0);
  }

  if (sceneDirections.length === 0) {
    sceneDirections = autoGenerateScenes(lines);
  }

  const sceneLineHints = new Map();
  for (const scene of sceneDirections) {
    for (const lineIndex of scene.lineIndices) {
      sceneLineHints.set(lineIndex, {
        entrance: scene.entrance || 'fade-up',
        exit: scene.exit || 'soft fade-out',
        color: ensureHexColor(scene.color, palette.primary),
        motionIntensity: clamp(asNumber(scene.motionIntensity, 0.45), 0, 1),
        emphasis: `Match scene mood: ${scene.mood}`,
      });
    }
  }

  const byLineIndex = new Map();
  if (Array.isArray(rawDirection.lineDirections)) {
    for (const item of rawDirection.lineDirections) {
      const index = asNumber(item?.lineIndex, -1);
      if (index < 0 || index >= lines.length) {
        continue;
      }

      byLineIndex.set(index, {
        lineIndex: index,
        entrance: asString(item.entrance, sceneLineHints.get(index)?.entrance || 'fade-up'),
        emphasis: asString(item.emphasis, 'highlight the lyrical keyword'),
        exit: asString(item.exit, sceneLineHints.get(index)?.exit || 'soft fade-out'),
        color: ensureHexColor(item.color, sceneLineHints.get(index)?.color || palette.primary),
        motionIntensity: clamp(
          asNumber(item.motionIntensity, sceneLineHints.get(index)?.motionIntensity || 0.45),
          0,
          1
        ),
      });
    }
  }

  const lineDirections = lines.map((line, index) => {
    if (byLineIndex.has(index)) {
      return byLineIndex.get(index);
    }

    return {
      lineIndex: index,
      entrance: sceneLineHints.get(index)?.entrance || 'fade-up',
      emphasis: sceneLineHints.get(index)?.emphasis || 'keep readability with mild scale emphasis',
      exit: sceneLineHints.get(index)?.exit || 'soft fade-out',
      color: sceneLineHints.get(index)?.color || palette.primary,
      motionIntensity: sceneLineHints.get(index)?.motionIntensity || 0.4,
    };
  });

  return {
    styleDescription: asString(
      rawDirection.styleDescription,
      'Cinematic lyric typography with expressive but readable motion and high contrast colors.'
    ),
    palette,
    animationIdeas: ideas.length > 0 ? ideas : DEFAULT_ANIMATION_IDEAS,
    sceneDirections,
    lineDirections,
  };
};

const requestDirection = async ({provider, model, apiUrl, apiKey, song, lines}) => {
  const prompt = buildDirectionPrompt({song, lines});

  const firstResponse = await callOpenAICompatible({
    url: apiUrl,
    apiKey,
    model,
    messages: [
      {
        role: 'system',
        content:
          'You create JSON-only motion direction for animated lyric videos. Do not add markdown or prose outside JSON.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.45,
    maxTokens: 1200,
  });

  try {
    const parsed = extractJsonObject(firstResponse.content);
    return {
      provider,
      model: firstResponse.model,
      parsed,
    };
  } catch (error) {
    const repairPrompt = [
      'Repair the following content into strict valid JSON only.',
      'Do not change meaning. Keep all keys from the target schema.',
      `Broken content: ${firstResponse.content}`,
    ].join('\n');

    const repairResponse = await callOpenAICompatible({
      url: apiUrl,
      apiKey,
      model,
      messages: [
        {
          role: 'system',
          content: 'You output strict JSON only.',
        },
        {
          role: 'user',
          content: repairPrompt,
        },
      ],
      temperature: 0,
      maxTokens: 1400,
    });

    const parsed = extractJsonObject(repairResponse.content);
    return {
      provider,
      model: repairResponse.model,
      parsed,
    };
  }
};

const selectProvider = async () => {
  const githubProbe = await probePollinationsGithubModel();

  if (githubProbe.supported) {
    return {
      selectedProvider: 'pollinations-github-model',
      model: POLLINATIONS_GITHUB_MODEL,
      apiUrl: POLLINATIONS_OPENAI_URL,
      apiKey: POLLINATIONS_API_KEY,
      githubModelSupported: true,
      fallbackReason: '',
    };
  }

  if (GLM5_API_BASE_URL) {
    return {
      selectedProvider: 'glm5-fallback',
      model: GLM5_MODEL,
      apiUrl: GLM5_API_BASE_URL,
      apiKey: GLM5_API_KEY,
      githubModelSupported: false,
      fallbackReason: githubProbe.reason,
    };
  }

  if (STRICT_GLM_FALLBACK) {
    throw new Error(
      'Pollinations GitHub model is unavailable and GLM-5 fallback is not configured. Set GLM5_API_BASE_URL and GLM5_API_KEY (if required).'
    );
  }

  return {
    selectedProvider: 'pollinations-dev-fallback',
    model: POLLINATIONS_FALLBACK_MODEL,
    apiUrl: POLLINATIONS_OPENAI_URL,
    apiKey: POLLINATIONS_API_KEY,
    githubModelSupported: false,
    fallbackReason: `${githubProbe.reason} | GLM5_API_BASE_URL not set; using development fallback model.`,
  };
};

const generateAnimationDirection = async ({song, lines}) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Cannot generate direction without lyric lines.');
  }

  const providerConfig = await selectProvider();
  const directionResponse = await requestDirection({
    provider: providerConfig.selectedProvider,
    model: providerConfig.model,
    apiUrl: providerConfig.apiUrl,
    apiKey: providerConfig.apiKey,
    song,
    lines,
  });

  const direction = normalizeDirection(directionResponse.parsed, lines);

  return {
    direction,
    providerReport: {
      provider: providerConfig.selectedProvider,
      modelRequested: providerConfig.model,
      modelResolved: directionResponse.model,
      githubModelSupported: providerConfig.githubModelSupported,
      fallbackReason: providerConfig.fallbackReason || null,
    },
  };
};

module.exports = {
  generateAnimationDirection,
};
