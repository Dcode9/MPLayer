const MIN_LINE_DURATION_SEC = 0.8;

const roundSeconds = (value) => Math.round(value * 1000) / 1000;

const cleanText = (value) =>
  String(value || '')
    .replace(/\r/g, '')
    .trim();

const parseTimestamp = (minutes, seconds, fraction = '') => {
  const mm = Number(minutes);
  const ss = Number(seconds);

  let ff = 0;
  if (fraction) {
    if (fraction.length === 1) {
      ff = Number(fraction) / 10;
    } else if (fraction.length === 2) {
      ff = Number(fraction) / 100;
    } else {
      ff = Number(fraction) / 1000;
    }
  }

  return mm * 60 + ss + ff;
};

const parseSyncedLyrics = (lrcText, durationInSeconds = 0) => {
  const source = cleanText(lrcText);
  if (!source) {
    return [];
  }

  const rows = source.split('\n');
  const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const timed = [];

  for (const row of rows) {
    const text = cleanText(row.replace(timestampRegex, ''));
    if (!text) {
      continue;
    }

    const matches = [...row.matchAll(timestampRegex)];
    if (matches.length === 0) {
      continue;
    }

    for (const match of matches) {
      timed.push({
        text,
        start: parseTimestamp(match[1], match[2], match[3]),
      });
    }
  }

  timed.sort((a, b) => a.start - b.start);

  const lines = [];
  for (let i = 0; i < timed.length; i += 1) {
    const current = timed[i];
    const next = timed[i + 1];

    let end = next ? next.start : current.start + 3;
    if (durationInSeconds > 0 && !next) {
      end = durationInSeconds;
    }

    end = Math.max(current.start + MIN_LINE_DURATION_SEC, end);

    lines.push({
      text: current.text,
      start: roundSeconds(current.start),
      end: roundSeconds(end),
    });
  }

  return lines;
};

const splitPlainLyrics = (plainLyrics) => {
  const source = cleanText(plainLyrics);
  if (!source) {
    return [];
  }

  return source
    .split('\n')
    .map((line) => cleanText(line))
    .filter((line) => line.length > 0);
};

const approximateTimeline = (plainLyrics, durationInSeconds = 0) => {
  const textLines = splitPlainLyrics(plainLyrics);
  if (textLines.length === 0) {
    return [];
  }

  const fallbackDuration = Math.max(textLines.length * 3, 30);
  const totalDuration = durationInSeconds > 0 ? durationInSeconds : fallbackDuration;
  const slot = totalDuration / textLines.length;

  return textLines.map((text, index) => {
    const start = index * slot;
    const end = Math.max(start + MIN_LINE_DURATION_SEC, (index + 1) * slot);
    return {
      text,
      start: roundSeconds(start),
      end: roundSeconds(end),
    };
  });
};

const buildTimeline = ({syncedLyrics, plainLyrics, durationInSeconds = 0}) => {
  const synced = parseSyncedLyrics(syncedLyrics, durationInSeconds);
  if (synced.length > 0) {
    return {
      timingMode: 'synced',
      lines: synced,
    };
  }

  const approximated = approximateTimeline(plainLyrics, durationInSeconds);
  if (approximated.length > 0) {
    return {
      timingMode: 'approximate',
      lines: approximated,
    };
  }

  return {
    timingMode: 'none',
    lines: [],
  };
};

module.exports = {
  buildTimeline,
};
