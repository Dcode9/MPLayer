import React from 'react';
import {Composition} from 'remotion';
import {LyricsVideo} from './LyricsVideo';

const defaultProps = {
  song: {
    name: 'Test Song',
    artist: 'Unknown Artist',
  },
  lines: [
    {text: 'Hello world', start: 0, end: 2},
    {text: 'This is a test video', start: 2, end: 5},
  ],
  audio: null,
  direction: {
    styleDescription: 'Readable cinematic typography with subtle motion.',
    palette: {
      background: '#0f172a',
      primary: '#f8fafc',
      accent: '#22d3ee',
      secondary: '#f59e0b',
    },
    animationIdeas: ['Gentle fade-up entrances', 'Mild push-in emphasis', 'Soft exits'],
    sceneDirections: [],
    lineDirections: [],
  },
};

const calculateDurationInFrames = (props, fps) => {
  const lines = Array.isArray(props?.lines) ? props.lines : [];
  const maxLineEnd = lines.reduce((maxValue, line) => {
    const end = Number(line?.end);
    if (!Number.isFinite(end)) {
      return maxValue;
    }

    return Math.max(maxValue, end);
  }, 0);

  const songDuration = Number(props?.song?.duration);
  const explicitDuration = Number(props?.durationInSeconds);
  const hasExplicitDuration = Number.isFinite(explicitDuration) && explicitDuration > 0;
  const baseSeconds = hasExplicitDuration
    ? Math.max(5, explicitDuration)
    : Math.max(maxLineEnd, Number.isFinite(songDuration) ? songDuration : 0, 5);

  return Math.max(150, Math.ceil((baseSeconds + 0.5) * fps));
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="LyricsVideo"
      component={LyricsVideo}
      durationInFrames={150}
      fps={30}
      width={1280}
      height={720}
      defaultProps={defaultProps}
      calculateMetadata={({props, defaultProps: metadataDefaults}) => {
        const mergedProps = {
          ...metadataDefaults,
          ...props,
        };

        return {
          durationInFrames: calculateDurationInFrames(mergedProps, 30),
        };
      }}
    />
  );
};
