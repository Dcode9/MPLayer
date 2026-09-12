#!/usr/bin/env python3
"""Patch phase3 scoring, phase7 render env, and Remotion audio sample count."""
from pathlib import Path
import re
import subprocess
import sys

def restore_phase3():
    path = Path('scripts/phase3-build.js')
    text = path.read_text() if path.exists() else ''
    if 'PLACEHOLDER' in text or 'scoreSongForQuery' not in text:
        for sha in [
            '3c78e595f8cc0b97d2d13e2d3f97f2b926d38a20',
            '1fc37a64a976a7faab324e3328f6ff9bcf92c0a6',
            'd57e5b1db55135cf2685abc210ec43f0af6f2418',
        ]:
            try:
                out = subprocess.check_output(
                    ['git', 'show', f'{sha}:scripts/phase3-build.js'],
                    text=True,
                )
            except subprocess.CalledProcessError:
                continue
            if 'scoreSongForQuery' in out:
                path.write_text(out)
                print(f'Restored phase3 from {sha}')
                return
        raise SystemExit('Could not restore phase3-build.js')
    print('phase3 already present')


def patch_scoring():
    path = Path('scripts/phase3-build.js')
    t = path.read_text()
    pattern = r'const scoreSongForQuery = \(song, query\) => \{[\s\S]*?\n\};\n\nconst parseJsonFromText'
    replacement = '''const scoreSongForQuery = (song, query) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const songName = normalizeSearchText(song?.name || '');
  const artistName = normalizeSearchText(song?.artist || '');
  const albumName = normalizeSearchText(song?.album || '');
  const haystack = `${songName} ${artistName}`.trim();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const titleTokens = songName.split(/\s+/).filter(Boolean);
  const primaryToken = queryTokens[0] || '';

  let score = 0;

  if (songName === normalizedQuery) {
    score += 500;
  } else if (titleTokens.join(' ') === queryTokens.slice(0, titleTokens.length).join(' ')) {
    score += 420;
  } else if (primaryToken && songName === primaryToken) {
    score += 400;
  } else if (primaryToken && titleTokens[0] === primaryToken && titleTokens.length <= queryTokens.length + 1) {
    score += 320;
  }

  if (haystack === normalizedQuery) {
    score += 80;
  }

  if (songName.startsWith(normalizedQuery) || (primaryToken && songName.startsWith(primaryToken))) {
    score += 50;
  }

  if (songName.includes(normalizedQuery)) {
    score += 36;
  }

  for (const token of queryTokens) {
    if (titleTokens.includes(token)) {
      score += 22;
    } else if (songName.includes(token)) {
      score += 10;
    }
    if (artistName.includes(token)) {
      score += 4;
    }
  }

  if (primaryToken && primaryToken.length >= 4 && !songName.includes(primaryToken) && !titleTokens.includes(primaryToken)) {
    if (albumName.includes(primaryToken)) {
      score -= 200;
    } else {
      score -= 120;
    }
  }

  const versionHints = ['dhun', 'theme', 'instrumental', 'karaoke', 'bgm', 'score', 'ost', 'reprise'];
  if (versionHints.some((h) => titleTokens.includes(h)) && primaryToken && !versionHints.includes(primaryToken)) {
    score -= 150;
  }

  if (queryTokens.length === 1 && queryTokens[0].length <= 4 && titleTokens.includes(queryTokens[0])) {
    score += 35;
  }

  if (queryTokens.length <= 2 && titleTokens.length > queryTokens.length + 2) {
    score -= 25;
  }

  return score;
};

const parseJsonFromText'''
    new_t, n = re.subn(pattern, replacement, t, count=1)
    if n != 1:
        raise SystemExit(f'scoreSongForQuery replace failed n={n}')
    new_t = new_t.replace('best.score < 35', 'best.score < 80')
    new_t = new_t.replace('topScore < 15', 'topScore < 50')
    path.write_text(new_t)
    print('scoring patched', path.stat().st_size)


def patch_render_env():
    wf = Path('.github/workflows/phase7-youtube-upload.yml')
    w = wf.read_text()
    w = w.replace('PHASE5_RENDER_CONCURRENCY: 2', 'PHASE5_RENDER_CONCURRENCY: 4')
    w = w.replace('PHASE5_RENDER_CRF: 20', 'PHASE5_RENDER_CRF: 23')
    if 'PHASE5_X264_PRESET' not in w:
        w = w.replace(
            'PHASE5_RENDER_CRF: 23',
            'PHASE5_RENDER_CRF: 23\n          PHASE5_X264_PRESET: veryfast',
        )
    wf.write_text(w)
    print('phase7 env patched')

    rem = Path('remotion/LyricsTemplateVideo.jsx')
    r = rem.read_text()
    r = r.replace('numberOfSamples: 128', 'numberOfSamples: 64')
    r = r.replace('return new Array(128).fill(0);', 'return new Array(64).fill(0);')
    rem.write_text(r)
    print('audio samples patched')


def main():
    restore_phase3()
    patch_scoring()
    patch_render_env()
    print('done')


if __name__ == '__main__':
    main()
