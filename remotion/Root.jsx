import React from 'react';
import {Composition, staticFile} from 'remotion';
import {LyricsTemplateVideo} from './LyricsTemplateVideo';
import templateSongData from './template-song-data.json';

const FPS = 30;
const WIDTH_1080P = 1920;
const HEIGHT_1080P = 1080;
const DEFAULT_DURATION_SECONDS = Number(templateSongData.song?.duration || 205);
const DEFAULT_DURATION_FRAMES = Math.max(1, Math.round(DEFAULT_DURATION_SECONDS * FPS));

const defaultProps4k = {
  songData: templateSongData,
};

const defaultProps4kLogo = {
  songData: templateSongData,
  showAnimatedLogo: true,
  logoSrc: staticFile('assets/DTunes-transparent.svg'),
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="LyricsTemplateVideo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_1080P}
        height={HEIGHT_1080P}
        defaultProps={defaultProps4kLogo}
      />

      <Composition
        id="LyricsTemplateVideo4k"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_1080P}
        height={HEIGHT_1080P}
        defaultProps={defaultProps4k}
      />

      <Composition
        id="LyricsTemplateVideo4kLogo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_1080P}
        height={HEIGHT_1080P}
        defaultProps={defaultProps4kLogo}
      />

      {/* Backward-compatible aliases */}
      <Composition
        id="LyricsTemplateVideo16x9"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_1080P}
        height={HEIGHT_1080P}
        defaultProps={defaultProps4k}
      />

      <Composition
        id="LyricsTemplateVideo16x9Logo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_1080P}
        height={HEIGHT_1080P}
        defaultProps={defaultProps4kLogo}
      />
    </>
  );
};
