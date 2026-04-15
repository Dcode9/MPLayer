import React from 'react';
import {AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/700.css';

const DEFAULT_PALETTE = {
  background: '#0b1021',
  primary: '#f8fafc',
  accent: '#22d3ee',
  secondary: '#f97316',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asString = (value, fallback = '') => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return fallback;
};

const toFrame = (seconds, fps) => {
  const secondsNumber = Number(seconds);
  if (Number.isNaN(secondsNumber)) {
    return 0;
  }

  return Math.max(0, Math.round(secondsNumber * fps));
};

const normalizeColor = (value, fallback) => {
  const color = asString(value);
  const isHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
  return isHex ? color.toLowerCase() : fallback;
};

const hexToRgb = (hex) => {
  const color = normalizeColor(hex, '#000000');
  const clean = color.slice(1);
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};

const rgba = (hex, alpha = 1) => {
  const {r, g, b} = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
};

const shiftColor = (hex, amount) => {
  const {r, g, b} = hexToRgb(hex);
  const multiplier = 1 + amount;
  const nextR = clamp(Math.round(r * multiplier), 0, 255);
  const nextG = clamp(Math.round(g * multiplier), 0, 255);
  const nextB = clamp(Math.round(b * multiplier), 0, 255);
  return `rgb(${nextR}, ${nextG}, ${nextB})`;
};

const channelLuminance = (value) => {
  const normalized = value / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
};

const contrastRatio = (hexA, hexB) => {
  const a = hexToRgb(normalizeColor(hexA, '#ffffff'));
  const b = hexToRgb(normalizeColor(hexB, '#000000'));

  const lumaA =
    0.2126 * channelLuminance(a.r) +
    0.7152 * channelLuminance(a.g) +
    0.0722 * channelLuminance(a.b);
  const lumaB =
    0.2126 * channelLuminance(b.r) +
    0.7152 * channelLuminance(b.g) +
    0.0722 * channelLuminance(b.b);

  const lighter = Math.max(lumaA, lumaB);
  const darker = Math.min(lumaA, lumaB);
  return (lighter + 0.05) / (darker + 0.05);
};

const pickReadableColor = (backgroundHex, preferredHex, fallbackHex = '#f8fafc') => {
  const preferred = normalizeColor(preferredHex, fallbackHex);
  const fallback = normalizeColor(fallbackHex, '#f8fafc');

  if (contrastRatio(preferred, backgroundHex) >= 4) {
    return preferred;
  }

  if (contrastRatio(fallback, backgroundHex) >= 4) {
    return fallback;
  }

  return contrastRatio('#ffffff', backgroundHex) > contrastRatio('#111827', backgroundHex)
    ? '#ffffff'
    : '#111827';
};

const resolveAudioSource = (audio) => {
  if (!audio || typeof audio !== 'object' || !audio.src) {
    return null;
  }

  if (audio.mode === 'static') {
    return staticFile(audio.src);
  }

  return audio.src;
};

const getBeatPulse = ({frame, fps, lines}) => {
  const tempoBpm = 94;
  const beatFrames = Math.max(1, Math.round((60 / tempoBpm) * fps));
  const beatPhase = (frame % beatFrames) / beatFrames;
  const beatDistance = Math.min(beatPhase, 1 - beatPhase);
  const basePulse = clamp(1 - beatDistance * 8.4, 0, 1);

  const lyricOnsetWindow = Math.max(4, Math.round(fps * 0.18));
  let lyricOnsetPulse = 0;

  for (const line of lines) {
    const start = toFrame(line?.start, fps);
    const distance = Math.abs(frame - start);
    if (distance <= lyricOnsetWindow) {
      lyricOnsetPulse = Math.max(lyricOnsetPulse, 1 - distance / lyricOnsetWindow);
    }
  }

  return clamp(basePulse * 0.45 + lyricOnsetPulse * 0.92, 0, 1);
};

const getPalette = (direction) => {
  const rawPalette = direction?.palette || {};
  return {
    background: normalizeColor(rawPalette.background, DEFAULT_PALETTE.background),
    primary: normalizeColor(rawPalette.primary, DEFAULT_PALETTE.primary),
    accent: normalizeColor(rawPalette.accent, DEFAULT_PALETTE.accent),
    secondary: normalizeColor(rawPalette.secondary, DEFAULT_PALETTE.secondary),
  };
};

const findActiveScene = (scenes, currentSeconds) => {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return null;
  }

  const inRange = scenes.find((scene) => {
    const start = asNumber(scene?.start, 0);
    const end = Math.max(start + 0.2, asNumber(scene?.end, start + 1));
    return currentSeconds >= start && currentSeconds < end;
  });

  return inRange || scenes[0] || null;
};

const sceneBackground = ({scene, palette, beatPulse, timeSeconds}) => {
  const treatment = asString(scene?.backgroundTreatment, '').toLowerCase();
  const sceneColor = normalizeColor(scene?.color, palette.primary);
  const drift = Math.sin(timeSeconds * 0.9) * 0.08;
  const beatBoost = beatPulse * 0.17;
  const layerA = shiftColor(palette.background, -0.24 + drift + beatBoost * 0.35);
  const layerB = shiftColor(palette.accent, -0.24 + beatBoost);
  const layerC = shiftColor(palette.secondary, -0.3 + beatBoost * 0.7);

  const xA = 18 + Math.sin(timeSeconds * 0.58) * 11 + beatPulse * 10;
  const yA = 22 + Math.cos(timeSeconds * 0.74) * 8;
  const xB = 79 + Math.cos(timeSeconds * 0.7) * 12 - beatPulse * 7;
  const yB = 74 + Math.sin(timeSeconds * 0.62) * 9;

  const baseLayer = `radial-gradient(circle at ${xA}% ${yA}%, ${rgba(layerB, 0.31)} 0%, transparent 45%), radial-gradient(circle at ${xB}% ${yB}%, ${rgba(layerC, 0.27)} 0%, transparent 42%)`;

  if (treatment.includes('aurora')) {
    return `${baseLayer}, linear-gradient(140deg, ${layerA} 0%, ${layerB} 54%, ${shiftColor(layerC, -0.06)} 100%)`;
  }

  if (treatment.includes('watercolor')) {
    return `${baseLayer}, linear-gradient(135deg, ${shiftColor(sceneColor, -0.25 + beatBoost * 0.4)} 0%, ${shiftColor(
      palette.background,
      0.06
    )} 45%, ${shiftColor(palette.background, -0.1)} 100%)`;
  }

  if (treatment.includes('fiery')) {
    return `${baseLayer}, linear-gradient(150deg, ${shiftColor('#ff6b2d', -0.45 + beatBoost * 0.45)} 0%, ${shiftColor(
      '#ffbe0b',
      -0.55 + beatBoost * 0.25
    )} 45%, ${shiftColor(palette.background, -0.25)} 100%)`;
  }

  if (treatment.includes('night')) {
    return `${baseLayer}, linear-gradient(145deg, ${shiftColor(palette.background, -0.35)} 0%, ${shiftColor(
      palette.background,
      -0.15 + beatBoost * 0.2
    )} 60%, ${shiftColor(sceneColor, -0.25)} 100%)`;
  }

  if (treatment.includes('dusk')) {
    return `${baseLayer}, linear-gradient(155deg, ${shiftColor('#f97316', -0.2 + beatBoost * 0.25)} 0%, ${shiftColor(
      '#ec4899',
      -0.2 + beatBoost * 0.2
    )} 35%, ${shiftColor(palette.background, -0.25)} 100%)`;
  }

  return `${baseLayer}, linear-gradient(140deg, ${layerA} 0%, ${shiftColor(palette.background, -0.14)} 62%, ${shiftColor(
    sceneColor,
    -0.31
  )} 100%)`;
};

const buildOrbStyles = ({timeSeconds, beatPulse, palette}) => {
  const accent = normalizeColor(palette.accent, DEFAULT_PALETTE.accent);
  const secondary = normalizeColor(palette.secondary, DEFAULT_PALETTE.secondary);

  return [
    {
      width: 520,
      height: 520,
      left: -130 + Math.sin(timeSeconds * 0.65) * 35,
      top: -120 + Math.cos(timeSeconds * 0.58) * 28,
      background: `radial-gradient(circle, ${rgba(accent, 0.33 + beatPulse * 0.16)} 0%, ${rgba(accent, 0)} 68%)`,
      transform: `scale(${1 + beatPulse * 0.08})`,
    },
    {
      width: 460,
      height: 460,
      right: -100 + Math.cos(timeSeconds * 0.53) * 40,
      bottom: -115 + Math.sin(timeSeconds * 0.49) * 32,
      background: `radial-gradient(circle, ${rgba(secondary, 0.3 + beatPulse * 0.14)} 0%, ${rgba(secondary, 0)} 70%)`,
      transform: `scale(${1 + beatPulse * 0.09})`,
    },
    {
      width: 360,
      height: 360,
      left: '50%',
      top: '14%',
      marginLeft: -180 + Math.sin(timeSeconds * 0.48) * 26,
      background: `radial-gradient(circle, ${rgba('#ffffff', 0.06 + beatPulse * 0.08)} 0%, ${rgba('#ffffff', 0)} 75%)`,
      transform: `scale(${1 + beatPulse * 0.06})`,
    },
  ];
};

const parseDirectionalOffset = (descriptor, baseDistance, axis) => {
  const raw = asString(descriptor, '').toLowerCase();
  if (!raw) {
    return 0;
  }

  if (axis === 'x') {
    if (raw.includes('left')) return -baseDistance;
    if (raw.includes('right')) return baseDistance;
    return 0;
  }

  if (raw.includes('up')) return -baseDistance;
  if (raw.includes('down')) return baseDistance;
  return 0;
};

const resolveSceneByLineIndex = (scenes) => {
  const map = new Map();
  if (!Array.isArray(scenes)) {
    return map;
  }

  for (const scene of scenes) {
    const lineIndices = Array.isArray(scene?.lineIndices) ? scene.lineIndices : [];
    for (const rawIndex of lineIndices) {
      const index = asNumber(rawIndex, -1);
      if (index >= 0 && !map.has(index)) {
        map.set(index, scene);
      }
    }
  }

  return map;
};

const resolveDirectionForLine = ({lineIndex, directionMap, sceneByLine, palette}) => {
  const lineDirection = directionMap.get(lineIndex) || null;
  const scene = sceneByLine.get(lineIndex) || null;

  return {
    entrance: asString(lineDirection?.entrance, asString(scene?.entrance, 'fade up')),
    exit: asString(lineDirection?.exit, asString(scene?.exit, 'soft fade')),
    emphasis: asString(lineDirection?.emphasis, `match scene mood ${asString(scene?.mood, 'lyrical')}`),
    color: normalizeColor(lineDirection?.color, normalizeColor(scene?.color, palette.primary)),
    motionIntensity: clamp(
      asNumber(lineDirection?.motionIntensity, asNumber(scene?.motionIntensity, 0.45)),
      0,
      1
    ),
  };
};

const emphasisStrength = (emphasis, motionIntensity) => {
  const text = asString(emphasis, '').toLowerCase();
  let factor = 0.025 + motionIntensity * 0.05;

  if (text.includes('intense') || text.includes('epic') || text.includes('climax')) {
    factor += 0.05;
  }

  if (text.includes('subtle') || text.includes('soft')) {
    factor -= 0.01;
  }

  return clamp(factor, 0.01, 0.14);
};

export const LyricsVideo = ({lines = [], direction = {}, audio = null}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentSeconds = frame / fps;
  const beatPulse = getBeatPulse({frame, fps, lines});

  const palette = getPalette(direction);
  const sceneDirections = Array.isArray(direction?.sceneDirections) ? direction.sceneDirections : [];
  const activeScene = findActiveScene(sceneDirections, currentSeconds);
  const directionMap = new Map(
    (Array.isArray(direction?.lineDirections) ? direction.lineDirections : [])
      .map((entry) => [asNumber(entry?.lineIndex, -1), entry])
      .filter(([index]) => index >= 0)
  );
  const sceneByLine = resolveSceneByLineIndex(sceneDirections);

  const visibleLines = lines
    .map((line, lineIndex) => {
      const start = toFrame(line.start, fps);
      const end = Math.max(start + 1, toFrame(line.end, fps));

      return {
        line,
        lineIndex,
        start,
        end,
      };
    })
    .filter((item) => frame >= item.start && frame <= item.end);

  const background = sceneBackground({
    scene: activeScene,
    palette,
    beatPulse,
    timeSeconds: currentSeconds,
  });

  const overlayOrbs = buildOrbStyles({
    timeSeconds: currentSeconds,
    beatPulse,
    palette,
  });

  const audioSrc = resolveAudioSource(audio);

  const beatGlow = `radial-gradient(circle at ${50 + Math.sin(currentSeconds * 1.7) * 15}% ${52 + Math.cos(
    currentSeconds * 1.3
  ) * 14}%, ${rgba(palette.accent, 0.12 + beatPulse * 0.26)} 0%, transparent 54%)`;

  const readablePrimary = pickReadableColor(palette.background, palette.primary, '#f8fafc');
  const panelBase = normalizeColor('#111827', '#111827');

  return (
    <AbsoluteFill
      style={{
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Noto Sans Devanagari, Nirmala UI, Mangal, Segoe UI, sans-serif',
        color: readablePrimary,
        padding: '0 64px',
        overflow: 'hidden',
      }}
    >
      {audioSrc ? <Audio src={audioSrc} volume={0.95} /> : null}

      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: beatGlow,
          mixBlendMode: 'screen',
          opacity: 0.5 + beatPulse * 0.38,
        }}
      />

      {overlayOrbs.map((orbStyle, index) => {
        return (
          <div
            key={`orb-${index}`}
            style={{
              position: 'absolute',
              borderRadius: '9999px',
              filter: 'blur(12px)',
              pointerEvents: 'none',
              ...orbStyle,
            }}
          />
        );
      })}

      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          opacity: 0.07,
          background:
            'repeating-linear-gradient(110deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 1px, transparent 1px, transparent 18px)',
          mixBlendMode: 'overlay',
        }}
      />

      {visibleLines.map((item, visibleIndex) => {
        const {line, lineIndex, start, end} = item;
        const durationFrames = Math.max(1, end - start);
        const directionForLine = resolveDirectionForLine({
          lineIndex,
          directionMap,
          sceneByLine,
          palette,
        });

        const intensity = directionForLine.motionIntensity;
        const fadeFrames = Math.min(Math.max(6, Math.round(10 + intensity * 10)), Math.floor(durationFrames / 2));
        const enterEnd = Math.min(end, start + fadeFrames);
        const exitStart = Math.max(start, end - fadeFrames);

        const opacity = interpolate(frame, [start, enterEnd, exitStart, end], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        const entranceDistance = 34 + intensity * 90;
        const exitDistance = 26 + intensity * 110;
        const enterXStart = parseDirectionalOffset(directionForLine.entrance, entranceDistance, 'x');
        const enterYStart = parseDirectionalOffset(directionForLine.entrance, entranceDistance, 'y');
        const exitXEnd = parseDirectionalOffset(directionForLine.exit, exitDistance, 'x');
        const exitYEnd = parseDirectionalOffset(directionForLine.exit, exitDistance, 'y');

        const enterX = interpolate(frame, [start, enterEnd], [enterXStart, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const enterY = interpolate(frame, [start, enterEnd], [enterYStart, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const exitX = interpolate(frame, [exitStart, end], [0, exitXEnd], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const exitY = interpolate(frame, [exitStart, end], [0, exitYEnd], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        const localProgress = durationFrames > 0 ? (frame - start) / durationFrames : 0;
        const pulseAmount = emphasisStrength(directionForLine.emphasis, intensity);
        const pulse = 1 + Math.sin(localProgress * Math.PI) * pulseAmount;

        let baseScale = interpolate(frame, [start, enterEnd], [0.88 - intensity * 0.2, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        const exitDescriptor = directionForLine.exit.toLowerCase();
        if (exitDescriptor.includes('explode')) {
          baseScale = interpolate(frame, [exitStart, end], [baseScale, 1.08 + intensity * 0.18], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
        }

        const stackOffset = (visibleIndex - (visibleLines.length - 1) / 2) * (64 + intensity * 32);
        const floatOffset = Math.sin((frame - start) / (fps * 0.68)) * (2 + intensity * 6);
        const fontSize = Math.round(58 + intensity * 18);
        const sweepProgress = interpolate(frame, [start, enterEnd], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const lineColor = pickReadableColor(panelBase, directionForLine.color, readablePrimary);
        const panelTranslateY = enterY + exitY + stackOffset + floatOffset;

        return (
          <div
            key={`${lineIndex}-${line.text}`}
            style={{
              position: 'absolute',
              width: 'min(960px, 86%)',
              padding: '26px 36px 24px 36px',
              borderRadius: 24,
              border: `1px solid ${rgba(directionForLine.color, 0.45)}`,
              background: `linear-gradient(135deg, ${rgba(shiftColor(palette.background, -0.4), 0.82)} 0%, ${rgba(
                shiftColor(palette.background, -0.25),
                0.72
              )} 100%)`,
              boxShadow: `0 18px 45px ${rgba('#000000', 0.38)}, 0 0 0 1px ${rgba(directionForLine.color, 0.2)} inset, 0 0 40px ${rgba(
                directionForLine.color,
                0.12 + beatPulse * 0.14
              )}`,
              opacity,
              transform: `translate3d(${enterX + exitX}px, ${panelTranslateY}px, 0) scale(${baseScale * pulse})`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: `linear-gradient(90deg, ${rgba(directionForLine.color, 0)} 0%, ${rgba(
                  directionForLine.color,
                  0.85
                )} 48%, ${rgba(directionForLine.color, 0)} 100%)`,
                transform: `scaleX(${0.25 + 0.75 * sweepProgress})`,
                transformOrigin: 'left center',
              }}
            />

            <div
              style={{
                position: 'absolute',
                top: -8,
                bottom: -8,
                left: '-35%',
                width: '35%',
                background: `linear-gradient(90deg, ${rgba('#ffffff', 0)} 0%, ${rgba('#ffffff', 0.22)} 50%, ${rgba(
                  '#ffffff',
                  0
                )} 100%)`,
                transform: `translateX(${sweepProgress * 290}%)`,
                mixBlendMode: 'screen',
                pointerEvents: 'none',
              }}
            />

            <p
              style={{
                margin: 0,
                fontSize,
                fontWeight: 700,
                textAlign: 'center',
                letterSpacing: 0,
                lineHeight: 1.2,
                color: lineColor,
                textShadow: `0 4px 16px ${rgba('#000000', 0.5)}, 0 0 30px ${rgba(directionForLine.color, 0.2)}`,
                whiteSpace: 'pre-wrap',
              }}
            >
              {line.text}
            </p>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
