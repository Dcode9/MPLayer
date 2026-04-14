import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

const toFrame = (seconds, fps) => {
  const asNumber = Number(seconds);
  if (Number.isNaN(asNumber)) {
    return 0;
  }

  return Math.max(0, Math.round(asNumber * fps));
};

export const LyricsVideo = ({lines = []}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Helvetica, Arial, sans-serif',
        color: '#f8fafc',
        padding: '0 64px',
      }}
    >
      {lines.map((line, index) => {
        const start = toFrame(line.start, fps);
        const end = Math.max(start + 1, toFrame(line.end, fps));

        if (frame < start || frame > end) {
          return null;
        }

        const fadeWindow = Math.min(10, Math.max(1, Math.floor((end - start) / 2)));
        const enterEnd = Math.min(end, start + fadeWindow);
        const exitStart = Math.max(start, end - fadeWindow);

        const opacity = interpolate(
          frame,
          [start, enterEnd, exitStart, end],
          [0, 1, 1, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        );

        const translateY = interpolate(
          frame,
          [start, enterEnd],
          [24, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        );

        return (
          <p
            key={`${index}-${line.text}`}
            style={{
              margin: 0,
              fontSize: 72,
              fontWeight: 700,
              textAlign: 'center',
              letterSpacing: '0.02em',
              lineHeight: 1.2,
              opacity,
              transform: `translateY(${translateY}px)`,
              textShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            }}
          >
            {line.text}
          </p>
        );
      })}
    </AbsoluteFill>
  );
};
