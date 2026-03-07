// ============================================
// ROUTER
// ============================================
const router = {
    go: (view) => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        const target = document.getElementById('view-'+view);
        if(target) target.classList.add('active');
        
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        const btns = document.querySelectorAll('.nav-btn');
        
        // Map views to button indices
        const viewMap = { 'home': 0, 'trending': 1, 'albums': 2, 'playlists': 3, 'album-detail': 2, 'search': -1 };
        const btnIdx = viewMap[view];
        if (btnIdx >= 0 && btns[btnIdx]) {
            btns[btnIdx].classList.add('active');
        }
        
        // Load data for specific views
        if (view === 'trending' && !trendingView.loaded) {
            trendingView.load();
        }
        if (view === 'albums' && !albumsView.loaded) {
            albumsView.load();
        }
        if (view === 'playlists') {
            ui.renderLikedSongs();
            ui.renderQueue();
        }
    }
};

// ============================================
// HOME VIEW
// ============================================
const homeView = {
    loaded: false,
    
    load: async () => {
        debugLog('Loading home view...');
        
        const quickPicks = document.getElementById('quick-picks-grid');
        const recentGrid = document.getElementById('recent-grid');
        
        // Show skeleton loading
        if (quickPicks) {
            quickPicks.innerHTML = Array(8).fill('<div class="scroll-card skeleton h-[220px] rounded-xl"></div>').join('');
        }
        
        try {
            // Fetch trending songs
            const trending = await jiosaavnAPI.getTrending();
            
            // Quick picks: mix trending + play history artists, deduplicate, show 16
            if (quickPicks) {
                const seenIds = new Set();
                let picks = [];
                
                // Add trending songs first
                for (const song of trending) {
                    if (song && !seenIds.has(song.id)) {
                        seenIds.add(song.id);
                        picks.push(song);
                    }
                }
                
                // If user has play history, fetch related songs
                if (state.playHistory.length > 0) {
                    const uniqueArtists = [...new Set(state.playHistory.slice(0, 10).map(h => h.artist.split(',')[0].trim()))].slice(0, 3);
                    const relatedPromises = uniqueArtists.map(a => jiosaavnAPI.searchSongs(a, 6));
                    const relatedResults = await Promise.all(relatedPromises);
                    for (const songs of relatedResults) {
                        for (const song of songs) {
                            if (song && !seenIds.has(song.id)) {
                                seenIds.add(song.id);
                                picks.push(song);
                            }
                        }
                    }
                }
                
                picks = picks.slice(0, 16);
                quickPicks.innerHTML = picks.map(song => ui.createScrollCard(song)).join('');
            }
            
            // Recent plays with album art
            if (recentGrid && state.playHistory.length > 0) {
                const seenIds = new Set();
                const recentTracks = [];
                for (const track of state.playHistory) {
                    if (!seenIds.has(track.id) && recentTracks.length < 16) {
                        seenIds.add(track.id);
                        recentTracks.push(track);
                    }
                }
                recentGrid.innerHTML = recentTracks.map(track => {
                    const storeId = songStore.add(track);
                    const imgUrl = track.img || 'https://placehold.co/300/333/fff?text=Music';
                    return `
                    <div class="scroll-card bg-white/5 hover:bg-white/10 p-3 rounded-xl cursor-pointer transition group" onclick="playSongById('${storeId}')">
                        <div class="relative aspect-square rounded-lg overflow-hidden mb-2 bg-gray-800">
                            <img src="${imgUrl}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.src='https://placehold.co/300/333/fff?text=Music'">
                            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                                <span class="bg-green-500 text-black p-2 rounded-full shadow-xl"><svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
                            </div>
                        </div>
                        <h3 class="font-bold text-white text-sm truncate">${searchManager.escapeHtml(track.name)}</h3>
                        <p class="text-xs text-gray-400 truncate">${searchManager.escapeHtml(track.artist)}</p>
                    </div>`;
                }).join('');
            } else if (recentGrid) {
                recentGrid.innerHTML = '<p class="text-gray-500">No recent plays yet. Start exploring!</p>';
            }
            
            homeView.loaded = true;
        } catch (error) {
            debugError('Home view load error:', error);
            if (quickPicks) {
                quickPicks.innerHTML = '<p class="text-gray-400">Unable to load content. Please try again.</p>';
            }
        }
    }
};

// ============================================
// TRENDING VIEW
// ============================================
const trendingView = {
    loaded: false,
    currentTab: 'songs',
    data: { songs: [], albums: [], artists: [] },
    
    load: async () => {
        debugLog('Loading trending view...');
        await trendingView.switchTab('songs');
        trendingView.loaded = true;
    },
    
    switchTab: async (tab) => {
        trendingView.currentTab = tab;
        
        // Update tab pills
        document.querySelectorAll('#trending-tabs .tab-pill').forEach(pill => {
            pill.classList.remove('active');
            if (pill.textContent.toLowerCase() === tab) {
                pill.classList.add('active');
            }
        });
        
        const content = document.getElementById('trending-content');
        content.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                ${Array(8).fill('<div class="skeleton h-48 w-full rounded-xl"></div>').join('')}
            </div>
        `;
        
        try {
            let items = [];
            
            if (tab === 'songs') {
                items = await jiosaavnAPI.getTrending();
                content.innerHTML = items.length > 0 
                    ? `<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">${items.map((s, i) => ui.createJioSaavnCard(s, i)).join('')}</div>`
                    : '<p class="text-gray-400">No trending songs available</p>';
            } else if (tab === 'albums') {
                items = await jiosaavnAPI.getTopAlbums();
                content.innerHTML = items.length > 0
                    ? `<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">${items.map(a => ui.createAlbumCard(a)).join('')}</div>`
                    : '<p class="text-gray-400">No albums available</p>';
            } else if (tab === 'artists') {
                // Search for popular artists
                items = await jiosaavnAPI.searchArtists('popular indian artists', 20);
                content.innerHTML = items.length > 0
                    ? `<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">${items.map(a => ui.createArtistCard(a)).join('')}</div>`
                    : '<p class="text-gray-400">No artists available</p>';
            }
        } catch (error) {
            debugError('Trending view error:', error);
            content.innerHTML = '<p class="text-gray-400">Unable to load content</p>';
        }
    }
};

// ============================================
// ALBUMS VIEW
// ============================================
const albumsView = {
    loaded: false,
    
    load: async () => {
        debugLog('Loading albums view...');
        const grid = document.getElementById('albums-grid');
        
        grid.innerHTML = Array(8).fill('<div class="skeleton h-48 w-full rounded-xl"></div>').join('');
        
        try {
            const albums = await jiosaavnAPI.getTopAlbums();
            grid.innerHTML = albums.length > 0
                ? albums.map(a => ui.createAlbumCard(a)).join('')
                : '<p class="text-gray-400 col-span-full">No albums available</p>';
            albumsView.loaded = true;
        } catch (error) {
            debugError('Albums view error:', error);
            grid.innerHTML = '<p class="text-gray-400 col-span-full">Unable to load albums</p>';
        }
    },
    
    openAlbum: async (albumId) => {
        debugLog('Opening album:', albumId);
        router.go('album-detail');
        
        const header = document.getElementById('album-detail-header');
        const tracks = document.getElementById('album-detail-tracks');
        
        header.innerHTML = '<div class="skeleton h-48 w-48 rounded-xl"></div>';
        tracks.innerHTML = Array(5).fill('<div class="skeleton h-16 w-full rounded-lg"></div>').join('');
        
        try {
            const album = await jiosaavnAPI.getAlbum(albumId);
            
            if (!album) {
                tracks.innerHTML = '<p class="text-gray-400">Album not found</p>';
                return;
            }
            
            header.innerHTML = `
                <img src="${album.img}" class="w-48 h-48 rounded-xl shadow-2xl" onerror="this.src='https://placehold.co/200/333/fff?text=Album'">
                <div>
                    <span class="source-badge jiosaavn mb-2 inline-block">JioSaavn Album</span>
                    <h1 class="text-4xl font-bold text-white">${searchManager.escapeHtml(album.name)}</h1>
                    <p class="text-gray-400 mt-2">${searchManager.escapeHtml(album.artist)}</p>
                    <p class="text-gray-500 text-sm mt-1">${album.year || ''} • ${album.songCount || album.songs.length} songs</p>
                    <button onclick="albumsView.playAll('${albumId}')" class="mt-4 bg-green-500 hover:bg-green-600 text-black font-bold py-2 px-6 rounded-full transition">
                        Play All
                    </button>
                </div>
            `;
            
            if (album.songs && album.songs.length > 0) {
                // Store songs in songStore for safe click handling
                tracks.innerHTML = album.songs.map((song, i) => {
                    const storeId = songStore.add(song);
                    const duration = song.duration || 0;
                    const mins = Math.floor(duration / 60);
                    const secs = (duration % 60).toString().padStart(2, '0');
                    return `
                    <div class="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition group" onclick="playSongById('${storeId}')">
                        <span class="text-gray-500 w-6 text-center font-mono text-sm">${i + 1}</span>
                        <img src="${song.img}" class="w-10 h-10 rounded object-cover" onerror="this.src='https://placehold.co/40/333/fff?text=M'">
                        <div class="flex-1 overflow-hidden">
                            <h4 class="text-white font-medium truncate">${searchManager.escapeHtml(song.name)}</h4>
                            <p class="text-gray-400 text-xs truncate">${searchManager.escapeHtml(song.artist)}</p>
                        </div>
                        <span class="text-gray-500 text-xs">${mins}:${secs}</span>
                    </div>
                `;
                }).join('');
                
                // Store album songs for play all
                albumsView.currentAlbumSongs = album.songs;
            } else {
                tracks.innerHTML = '<p class="text-gray-400">No tracks available</p>';
            }
        } catch (error) {
            debugError('Album detail error:', error);
            tracks.innerHTML = '<p class="text-gray-400">Unable to load album</p>';
        }
    },
    
    currentAlbumSongs: [],
    
    playAll: (albumId) => {
        if (albumsView.currentAlbumSongs.length > 0) {
            player.setQueue(albumsView.currentAlbumSongs, 0);
        } else {
            errorHandler.show('No tracks to play');
        }
    }
};
