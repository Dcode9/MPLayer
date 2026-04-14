import React from 'react';
import {Composition} from 'remotion';
import {LyricsVideo} from './LyricsVideo';

const defaultProps = {
  lines: [
    {text: 'Hello world', start: 0, end: 2},
    {text: 'This is a test video', start: 2, end: 5},
  ],
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
    />
  );
};
