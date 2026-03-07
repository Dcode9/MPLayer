// ============================================
// PLAYER
// ============================================
const audio = document.getElementById('audio-el');
let isPlaybackPending = false; // Prevent multiple simultaneous playbacks

audio.onerror = (e) => {
    debugError("Playback error", e);
    errorHandler.show('Failed to play track. Trying next...');
    if(state.playing) { 
        state.playing = false; 
        ui.updatePlayBtn(); 
    }
    isPlaybackPending = false;
    // Auto-skip to next on error
    setTimeout(() => player.next(), 1000);
};

const player = {
    // Play any track object directly (JioSaavn)
    playDirect: async (track) => {
        if (!track) return;
        if (isPlaybackPending) {
            debugLog('Playback already pending, skipping');
            return;
        }
        
        isPlaybackPending = true;
        state.isLoading = true;
        ui.showLoading(true);
        
        try {
            let playUrl = track.url;
            
            // For JioSaavn tracks, ensure we have a streaming URL
            if (!jiosaavnAPI.isStreamingUrl(playUrl)) {
                debugLog('Fetching streaming URL for:', track.name);
                const songDetails = await jiosaavnAPI.getSong(track.id);
                if (songDetails && songDetails.url) {
                    playUrl = songDetails.url;
                    track.url = playUrl;
                    track.downloadUrls = songDetails.downloadUrls;
                }
            }
            
            if (!playUrl) {
                throw new Error('No streaming URL available');
            }
            
            // Stop current playback
            audio.pause();
            audio.currentTime = 0;
            
            // Set new source
            audio.src = playUrl;
            state.currentTrack = track;
            state.loaded = true;
            ui.enableControls();
            
            await audio.play();
            
            state.playing = true;
            ui.updatePlayBtn();
            
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
            if (!isAudioContextInitialized) setupAudioContext();
            
            mediaSessionManager.update(track);
            pipManager.drawCanvas(track);
            ui.updateMetadata(track);
            ui.updateLikeBtn();
            
            // Record play for recommendations
            recommendations.recordPlay(track);
            
            // Save last played track for session restore
            try {
                localStorage.setItem('lastPlayedTrack', JSON.stringify({
                    id: track.id, name: track.name, artist: track.artist,
                    img: track.img, source: track.source
                }));
            } catch(e) {}
            
            debugLog('Now playing:', track.name);
            
        } catch (error) {
            debugError('Play failed:', error);
            errorHandler.show('Unable to play this track');
            state.playing = false;
            ui.updatePlayBtn();
        } finally {
            isPlaybackPending = false;
            state.isLoading = false;
            ui.showLoading(false);
        }
    },
    
    // Play a JioSaavn track by ID
    playJioSaavnTrack: async (songId) => {
        const track = await jiosaavnAPI.getSong(songId);
        if (track) {
            player.playDirect(track);
        } else {
            errorHandler.show('Could not load track');
        }
    },
    
    togglePlay: () => {
        if(!state.loaded) { 
            // No track loaded yet - show feedback
            errorHandler.show('Search for a song to start playing');
            return; 
        }
        if(state.playing) { 
            audio.pause(); 
            state.playing = false; 
            document.body.classList.remove('playing'); 
            document.body.classList.add('paused');
        } else { 
            audio.play().catch(e => {
                debugError('Resume play failed:', e);
            }); 
            state.playing = true; 
            if (audioContext && audioContext.state === 'suspended') audioContext.resume();
            if (!isAudioContextInitialized) setupAudioContext();
            document.body.classList.remove('paused'); 
            document.body.classList.add('playing');
        }
        ui.updatePlayBtn();
        if(navigator.mediaSession) navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
    },
    
    next: () => { 
        if(state.queue.length === 0) return;
        
        let nextIdx;
        
        if(state.shuffle) {
            // Use weighted shuffle for better recommendations
            nextIdx = recommendations.getWeightedShuffleIndex(state.queue);
        } else {
            nextIdx = state.idx + 1;
            if(nextIdx >= state.queue.length) nextIdx = 0;
        }
        
        const nextTrack = state.queue[nextIdx];
        if (nextTrack) {
            state.idx = nextIdx;
            player.playDirect(nextTrack);
        }
    },
    
    prev: () => { 
        if(state.queue.length === 0) return;
        
        let prevIdx = state.idx - 1;
        if(prevIdx < 0) prevIdx = state.queue.length - 1;
        
        const prevTrack = state.queue[prevIdx];
        if (prevTrack) {
            state.idx = prevIdx;
            player.playDirect(prevTrack);
        }
    },
    
    setVolume: (val) => { audio.volume = Math.max(0, Math.min(1, val)); },
    
    toggleLike: () => {
        if(!state.currentTrack) return;
        const id = state.currentTrack.id;
        const index = state.likedIds.indexOf(id);
        
        if(index === -1) {
            // Add to liked (limit to 500 songs)
            if (state.likedSongs.length >= 500) {
                // Remove oldest liked song
                state.likedSongs.shift();
                state.likedIds.shift();
            }
            state.likedIds.push(id);
            // Also store the full song object (avoid duplicates)
            if (!state.likedSongs.find(s => s.id === id)) {
                state.likedSongs.push(state.currentTrack);
            }
        } else {
            // Remove from liked
            state.likedIds.splice(index, 1);
            state.likedSongs = state.likedSongs.filter(s => s.id !== id);
        }
        
        try {
            localStorage.setItem('likedIds', JSON.stringify(state.likedIds));
            localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
        } catch(e) {
            errorHandler.show('Unable to save liked songs (storage full)');
        }
        ui.updateLikeBtn();
        ui.renderLikedSongs();
    },
    
    toggleShuffle: () => {
        state.shuffle = !state.shuffle;
        const btn = document.getElementById('btn-shuffle');
        if(state.shuffle) btn.classList.add('active-state'); 
        else btn.classList.remove('active-state');
        debugLog('Shuffle:', state.shuffle ? 'ON (weighted)' : 'OFF');
    },
    
    toggleRepeat: () => {
        // 0: none, 1: all, 2: one
        state.repeat = (state.repeat + 1) % 3;
        const btn = document.getElementById('btn-repeat');
        if(state.repeat === 0) btn.classList.remove('active-state');
        else btn.classList.add('active-state');
        audio.loop = (state.repeat === 2);
        debugLog('Repeat mode:', state.repeat);
    },
    
    // Set queue from any source
    setQueue: (tracks, startIndex = 0) => {
        if (!tracks || tracks.length === 0) return;
        state.queue = [...tracks];
        if (startIndex >= 0 && startIndex < tracks.length) {
            state.idx = startIndex;
            player.playDirect(tracks[startIndex]);
        } else {
            state.idx = 0;
            player.playDirect(tracks[0]);
        }
    }
};
