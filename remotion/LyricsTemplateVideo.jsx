import React, {useMemo} from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {useAudioData, visualizeAudio} from '@remotion/media-utils';

const TRANSITION_DURATION_SECONDS = 0.9;
const TRANSITION_EASING = Easing.bezier(0.25, 1, 0.5, 1);
const LOGO_INTRO_SECONDS = 2.8;
const LOGO_MOVE_SECONDS = 2.6;

const LINE_STATES = {
  current: {
    opacity: 1,
    offsetY: 0,
    scale: 1,
    rotateX: 0,
    blur: 0,
    shadowOpacity: 0.6,
  },
  previous: {
    opacity: 0.35,
    offsetY: -100,
    scale: 0.6,
    rotateX: -20,
    blur: 5,
    shadowOpacity: 0,
  },
  next: {
    opacity: 0.35,
    offsetY: 100,
    scale: 0.6,
    rotateX: 20,
    blur: 5,
    shadowOpacity: 0,
  },
  hiddenTop: {
    opacity: 0,
    offsetY: -200,
    scale: 0.4,
    rotateX: -40,
    blur: 20,
    shadowOpacity: 0,
  },
  hiddenBottom: {
    opacity: 0,
    offsetY: 200,
    scale: 0.4,
    rotateX: 40,
    blur: 20,
    shadowOpacity: 0,
  },
};

const clamp = (value, min, max) => {
  return Math.min(max, Math.max(min, value));
};

const lerp = (from, to, progress) => {
  return from + (to - from) * progress;
};

const getCurrentLyricIndex = (lyrics, currentTime) => {
  let activeIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (currentTime >= lyrics[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }
  return activeIndex;
};

const getStateNameForIndex = (lineIndex, currentLyricIndex) => {
  if (lineIndex === currentLyricIndex) {
    return 'current';
  }

  if (lineIndex === currentLyricIndex - 1) {
    return 'previous';
  }

  if (lineIndex === currentLyricIndex + 1) {
    return 'next';
  }

  if (lineIndex < currentLyricIndex - 1) {
    return 'hiddenTop';
  }

  return 'hiddenBottom';
};

const interpolateState = (fromState, toState, progress) => {
  return {
    opacity: lerp(fromState.opacity, toState.opacity, progress),
    offsetY: lerp(fromState.offsetY, toState.offsetY, progress),
    scale: lerp(fromState.scale, toState.scale, progress),
    rotateX: lerp(fromState.rotateX, toState.rotateX, progress),
    blur: lerp(fromState.blur, toState.blur, progress),
    shadowOpacity: lerp(fromState.shadowOpacity, toState.shadowOpacity, progress),
  };
};

const buildWavePath = ({waveIndex, width, height, freqValues, bassNormalized, currentTime}) => {
  const waveHeight = height * 0.4;
  const offset = waveIndex * 20;

  let path = `M 0 ${height}`;

  for (let i = 0; i < freqValues.length; i++) {
    const x = (i / (freqValues.length - 1)) * width;
    const freqValue = freqValues[i] / 255;
    const fluidMotion = Math.sin(currentTime + x * 0.005 + waveIndex) * 30;
    const y = height - (freqValue * waveHeight) - fluidMotion - (bassNormalized * 50) + offset;

    path += ` L ${x} ${y}`;
  }

  path += ` L ${width} ${height} L 0 ${height} Z`;
  return path;
};

const getLogoAnimationState = ({frame, fps, width, height}) => {
  const introFrames = Math.max(1, Math.round(LOGO_INTRO_SECONDS * fps));
  const moveFrames = Math.max(1, Math.round(LOGO_MOVE_SECONDS * fps));

  const introProgress = clamp(frame / introFrames, 0, 1);
  const moveProgress = clamp((frame - introFrames) / moveFrames, 0, 1);

  const introEase = Easing.out(Easing.cubic)(introProgress);
  const moveEase = Easing.inOut(Easing.cubic)(moveProgress);

  const shortEdge = Math.min(width, height);
  const centerSize = shortEdge * 0.28;
  const cornerSize = shortEdge * 0.14;
  const size = lerp(centerSize, cornerSize, moveEase);

  const centerX = width / 2;
  const centerY = height / 2;
  const margin = shortEdge * 0.035;
  const targetX = width - (size / 2) - margin;
  const targetY = height - (size / 2) - margin;

  const x = lerp(centerX, targetX, moveEase);
  const y = lerp(centerY, targetY, moveEase);

  const popScale = interpolate(introEase, [0, 0.75, 1], [0.24, 1.08, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = lerp(popScale, 1, moveEase);

  const introOpacity = interpolate(introEase, [0, 0.3, 1], [0, 0.8, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = introOpacity * lerp(1, 0.88, moveEase);

  return {
    x,
    y,
    size,
    scale,
    opacity,
    plateOpacity: lerp(0.34, 0.22, moveEase),
    plateBlur: lerp(20, 12, moveEase),
  };
};

const SvgIcon = ({size, fill = 'none', stroke = 'currentColor', strokeWidth = 2, children}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
};

const RefreshIcon = ({size = 20}) => {
  return (
    <SvgIcon size={size}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.5 9a9 9 0 0 1 14.15-3.36L23 10" />
      <path d="M20.5 15a9 9 0 0 1-14.15 3.36L1 14" />
    </SvgIcon>
  );
};

const RewindIcon = ({size = 24}) => {
  return (
    <SvgIcon size={size} fill="currentColor" stroke="none">
      <path d="M11 18L3 12L11 6V18Z" />
      <path d="M21 18L13 12L21 6V18Z" />
    </SvgIcon>
  );
};

const FastForwardIcon = ({size = 24}) => {
  return (
    <SvgIcon size={size} fill="currentColor" stroke="none">
      <path d="M3 18L11 12L3 6V18Z" />
      <path d="M13 18L21 12L13 6V18Z" />
    </SvgIcon>
  );
};

const PlayIcon = ({size = 28}) => {
  return (
    <SvgIcon size={size} fill="currentColor" stroke="none">
      <path d="M8 5V19L19 12L8 5Z" />
    </SvgIcon>
  );
};

export const LyricsTemplateVideo = ({songData, showAnimatedLogo = false, logoSrc}) => {
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const frame = useCurrentFrame();

  const parsedLyrics = useMemo(() => {
    const lines = songData?.lines ?? [];
    return lines.map((line) => ({time: line.start, text: line.text, end: line.end}));
  }, [songData]);

  const audioSrc = songData?.song?.audioUrl ?? '';
  const albumArtSrc = songData?.song?.image ?? '';
  const songName = songData?.song?.name ?? '';
  const artistName = songData?.song?.artist ?? '';
  const resolvedLogoSrc = logoSrc || staticFile('assets/DTunes-transparent.svg');

  const audioData = useAudioData(audioSrc);
  const currentTime = frame / fps;

  const frequencyData = useMemo(() => {
    if (!audioData) {
      return new Array(128).fill(0);
    }

    const values = visualizeAudio({
      fps,
      frame,
      audioData,
      numberOfSamples: 128,
    });

    return values.map((value) => clamp(value, 0, 1) * 255);
  }, [audioData, fps, frame]);

  const bassNormalized = useMemo(() => {
    const lowBand = frequencyData.slice(0, 10);
    if (lowBand.length === 0) {
      return 0;
    }

    const bassAverage = lowBand.reduce((sum, value) => sum + value, 0) / lowBand.length;
    return clamp(bassAverage / 255, 0, 1);
  }, [frequencyData]);

  const bgScale = 1.1 + (bassNormalized * 0.15);
  const bgBlur = 60 - (bassNormalized * 20);
  const textScale = 1 + (bassNormalized * 0.08);

  const currentLyricIndex = useMemo(() => {
    return getCurrentLyricIndex(parsedLyrics, currentTime);
  }, [parsedLyrics, currentTime]);

  const previousLyricIndex = currentLyricIndex <= -1 ? -1 : currentLyricIndex - 1;

  const lyricChangeTime =
    currentLyricIndex <= -1 ? 0 : parsedLyrics[currentLyricIndex]?.time ?? 0;

  const transitionProgress =
    currentLyricIndex <= -1
      ? 1
      : TRANSITION_EASING(
          clamp((currentTime - lyricChangeTime) / TRANSITION_DURATION_SECONDS, 0, 1),
        );

  const waveLayers = useMemo(() => {
    const layers = [];

    for (let wave = 0; wave < 3; wave++) {
      let topAlpha = 0.2;
      if (wave === 0) {
        topAlpha = 0.1 + (bassNormalized * 0.2);
      } else if (wave === 1) {
        topAlpha = 0.05 + (bassNormalized * 0.1);
      }

      const color = wave === 2 ? '0, 0, 0' : '255, 255, 255';
      layers.push({
        id: `wave-${wave}`,
        path: buildWavePath({
          waveIndex: wave,
          width,
          height,
          freqValues: frequencyData,
          bassNormalized,
          currentTime,
        }),
        gradientTop: `rgba(${color}, ${topAlpha})`,
      });
    }

    return layers;
  }, [bassNormalized, currentTime, frequencyData, height, width]);

  const shortEdge = Math.min(width, height);
  const horizontalPadding = Math.max(16, Math.round(width * 0.03));
  const lyricFontSize = Math.max(44, Math.round(shortEdge * 0.067));
  const titleFontSize = Math.max(72, Math.round(shortEdge * 0.089));
  const titleArtistFontSize = Math.max(24, Math.round(shortEdge * 0.028));

  const logoState = useMemo(() => {
    return getLogoAnimationState({frame, fps, width, height});
  }, [frame, fps, width, height]);

  const getLineVisualState = (lineIndex) => {
    const targetStateName = getStateNameForIndex(lineIndex, currentLyricIndex);
    const targetState = LINE_STATES[targetStateName];

    if (currentLyricIndex <= -1) {
      return targetState;
    }

    const previousStateName = getStateNameForIndex(lineIndex, previousLyricIndex);
    const previousState = LINE_STATES[previousStateName];

    return interpolateState(previousState, targetState, transitionProgress);
  };

  const getLineStyle = (lineIndex) => {
    const state = getLineVisualState(lineIndex);
    const pointerEvents = state.opacity < 0.01 ? 'none' : 'auto';

    return {
      position: 'absolute',
      top: '50%',
      left: '50%',
      margin: 0,
      textAlign: 'center',
      opacity: state.opacity,
      transform: `translate(-50%, calc(-50% + ${state.offsetY}px)) scale(${state.scale}) rotateX(${state.rotateX}deg)`,
      filter: `blur(${state.blur}px)`,
      transformStyle: 'preserve-3d',
      willChange: 'transform, opacity, filter',
      textShadow: `0 0 30px rgba(255,255,255,${state.shadowOpacity})`,
      pointerEvents,
    };
  };

  const controlsBottom = height * 0.0926;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000000',
        color: '#ffffff',
        overflow: 'hidden',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
      }}
    >
      <Audio src={audioSrc} />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#000000',
        }}
      >
        <Img
          src={albumArtSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.6,
            mixBlendMode: 'screen',
            transform: `scale(${bgScale})`,
            filter: `blur(${bgBlur}px) saturate(200%) brightness(0.7)`,
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)',
        }}
      />

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 10,
          opacity: 0.7,
        }}
      >
        <defs>
          {waveLayers.map((wave) => {
            return (
              <linearGradient
                key={`${wave.id}-gradient`}
                id={`${wave.id}-gradient`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={wave.gradientTop} />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </linearGradient>
            );
          })}
        </defs>

        {waveLayers.map((wave) => {
          return <path key={wave.id} d={wave.path} fill={`url(#${wave.id}-gradient)`} />;
        })}
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          pointerEvents: 'none',
          paddingLeft: horizontalPadding,
          paddingRight: horizontalPadding,
          perspective: 1000,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            ...getLineStyle(-1),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          <div
            style={{
              transform: `scale(${textScale})`,
              willChange: 'transform',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <h2
              style={{
                margin: 0,
                marginBottom: 16,
                fontSize: titleFontSize,
                lineHeight: 1,
                fontWeight: 900,
                color: 'transparent',
                backgroundImage:
                  'linear-gradient(to bottom, rgba(255,255,255,1), rgba(255,255,255,0.7))',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                filter: 'drop-shadow(0 0 30px rgba(255,255,255,0.3))',
              }}
            >
              {songName}
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: titleArtistFontSize,
                lineHeight: 1.1,
                color: 'rgb(216, 180, 254)',
                fontWeight: 500,
                letterSpacing: 4,
                textTransform: 'uppercase',
              }}
            >
              {artistName}
            </p>
          </div>
        </div>

        {parsedLyrics.map((lyric, index) => {
          return (
            <div
              key={`${index}-${lyric.time}`}
              style={{
                ...getLineStyle(index),
                width: '100%',
                paddingLeft: 16,
                paddingRight: 16,
                fontSize: lyricFontSize,
                lineHeight: 1.12,
                fontWeight: 900,
                color: '#ffffff',
              }}
            >
              <div
                style={{
                  transform: `scale(${textScale})`,
                  willChange: 'transform',
                }}
              >
                {lyric.text}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: controlsBottom,
          transform: 'translateX(-50%)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '16px 32px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
          opacity: 0.2,
        }}
      >
        <button
          type="button"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            padding: 8,
          }}
        >
          <RefreshIcon size={20} />
        </button>

        <button
          type="button"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            padding: 8,
          }}
        >
          <RewindIcon size={24} />
        </button>

        <div
          style={{
            width: 56,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: '#ffffff',
            color: '#000000',
            boxShadow: '0 0 20px rgba(255,255,255,0.5)',
          }}
        >
          {frame >= durationInFrames - 1 ? (
            <PlayIcon size={28} />
          ) : (
            <PlayIcon size={28} />
          )}
        </div>

        <button
          type="button"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            padding: 8,
          }}
        >
          <FastForwardIcon size={24} />
        </button>
      </div>

      {showAnimatedLogo ? (
        <div
          style={{
            position: 'absolute',
            left: logoState.x - (logoState.size / 2),
            top: logoState.y - (logoState.size / 2),
            width: logoState.size,
            height: logoState.size,
            opacity: logoState.opacity,
            transform: `scale(${logoState.scale})`,
            transformOrigin: 'center center',
            zIndex: 40,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: Math.round(logoState.size * 0.22),
              background: `rgba(11, 14, 22, ${logoState.plateOpacity})`,
              backdropFilter: `blur(${logoState.plateBlur}px)`,
              WebkitBackdropFilter: `blur(${logoState.plateBlur}px)`,
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 16px 35px rgba(0,0,0,0.35)',
            }}
          />

          <div
            style={{
              position: 'absolute',
              inset: 0,
              padding: logoState.size * 0.12,
            }}
          >
            <Img
              src={resolvedLogoSrc}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.45))',
              }}
            />
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
