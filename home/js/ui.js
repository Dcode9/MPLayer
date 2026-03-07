// ============================================
// UI MANAGER
// ============================================
const ui = {
    initListeners: () => {
        const seekBar = document.getElementById('seek-bar');
        const container = document.getElementById('seek-bar-container');
        const tooltip = document.getElementById('seek-tooltip');
        
        if(!seekBar || !container) return;

        seekBar.addEventListener('mousedown', () => state.isDragging = true);
        seekBar.addEventListener('mouseup', () => state.isDragging = false);
        seekBar.addEventListener('touchstart', () => state.isDragging = true);
        seekBar.addEventListener('touchend', () => state.isDragging = false);
        
        seekBar.addEventListener('input', () => {
            if(!audio.duration || isNaN(audio.duration)) return;
            audio.currentTime = parseFloat(seekBar.value);
            currentProgress = audio.currentTime / audio.duration;
        });

        container.addEventListener('mousemove', (e) => {
            if(!state.loaded || !audio.duration || isNaN(audio.duration)) return;
            const rect = container.getBoundingClientRect();
            const height = rect.height;
            const offsetY = e.clientY - rect.top;

            // INTERACTION ONLY BOTTOM 50%
            if (offsetY < height / 2) {
                state.hoverProgress = -1;
                if(tooltip) tooltip.classList.remove('visible');
                return;
            }

            const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            state.hoverProgress = progress;
            state.lastHoverProgress = progress;
            
            if(tooltip) {
                const hoverTime = progress * audio.duration;
                const m = Math.floor(hoverTime / 60), s = Math.floor(hoverTime % 60);
                tooltip.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                tooltip.style.left = `${(e.clientX - rect.left)}px`;
                tooltip.classList.add('visible');
            }
        });

        container.addEventListener('mouseleave', () => {
            state.hoverProgress = -1;
            if(tooltip) tooltip.classList.remove('visible');
        });

        audio.addEventListener('timeupdate', () => {
            if(!audio.duration || isNaN(audio.duration)) return;
            if (!state.isDragging) {
                seekBar.max = audio.duration;
                seekBar.value = audio.currentTime;
                currentProgress = audio.currentTime / audio.duration;
            }
        });
        
        audio.addEventListener('ended', async () => {
            if(state.repeat === 2) { // Loop One
                audio.currentTime = 0;
                audio.play();
            } else if (state.queue.length > 0 && (state.idx + 1 < state.queue.length || state.repeat === 1)) {
                player.next();
            } else {
                // Autoplay: fetch related tracks when queue runs out
                if (state.currentTrack) {
                    debugLog('Autoplay: fetching related tracks...');
                    const related = await recommendations.getRelatedTracks(state.currentTrack);
                    if (related.length > 0) {
                        state.queue = related;
                        state.idx = 0;
                        player.playDirect(related[0]);
                    }
                }
            }
        });
    },
    enableControls: () => {
        const els = ['seek-bar-container', 'seek-bar', 'btn-play', 'btn-prev', 'btn-next', 'btn-pip', 'p-like-btn', 'btn-shuffle', 'btn-repeat'];
        els.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.classList.remove('disabled');
                el.disabled = false;
            }
        });
        const island = document.getElementById('info-island');
        const playerCard = document.getElementById('player-card');
        if(island) {
            island.style.opacity = "1";
            island.style.transform = "translateY(0)";
        }
        // Reduce top-left corner of player-card when info island visible
        if(playerCard) {
            playerCard.classList.add('rounded-tl-[8px]');
        }
    },
    updateMetadata: (track) => {
        const title = document.getElementById('p-title');
        const artist = document.getElementById('p-artist');
        if(title) title.textContent = track.name;
        if(artist) artist.textContent = track.artist;
        
        // Setup sliding text if content overflows
        ui.setupSlideText(title);
        ui.setupSlideText(artist);
        
        const artImg = document.getElementById('curr-art-img');
        if(artImg) artImg.src = track.img || "https://placehold.co/300/333/fff?text=Music";
        
        if (track.img) {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = track.img;
            img.onload = () => {
                try {
                    const palette = colorThief.getPalette(img, 3);
                    const main = palette[0], sec = palette[1];
                    const mainColor = `rgb(${main[0]}, ${main[1]}, ${main[2]})`;
                    const secColor = `rgb(${sec[0]}, ${sec[1]}, ${sec[2]})`;
                    const darkShade = `rgb(${main[0]*0.2}, ${main[1]*0.2}, ${main[2]*0.2})`;
                    
                    const bg = document.getElementById('background-playing');
                    if(bg) bg.style.background = `radial-gradient(circle at top, ${mainColor}, ${darkShade})`;
                    const rip = document.getElementById('ripple-effect');
                    if(rip) rip.style.background = `radial-gradient(circle, ${secColor} 0%, transparent 70%)`;
                    const glow = document.getElementById('album-art-glow');
                    if(glow) glow.style.background = `conic-gradient(from 0deg, ${mainColor}, ${secColor}, ${mainColor})`;
                } catch(e) {}
            };
        }
    },
    
    setupSlideText: (el) => {
        if (!el) return;
        el.classList.remove('sliding');
        el.style.removeProperty('--slide-distance');
        requestAnimationFrame(() => {
            const container = el.parentElement;
            const overflow = el.scrollWidth - container.clientWidth;
            if (container && overflow > 5) {
                el.style.setProperty('--slide-distance', -overflow + 'px');
                el.classList.add('sliding');
            }
        });
    },
    
    showLoading: (show) => {
        const playBtn = document.getElementById('btn-play');
        if (playBtn) {
            if (show) {
                playBtn.innerHTML = '<div class="loading-spinner"></div>';
            } else {
                playBtn.innerHTML = `
                    <span id="icon-play" class="${state.playing ? 'hidden' : 'flex ml-1'}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                    <span id="icon-pause" class="${state.playing ? 'flex' : 'hidden'}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></span>
                `;
            }
        }
    },
    
    renderLikedSongs: () => {
        const likedList = document.getElementById('liked-list');
        if(likedList) {
            if(state.likedSongs.length === 0) {
                likedList.innerHTML = '<div class="text-gray-500">No liked songs yet. Click the heart icon to like songs!</div>';
            } else {
                likedList.innerHTML = state.likedSongs.map((song, i) => {
                    const storeId = songStore.add(song);
                    return `
                    <div class="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition group" onclick="playSongById('${storeId}')">
                        <span class="text-gray-500 w-6 text-center font-mono text-sm">${i+1}</span>
                        <img src="${song.img || 'https://placehold.co/100/333/fff?text=M'}" class="w-10 h-10 rounded object-cover" onerror="this.src='https://placehold.co/40/333/fff?text=M'">
                        <div class="flex-1 overflow-hidden">
                            <h4 class="text-white font-medium truncate">${searchManager.escapeHtml(song.name)}</h4>
                            <p class="text-gray-400 text-xs truncate">${searchManager.escapeHtml(song.artist)}</p>
                        </div>
                    </div>`;
                }).join('');
            }
        }
    },
    
    renderQueue: () => {
        const queueList = document.getElementById('queue-list');
        if (!queueList) return;
        if (state.queue.length === 0) {
            queueList.innerHTML = '<p class="text-gray-500 text-sm">No songs in queue</p>';
            return;
        }
        const currentIdx = state.idx;
        let upcoming = state.queue.slice(currentIdx + 1);
        if (state.repeat === 1) {
            upcoming = upcoming.concat(state.queue.slice(0, currentIdx));
        }
        if (upcoming.length === 0) {
            queueList.innerHTML = '<p class="text-gray-500 text-sm">No upcoming songs</p>';
            return;
        }
        queueList.innerHTML = upcoming.slice(0, 20).map((song, i) => {
            const storeId = songStore.add(song);
            return `
            <div class="flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition" onclick="playSongById('${storeId}')">
                <span class="text-gray-500 w-6 text-center font-mono text-sm">${i + 1}</span>
                <img src="${song.img || 'https://placehold.co/40/333/fff?text=M'}" class="w-10 h-10 rounded object-cover" onerror="this.src='https://placehold.co/40/333/fff?text=M'">
                <div class="flex-1 overflow-hidden">
                    <h4 class="text-white font-medium truncate">${searchManager.escapeHtml(song.name)}</h4>
                    <p class="text-gray-400 text-xs truncate">${searchManager.escapeHtml(song.artist)}</p>
                </div>
            </div>`;
        }).join('');
    },
    
    // Create card for JioSaavn songs (uses songStore for XSS safety)
    createJioSaavnCard: (song, i) => {
        const storeId = songStore.add(song);
        return `
        <div class="bg-white/5 hover:bg-white/10 p-4 rounded-xl cursor-pointer transition group" onclick="playSongById('${storeId}')">
            <div class="relative aspect-square rounded-lg overflow-hidden mb-3 bg-gray-800 shadow-lg">
                <img src="${song.img}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.src='https://placehold.co/300/333/fff?text=Music'">
                <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <span class="bg-green-500 text-black p-3 rounded-full shadow-xl transform scale-75 group-hover:scale-100 transition"><svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
                </div>
            </div>
            <h3 class="font-bold text-white truncate">${searchManager.escapeHtml(song.name)}</h3>
            <p class="text-sm text-gray-400 truncate">${searchManager.escapeHtml(song.artist)}</p>
        </div>`;
    },
    
    // Create horizontally scrollable card with fixed width
    createScrollCard: (song) => {
        const storeId = songStore.add(song);
        return `
        <div class="scroll-card bg-white/5 hover:bg-white/10 p-3 rounded-xl cursor-pointer transition group" onclick="playSongById('${storeId}')">
            <div class="relative aspect-square rounded-lg overflow-hidden mb-2 bg-gray-800 shadow-lg">
                <img src="${song.img}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.src='https://placehold.co/300/333/fff?text=Music'">
                <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <span class="bg-green-500 text-black p-2 rounded-full shadow-xl transform scale-75 group-hover:scale-100 transition"><svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
                </div>
            </div>
            <h3 class="font-bold text-white text-sm truncate">${searchManager.escapeHtml(song.name)}</h3>
            <p class="text-xs text-gray-400 truncate">${searchManager.escapeHtml(song.artist)}</p>
        </div>`;
    },
    
    // Create album card (album.id is sanitized server-side)
    createAlbumCard: (album) => `
        <div class="content-card" onclick="openAlbumById('${searchManager.escapeHtml(album.id)}')">
            <img src="${album.img}" alt="${searchManager.escapeHtml(album.name)}" onerror="this.src='https://placehold.co/200/333/fff?text=Album'">
            <h3 class="font-bold text-white truncate">${searchManager.escapeHtml(album.name)}</h3>
            <p class="text-sm text-gray-400 truncate">${searchManager.escapeHtml(album.artist)}</p>
            <p class="text-xs text-gray-500 mt-1">${album.year || ''} ${album.songCount ? '• ' + album.songCount + ' songs' : ''}</p>
        </div>
    `,
    
    // Create artist card (uses encodeURIComponent for safe passing)
    createArtistCard: (artist) => {
        const safeName = encodeURIComponent(artist.name || '');
        return `
        <div class="content-card artist" onclick="searchArtistByName(decodeURIComponent('${safeName}'))">
            <img src="${artist.img}" alt="${searchManager.escapeHtml(artist.name)}" onerror="this.src='https://placehold.co/200/333/fff?text=Artist'">
            <h3 class="font-bold text-white truncate text-center">${searchManager.escapeHtml(artist.name)}</h3>
            <p class="text-sm text-gray-400 text-center">Artist</p>
        </div>
    `;
    },
    
    updatePlayBtn: () => {
        const isPlaying = state.playing;
        const playIcon = document.getElementById('icon-play');
        const pauseIcon = document.getElementById('icon-pause');
        if(playIcon) playIcon.className = isPlaying ? 'hidden' : 'flex ml-1';
        if(pauseIcon) pauseIcon.className = isPlaying ? 'flex' : 'hidden';
        const bgPlaying = document.getElementById('background-playing');
        if(bgPlaying) bgPlaying.style.opacity = isPlaying ? 1 : 0;
    },
    updateLikeBtn: () => {
        if(!state.currentTrack) return;
        const id = state.currentTrack.id;
        const btn = document.getElementById('p-like-btn');
        if(btn) btn.className = state.likedIds.includes(id) ? 'text-red-500 transition ml-2' : 'text-gray-400 hover:text-red-500 transition ml-2';
    }
};
