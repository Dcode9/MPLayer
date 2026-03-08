// ============================================
// JIOSAAVN API SERVICE
// ============================================
const jiosaavnAPI = {
    // Retry wrapper for API calls with automatic API endpoint switching
    fetchWithRetry: async (url, retries = API_RETRY_COUNT) => {
        let apiSwitchAttempts = JIOSAAVN_API_ENDPOINTS.length;
        
        while (apiSwitchAttempts > 0) {
            for (let i = 0; i < retries; i++) {
                try {
                    // Update URL with current API endpoint
                    const currentUrl = url.replace(/https:\/\/[^\/]+\/api/, JIOSAAVN_API);
                    debugLog(`Fetching: ${currentUrl} (attempt ${i + 1})`);
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
                    
                    const response = await fetch(currentUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const data = await response.json();
                    if (data.success === false) {
                        throw new Error(data.message || 'API returned error');
                    }
                    return data;
                } catch (error) {
                    debugLog(`Attempt ${i + 1} failed:`, error.message);
                    
                    // Check if it's a network error that suggests we should try another API
                    const isNetworkError = error.name === 'TypeError' || 
                                           error.name === 'AbortError' ||
                                           error.message.includes('Failed to fetch') ||
                                           error.message.includes('NetworkError') ||
                                           error.message.includes('ERR_NAME_NOT_RESOLVED');
                    
                    if (isNetworkError && i === retries - 1) {
                        // Try switching to next API endpoint
                        if (switchToNextApi()) {
                            apiSwitchAttempts--;
                            debugLog('Trying next API endpoint...');
                            break; // Break retry loop, try with new API
                        }
                    }
                    
                    if (i === retries - 1) throw error;
                    await new Promise(r => setTimeout(r, API_RETRY_DELAY * (i + 1)));
                }
            }
            
            // If we get here after switching API, continue the while loop
            if (apiSwitchAttempts > 0 && apiSwitchAttempts < JIOSAAVN_API_ENDPOINTS.length) {
                continue;
            }
            break;
        }
    },

    // Search songs
    searchSongs: async (query, limit = 20) => {
        if (!query || query.trim().length < 2) return [];
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`
            );
            return (data.data?.results || []).map(jiosaavnAPI.normalizeSong);
        } catch (error) {
            errorHandler.handleApiError(error, 'searchSongs');
            return [];
        }
    },

    // Search albums
    searchAlbums: async (query, limit = 10) => {
        if (!query || query.trim().length < 2) return [];
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/search/albums?query=${encodeURIComponent(query)}&limit=${limit}`
            );
            return (data.data?.results || []).map(jiosaavnAPI.normalizeAlbum);
        } catch (error) {
            errorHandler.handleApiError(error, 'searchAlbums');
            return [];
        }
    },

    // Search artists
    searchArtists: async (query, limit = 10) => {
        if (!query || query.trim().length < 2) return [];
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/search/artists?query=${encodeURIComponent(query)}&limit=${limit}`
            );
            return (data.data?.results || []).map(jiosaavnAPI.normalizeArtist);
        } catch (error) {
            errorHandler.handleApiError(error, 'searchArtists');
            return [];
        }
    },

    // Combined search
    search: async (query) => {
        if (!query || query.trim().length < 2) return { songs: [], albums: [], artists: [] };
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/search?query=${encodeURIComponent(query)}`
            );
            return {
                songs: (data.data?.songs?.results || []).map(jiosaavnAPI.normalizeSong),
                albums: (data.data?.albums?.results || []).map(jiosaavnAPI.normalizeAlbum),
                artists: (data.data?.artists?.results || []).map(jiosaavnAPI.normalizeArtist)
            };
        } catch (error) {
            errorHandler.handleApiError(error, 'search');
            return { songs: [], albums: [], artists: [] };
        }
    },

    // Get song by ID
    getSong: async (id) => {
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/songs/${id}`
            );
            if (data.data && data.data.length > 0) {
                return jiosaavnAPI.normalizeSong(data.data[0]);
            }
            return null;
        } catch (error) {
            errorHandler.handleApiError(error, 'getSong');
            return null;
        }
    },

    // Get album by ID
    getAlbum: async (id) => {
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/albums?id=${id}`
            );
            const album = data.data;
            if (!album) return null;
            
            return {
                id: album.id,
                name: album.name,
                artist: album.artists?.primary?.map(a => a.name).join(', ') || 'Unknown',
                img: album.image?.[2]?.url || album.image?.[1]?.url || album.image?.[0]?.url,
                year: album.year,
                songCount: album.songCount,
                songs: (album.songs || []).map(jiosaavnAPI.normalizeSong),
                source: 'jiosaavn'
            };
        } catch (error) {
            errorHandler.handleApiError(error, 'getAlbum');
            return null;
        }
    },

    // Get trending/home modules
    getHomepage: async () => {
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/modules?language=hindi,english`
            );
            return data.data || {};
        } catch (error) {
            errorHandler.handleApiError(error, 'getHomepage');
            return {};
        }
    },

    // Get trending songs
    getTrending: async () => {
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/playlists?id=110858205` // Trending playlist ID
            );
            if (data.data?.songs) {
                return data.data.songs.map(jiosaavnAPI.normalizeSong);
            }
            return [];
        } catch (error) {
            // Fallback to search for trending
            debugLog('Trending fallback to search');
            return jiosaavnAPI.searchSongs('trending hindi songs', 20);
        }
    },

    // Get top albums
    getTopAlbums: async () => {
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/search/albums?query=new releases&limit=20`
            );
            return (data.data?.results || []).map(jiosaavnAPI.normalizeAlbum);
        } catch (error) {
            errorHandler.handleApiError(error, 'getTopAlbums');
            return [];
        }
    },

    // Get artist details
    getArtist: async (id) => {
        try {
            const data = await jiosaavnAPI.fetchWithRetry(
                `${JIOSAAVN_API}/artists/${id}`
            );
            return data.data;
        } catch (error) {
            errorHandler.handleApiError(error, 'getArtist');
            return null;
        }
    },

    // Normalize song object from API response
    normalizeSong: (song) => {
        if (!song) return null;
        const downloadUrls = song.downloadUrl || [];
        return {
            id: song.id,
            name: song.name || song.title || 'Unknown',
            artist: song.artists?.primary?.map(a => a.name).join(', ') || 
                    song.primaryArtists || 
                    song.artist || 'Unknown Artist',
            artistIds: song.artists?.primary?.map(a => a.id) || [],
            album: song.album?.name || '',
            albumId: song.album?.id || '',
            img: song.image?.[2]?.url || song.image?.[1]?.url || song.image?.[0]?.url || 
                 'https://placehold.co/300/333/fff?text=Music',
            url: preferences.getQualityUrl(downloadUrls),
            downloadUrls: downloadUrls,
            duration: song.duration || 0,
            year: song.year || '',
            language: song.language || '',
            source: 'jiosaavn',
            hasLyrics: song.hasLyrics || false
        };
    },

    // Normalize album object
    normalizeAlbum: (album) => {
        if (!album) return null;
        return {
            id: album.id,
            name: album.name || album.title || 'Unknown Album',
            artist: album.artists?.primary?.map(a => a.name).join(', ') || 
                    album.artist || 'Various Artists',
            img: album.image?.[2]?.url || album.image?.[1]?.url || album.image?.[0]?.url ||
                 'https://placehold.co/300/333/fff?text=Album',
            year: album.year || '',
            songCount: album.songCount || 0,
            source: 'jiosaavn'
        };
    },

    // Normalize artist object
    normalizeArtist: (artist) => {
        if (!artist) return null;
        return {
            id: artist.id,
            name: artist.name || artist.title || 'Unknown Artist',
            img: artist.image?.[2]?.url || artist.image?.[1]?.url || artist.image?.[0]?.url ||
                 'https://placehold.co/300/333/fff?text=Artist',
            followerCount: artist.followerCount || 0,
            source: 'jiosaavn'
        };
    },

    // Check if URL is a page URL vs streaming URL
    isStreamingUrl: (url) => {
        if (!url) return false;
        return url.includes('.mp3') || 
               url.includes('.m4a') || 
               url.includes('.aac') ||
               url.includes('aac.saavncdn.com') ||
               url.includes('mp3.saavncdn.com') ||
               url.includes('raw.githubusercontent.com');
    }
};

// ============================================
// ADVANCED SHUFFLE & RECOMMENDATIONS
// ============================================
const recommendations = {
    // Update play counts for artists
    recordPlay: (track) => {
        if (!track) return;
        
        const historyEntry = {
            id: track.id,
            name: track.name,
            artist: track.artist,
            artistIds: track.artistIds || [],
            img: track.img || '',
            timestamp: Date.now()
        };
        state.playHistory.unshift(historyEntry);
        state.playHistory = state.playHistory.slice(0, 100);
        localStorage.setItem('playHistory', JSON.stringify(state.playHistory));
        
        const artists = track.artist ? track.artist.split(',').map(a => a.trim()) : [];
        artists.forEach(artist => {
            state.artistPlayCounts[artist] = (state.artistPlayCounts[artist] || 0) + 1;
        });
        
        // Prune artistPlayCounts if too large
        const artistKeys = Object.keys(state.artistPlayCounts);
        if (artistKeys.length > 500) {
            const sorted = artistKeys.sort((a, b) => state.artistPlayCounts[b] - state.artistPlayCounts[a]);
            const toRemove = sorted.slice(300);
            toRemove.forEach(key => delete state.artistPlayCounts[key]);
        }
        
        localStorage.setItem('artistPlayCounts', JSON.stringify(state.artistPlayCounts));
    },

    // Get weighted random index based on artist preferences
    getWeightedShuffleIndex: (queue) => {
        if (!queue || queue.length === 0) return -1;
        if (queue.length === 1) return 0;
        
        const weights = queue.map((track, idx) => {
            let weight = 1;
            const artists = track.artist ? track.artist.split(',').map(a => a.trim()) : [];
            artists.forEach(artist => {
                weight += (state.artistPlayCounts[artist] || 0) * 0.5;
            });
            
            const recentlyPlayed = state.playHistory.slice(0, 10).map(h => h.id);
            if (recentlyPlayed.includes(track.id)) {
                weight *= 0.2;
            }
            
            weight *= (0.8 + Math.random() * 0.4);
            return { idx, weight };
        });
        
        weights.sort((a, b) => b.weight - a.weight);
        const topCandidates = weights.slice(0, Math.min(5, weights.length));
        const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
        
        return selected.idx;
    },

    // Get recommendations based on current track
    getRelatedTracks: async (track) => {
        if (!track) return [];
        const artistQuery = track.artist.split(',')[0].trim();
        const related = await jiosaavnAPI.searchSongs(artistQuery, 10);
        return related.filter(t => t.id !== track.id);
    }
};
