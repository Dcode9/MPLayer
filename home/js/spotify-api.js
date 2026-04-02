// ============================================
// SPOTIFY API SERVICE
// Handles all Spotify Web API interactions
// ============================================

const spotifyAPI = {
    baseUrl: 'https://api.spotify.com/v1',

    // Make authenticated API request with retry
    fetchWithAuth: async (endpoint, options = {}, retries = 3) => {
        const token = spotifyAuth.getAccessToken();

        if (!token) {
            throw new Error('Not authenticated with Spotify');
        }

        for (let i = 0; i < retries; i++) {
            try {
                const url = endpoint.startsWith('http') ? endpoint : `${spotifyAPI.baseUrl}${endpoint}`;
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        ...options.headers,
                    },
                });

                if (response.status === 401) {
                    // Token expired
                    spotifyAuth.logout();
                    throw new Error('Spotify session expired. Please sign in again.');
                }

                if (response.status === 429) {
                    // Rate limited
                    const retryAfter = response.headers.get('Retry-After') || 1;
                    debugLog(`Spotify: Rate limited, retrying after ${retryAfter}s`);
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                    continue;
                }

                if (!response.ok) {
                    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                if (i === retries - 1) throw error;
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
            }
        }
    },

    // Get current user's profile
    getCurrentUser: async () => {
        try {
            const data = await spotifyAPI.fetchWithAuth('/me');
            return {
                id: data.id,
                name: data.display_name,
                email: data.email,
                img: data.images?.[0]?.url || '',
                followers: data.followers?.total || 0,
                country: data.country,
            };
        } catch (error) {
            errorHandler.handleApiError(error, 'Spotify getCurrentUser');
            return null;
        }
    },

    // Get all user playlists (with pagination)
    getAllPlaylists: async () => {
        try {
            const playlists = [];
            let url = '/me/playlists?limit=50';

            debugLog('Starting to fetch playlists from Spotify...');

            while (url) {
                debugLog('Fetching playlist page:', url);
                const data = await spotifyAPI.fetchWithAuth(url);

                if (!data || !data.items) {
                    debugError('Invalid response from Spotify playlists API:', data);
                    throw new Error('Invalid response from Spotify playlists API');
                }

                debugLog('Spotify API response for playlists:', data);
                debugLog('Number of playlists in this page:', data.items.length);
                debugLog('First playlist raw data:', data.items?.[0]);

                const normalized = data.items.map(spotifyAPI.normalizePlaylist);
                playlists.push(...normalized);

                // Check for next page
                url = data.next;
                if (url) {
                    debugLog('More playlists to fetch, continuing...');
                }
            }

            debugLog(`Spotify: Successfully fetched ${playlists.length} playlists`);
            if (playlists.length > 0) {
                debugLog('First normalized playlist:', playlists[0]);
            } else {
                debugLog('No playlists found in Spotify account');
            }
            return playlists;
        } catch (error) {
            debugError('Error in getAllPlaylists:', error);
            debugError('Error message:', error.message);
            debugError('Error stack:', error.stack);
            errorHandler.handleApiError(error, 'Spotify getAllPlaylists');
            throw error; // Re-throw to let caller handle it
        }
    },

    // Get playlist tracks
    getPlaylistTracks: async (playlistId) => {
        try {
            const tracks = [];
            let url = `/playlists/${playlistId}/tracks?limit=100`;

            while (url) {
                const data = await spotifyAPI.fetchWithAuth(url);

                // Filter out null tracks (deleted/unavailable songs)
                const validTracks = data.items
                    .filter(item => item.track && item.track.id)
                    .map(item => spotifyAPI.normalizeTrack(item.track));

                tracks.push(...validTracks);

                // Check for next page
                url = data.next;
            }

            debugLog(`Spotify: Fetched ${tracks.length} tracks from playlist ${playlistId}`);
            return tracks;
        } catch (error) {
            errorHandler.handleApiError(error, 'Spotify getPlaylistTracks');
            return [];
        }
    },

    // Get user's saved tracks (liked songs)
    getSavedTracks: async () => {
        try {
            const tracks = [];
            let url = '/me/tracks?limit=50';

            while (url) {
                const data = await spotifyAPI.fetchWithAuth(url);

                const validTracks = data.items
                    .filter(item => item.track && item.track.id)
                    .map(item => spotifyAPI.normalizeTrack(item.track));

                tracks.push(...validTracks);

                // Check for next page
                url = data.next;
            }

            debugLog(`Spotify: Fetched ${tracks.length} saved tracks`);
            return tracks;
        } catch (error) {
            errorHandler.handleApiError(error, 'Spotify getSavedTracks');
            return [];
        }
    },

    // Search tracks on Spotify (for matching with JioSaavn)
    searchTracks: async (query, limit = 20) => {
        try {
            const data = await spotifyAPI.fetchWithAuth(
                `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
            );
            return data.tracks.items.map(spotifyAPI.normalizeTrack);
        } catch (error) {
            errorHandler.handleApiError(error, 'Spotify searchTracks');
            return [];
        }
    },

    // Normalize playlist object
    normalizePlaylist: (playlist) => {
        if (!playlist) return null;

        // Debug log to see the actual structure
        if (DEBUG) {
            debugLog('Normalizing playlist:', playlist.name);
            debugLog('Tracks object:', playlist.tracks);
            debugLog('Track count from tracks.total:', playlist.tracks?.total);
        }

        // Spotify API returns tracks as an object with 'href' and 'total' properties
        const trackCount = playlist.tracks?.total || playlist.track_count || 0;

        return {
            id: playlist.id,
            name: playlist.name,
            description: playlist.description || '',
            img: playlist.images?.[0]?.url || 'https://placehold.co/300/333/fff?text=Playlist',
            trackCount: trackCount,
            owner: playlist.owner?.display_name || 'Unknown',
            isPublic: playlist.public,
            isCollaborative: playlist.collaborative,
            source: 'spotify',
        };
    },

    // Normalize track object to match app's format
    normalizeTrack: (track) => {
        if (!track) return null;
        return {
            id: `spotify_${track.id}`, // Prefix to distinguish from JioSaavn
            spotifyId: track.id, // Keep original ID for Spotify operations
            name: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            artistIds: track.artists.map(a => a.id),
            album: track.album.name,
            albumId: track.album.id,
            img: track.album.images?.[0]?.url || 'https://placehold.co/300/333/fff?text=Music',
            url: track.preview_url, // Spotify only provides 30s previews for web API
            duration: Math.floor(track.duration_ms / 1000),
            year: track.album.release_date?.substring(0, 4) || '',
            source: 'spotify',
            isPreview: true, // Mark as preview since we can't stream full tracks
            spotifyUri: track.uri, // Keep URI for potential future use
            externalUrl: track.external_urls?.spotify || '',
        };
    },

    // Try to find matching JioSaavn track for a Spotify track
    findJioSaavnMatch: async (spotifyTrack) => {
        try {
            // Search JioSaavn with track name and artist
            const query = `${spotifyTrack.name} ${spotifyTrack.artist}`;
            const results = await jiosaavnAPI.searchSongs(query, 5);

            if (results.length === 0) {
                return null;
            }

            // Simple matching: return the first result
            // Could be improved with fuzzy matching or similarity scoring
            return results[0];
        } catch (error) {
            debugLog('Error finding JioSaavn match:', error);
            return null;
        }
    },

    // Convert Spotify playlist to playable JioSaavn tracks
    convertPlaylistToJioSaavn: async (spotifyPlaylistId, onProgress) => {
        try {
            debugLog(`Converting Spotify playlist ${spotifyPlaylistId} to JioSaavn`);
            const spotifyTracks = await spotifyAPI.getPlaylistTracks(spotifyPlaylistId);
            debugLog(`Retrieved ${spotifyTracks.length} tracks from Spotify playlist`);

            const jiosaavnTracks = [];
            let matched = 0;

            for (let i = 0; i < spotifyTracks.length; i++) {
                const spotifyTrack = spotifyTracks[i];
                debugLog(`Processing track ${i + 1}/${spotifyTracks.length}: ${spotifyTrack.name} - ${spotifyTrack.artist}`);

                // Report progress
                if (onProgress) {
                    onProgress({
                        current: i + 1,
                        total: spotifyTracks.length,
                        matched: matched,
                    });
                }

                // Try to find matching JioSaavn track
                const jiosaavnTrack = await spotifyAPI.findJioSaavnMatch(spotifyTrack);

                if (jiosaavnTrack) {
                    debugLog(`✓ Matched: ${jiosaavnTrack.name}`);
                    jiosaavnTracks.push(jiosaavnTrack);
                    matched++;
                } else {
                    debugLog(`✗ No match found for: ${spotifyTrack.name}`);
                }

                // Add small delay to avoid overwhelming the API
                await new Promise(r => setTimeout(r, 100));
            }

            const result = {
                tracks: jiosaavnTracks,
                total: spotifyTracks.length,
                matched: matched,
            };

            debugLog(`Conversion complete: ${matched}/${spotifyTracks.length} tracks matched (${Math.round(matched/spotifyTracks.length*100)}%)`);
            return result;
        } catch (error) {
            debugError('Error in convertPlaylistToJioSaavn:', error);
            errorHandler.handleApiError(error, 'Spotify convertPlaylistToJioSaavn');
            return { tracks: [], total: 0, matched: 0 };
        }
    },
};
