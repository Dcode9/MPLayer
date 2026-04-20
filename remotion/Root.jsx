import React from 'react';
import {Composition, staticFile} from 'remotion';
import {LyricsTemplateVideo} from './LyricsTemplateVideo';
import templateSongData from './template-song-data.json';

const FPS = 30;
const WIDTH_16X9 = 1920;
const HEIGHT_16X9 = 1080;
const WIDTH_4K = 3840;
const HEIGHT_4K = 2160;
const DEFAULT_DURATION_SECONDS = Number(templateSongData.song?.duration || 205);
const DEFAULT_DURATION_FRAMES = Math.max(1, Math.round(DEFAULT_DURATION_SECONDS * FPS));

const defaultPropsClean = {
  songData: templateSongData,
};

const defaultPropsLogo = {
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
        width={WIDTH_16X9}
        height={HEIGHT_16X9}
        defaultProps={defaultPropsLogo}
      />

      <Composition
        id="LyricsTemplateVideo16x9"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_16X9}
        height={HEIGHT_16X9}
        defaultProps={defaultPropsClean}
      />

      <Composition
        id="LyricsTemplateVideo16x9Logo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_16X9}
        height={HEIGHT_16X9}
        defaultProps={defaultPropsLogo}
      />

      <Composition
        id="LyricsTemplateVideo4k"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultPropsClean}
      />

      <Composition
        id="LyricsTemplateVideo4kLogo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultPropsLogo}
      />
    </>
  );
};
