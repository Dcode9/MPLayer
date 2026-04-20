import React from 'react';
import {Composition, staticFile} from 'remotion';
import {LyricsTemplateVideo} from './LyricsTemplateVideo';
import templateSongData from './template-song-data.json';

const FPS = 30;
const WIDTH_4K = 3840;
const HEIGHT_4K = 2160;
const DEFAULT_DURATION_SECONDS = Number(templateSongData.song?.duration || 205);
const DEFAULT_DURATION_FRAMES = Math.max(1, Math.round(DEFAULT_DURATION_SECONDS * FPS));

const defaultProps16x9 = {
  songData: templateSongData,
};

const defaultProps16x9Logo = {
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
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultProps16x9Logo}
      />

      <Composition
        id="LyricsTemplateVideo16x9"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultProps16x9}
      />

      <Composition
        id="LyricsTemplateVideo16x9Logo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultProps16x9Logo}
      />

      <Composition
        id="LyricsTemplateVideo4K"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultProps16x9}
      />

      <Composition
        id="LyricsTemplateVideo4KLogo"
        component={LyricsTemplateVideo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH_4K}
        height={HEIGHT_4K}
        defaultProps={defaultProps16x9Logo}
      />
    </>
  );
};
