// ============================================
// SEARCH MANAGER
// ============================================
const searchManager = {
    lastResults: null,
    
    init: () => {
        // Initialize both desktop and mobile search inputs
        searchManager._initInput('search-input', 'search-results');
        searchManager._initInput('mobile-search-input', 'mobile-search-results');
        
        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                document.getElementById('search-results')?.classList.remove('active');
                document.getElementById('mobile-search-results')?.classList.remove('active');
            }
        });
    },
    
    _initInput: (inputId, resultsId) => {
        const input = document.getElementById(inputId);
        const results = document.getElementById(resultsId);
        
        if (!input || !results) return;
        
        input.addEventListener('input', (e) => {
            clearTimeout(state.searchDebounce);
            const query = e.target.value.trim();
            
            if (query.length < 2) {
                results.classList.remove('active');
                return;
            }
            
            state.searchDebounce = setTimeout(() => {
                searchManager._searchDropdown(query, results);
            }, 300);
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = input.value.trim();
                if (query.length >= 2) {
                    results.classList.remove('active');
                    searchManager.searchMain(query);
                }
            }
        });
        
        input.addEventListener('focus', () => {
            if (input.value.trim().length >= 2) {
                results.classList.add('active');
            }
        });
    },
    
    _searchDropdown: async (query, results) => {
        results.innerHTML = '<div class="p-4 text-center"><div class="loading-spinner"></div></div>';
        results.classList.add('active');
        
        const data = await jiosaavnAPI.search(query);
        
        let html = '';
        
        if (data.songs.length > 0) {
            html += '<div class="search-section-title">Songs</div>';
            html += data.songs.slice(0, 5).map(song => {
                const storeId = songStore.add(song);
                return `
                <div class="search-result-item" onclick="playSongById('${storeId}')">
                    <img src="${song.img}" alt="" onerror="this.src='https://placehold.co/48/333/fff?text=M'">
                    <div class="flex-1 min-w-0">
                        <div class="text-white font-medium truncate">${searchManager.escapeHtml(song.name)}</div>
                        <div class="text-gray-400 text-sm truncate">${searchManager.escapeHtml(song.artist)}</div>
                    </div>
                </div>
            `;
            }).join('');
        }
        
        if (data.albums.length > 0) {
            html += '<div class="search-section-title">Albums</div>';
            html += data.albums.slice(0, 3).map(album => `
                <div class="search-result-item" onclick="openAlbumById('${searchManager.escapeHtml(album.id)}')">
                    <img src="${album.img}" alt="" onerror="this.src='https://placehold.co/48/333/fff?text=A'">
                    <div class="flex-1 min-w-0">
                        <div class="text-white font-medium truncate">${searchManager.escapeHtml(album.name)}</div>
                        <div class="text-gray-400 text-sm truncate">${searchManager.escapeHtml(album.artist)}</div>
                    </div>
                </div>
            `).join('');
        }
        
        if (data.artists.length > 0) {
            html += '<div class="search-section-title">Artists</div>';
            html += data.artists.slice(0, 3).map(artist => {
                const safeName = encodeURIComponent(artist.name || '');
                return `
                <div class="search-result-item" onclick="searchArtistByName(decodeURIComponent('${safeName}'))">
                    <img src="${artist.img}" alt="" style="border-radius: 50%;" onerror="this.src='https://placehold.co/48/333/fff?text=A'">
                    <div class="flex-1 min-w-0">
                        <div class="text-white font-medium truncate">${searchManager.escapeHtml(artist.name)}</div>
                        <div class="text-gray-400 text-sm truncate">Artist</div>
                    </div>
                </div>
            `;
            }).join('');
        }
        
        if (!html) {
            html = '<div class="p-4 text-center text-gray-400">No results found</div>';
        }
        
        results.innerHTML = html;
    },
    
    search: async (query) => {
        const results = document.getElementById('search-results');
        if (results) searchManager._searchDropdown(query, results);
    },
    
    searchMain: async (query) => {
        router.go('search');
        const container = document.getElementById('search-results-main');
        if (!container) return;
        container.innerHTML = '<div class="flex justify-center py-12"><div class="loading-spinner"></div></div>';
        
        const [songs, albums, artists] = await Promise.all([
            jiosaavnAPI.searchSongs(query, 20),
            jiosaavnAPI.searchAlbums(query, 10),
            jiosaavnAPI.searchArtists(query, 10)
        ]);
        
        searchManager.lastResults = { songs, albums, artists };
        let html = '';
        
        // Top Result
        const topSong = songs[0];
        if (topSong) {
            const topId = songStore.add(topSong);
            html += `
            <div class="mb-8">
                <h2 class="text-2xl font-bold text-white mb-4">Top Result</h2>
                <div class="search-top-result" onclick="playSongById('${topId}')">
                    <img src="${topSong.img}" alt="" onerror="this.src='https://placehold.co/120/333/fff?text=M'">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-2xl font-bold text-white truncate">${searchManager.escapeHtml(topSong.name)}</h3>
                        <p class="text-gray-400 mt-1">${searchManager.escapeHtml(topSong.artist)}</p>
                        <span class="source-badge jiosaavn mt-2 inline-block">Song</span>
                    </div>
                    <span class="bg-green-500 text-black p-4 rounded-full shadow-xl"><svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
                </div>
            </div>`;
        }
        
        // Songs section
        if (songs.length > 0) {
            html += '<h2 class="text-xl font-bold text-white mb-3">Songs</h2><div class="space-y-1 mb-8">';
            html += songs.slice(0, 10).map((song, i) => {
                const storeId = songStore.add(song);
                const duration = song.duration || 0;
                const mins = Math.floor(duration / 60);
                const secs = (duration % 60).toString().padStart(2, '0');
                return `
                <div class="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition" onclick="playSongById('${storeId}')">
                    <span class="text-gray-500 w-6 text-center font-mono text-sm">${i + 1}</span>
                    <img src="${song.img}" class="w-10 h-10 rounded object-cover" onerror="this.src='https://placehold.co/40/333/fff?text=M'">
                    <div class="flex-1 min-w-0">
                        <h4 class="text-white font-medium truncate">${searchManager.escapeHtml(song.name)}</h4>
                        <p class="text-gray-400 text-xs truncate">${searchManager.escapeHtml(song.artist)}</p>
                    </div>
                    <span class="text-gray-500 text-xs">${mins}:${secs}</span>
                </div>`;
            }).join('');
            html += '</div>';
        }
        
        // Albums section
        if (albums.length > 0) {
            html += '<h2 class="text-xl font-bold text-white mb-3">Albums</h2><div class="horizontal-scroll mb-8">';
            html += albums.map(album => `
                <div class="scroll-card content-card" onclick="openAlbumById('${searchManager.escapeHtml(album.id)}')">
                    <img src="${album.img}" alt="" onerror="this.src='https://placehold.co/200/333/fff?text=Album'">
                    <h3 class="font-bold text-white truncate">${searchManager.escapeHtml(album.name)}</h3>
                    <p class="text-sm text-gray-400 truncate">${searchManager.escapeHtml(album.artist)}</p>
                </div>`).join('');
            html += '</div>';
        }
        
        // Artists section
        if (artists.length > 0) {
            html += '<h2 class="text-xl font-bold text-white mb-3">Artists</h2><div class="horizontal-scroll mb-8">';
            html += artists.map(artist => {
                const safeName = encodeURIComponent(artist.name || '');
                return `
                <div class="scroll-card content-card artist" onclick="searchArtistByName(decodeURIComponent('${safeName}'))">
                    <img src="${artist.img}" alt="" onerror="this.src='https://placehold.co/200/333/fff?text=Artist'">
                    <h3 class="font-bold text-white truncate text-center">${searchManager.escapeHtml(artist.name)}</h3>
                    <p class="text-sm text-gray-400 text-center">Artist</p>
                </div>`;
            }).join('');
            html += '</div>';
        }
        
        if (!html) {
            html = '<div class="text-center py-12 text-gray-400">No results found for "' + searchManager.escapeHtml(query) + '"</div>';
        }
        
        container.innerHTML = html;
    },
    
    searchByArtist: async (artistName) => {
        document.getElementById('search-results')?.classList.remove('active');
        document.getElementById('mobile-search-results')?.classList.remove('active');
        const desktopInput = document.getElementById('search-input');
        const mobileInput = document.getElementById('mobile-search-input');
        if (desktopInput) desktopInput.value = artistName;
        if (mobileInput) mobileInput.value = artistName;
        
        const songs = await jiosaavnAPI.searchSongs(artistName, 20);
        if (songs.length > 0) {
            player.setQueue(songs, 0);
        }
    },
    
    escapeHtml: (text) => {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
};
