// ============================================
// MEDIA SESSION MANAGER
// ============================================
const mediaSessionManager = {
    update: (track) => {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.name, artist: track.artist,
                artwork: [{ src: track.img || 'https://placehold.co/512/333/fff?text=Music', sizes: '512x512', type: 'image/png' }]
            });
            navigator.mediaSession.setActionHandler('play', player.togglePlay);
            navigator.mediaSession.setActionHandler('pause', player.togglePlay);
            navigator.mediaSession.setActionHandler('previoustrack', player.prev);
            navigator.mediaSession.setActionHandler('nexttrack', player.next);
        }
    }
};

// ============================================
// PICTURE-IN-PICTURE MANAGER
// ============================================
const pipManager = {
    video: document.getElementById('pip-video'),
    canvas: document.getElementById('pip-canvas'),
    ctx: document.getElementById('pip-canvas').getContext('2d'),
    toggle: async () => {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else {
            if (state.currentTrack) pipManager.drawCanvas(state.currentTrack);
            const stream = pipManager.canvas.captureStream();
            pipManager.video.srcObject = stream;
            await pipManager.video.play();
            try { await pipManager.video.requestPictureInPicture(); } catch(e) { errorHandler.show("PiP Failed: " + e.message); }
        }
    },
    drawCanvas: (track) => {
        if (!track) return;
        const ctx = pipManager.ctx;
        const w = 500, h = 500;
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, w, h);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = track.img || 'https://placehold.co/500/333/fff?text=No+Art';
        img.onload = () => { ctx.drawImage(img, 0, 0, w, w); };
        ctx.fillStyle = "white"; ctx.font = "bold 40px sans-serif"; ctx.fillText(track.name || 'Unknown', 20, 450);
    }
};

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
    // "/" to focus search (when not in input)
    if (e.key === '/' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        const input = document.getElementById('search-input');
        if (input) input.focus();
        return;
    }
    // Escape to blur search and close results
    if (e.key === 'Escape') {
        const input = document.getElementById('search-input');
        if (input && document.activeElement === input) {
            input.blur();
            document.getElementById('search-results')?.classList.remove('active');
            return;
        }
    }
    if(e.target.tagName === 'INPUT') return;
    switch(e.code) {
        case 'Space': e.preventDefault(); player.togglePlay(); break;
        case 'ArrowRight': case 'KeyD': if(audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); break;
        case 'ArrowLeft': case 'KeyA': if(audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5); break;
        case 'ArrowUp': case 'KeyW': player.setVolume(Math.min(1, audio.volume + 0.1)); break;
        case 'ArrowDown': case 'KeyS': player.setVolume(Math.max(0, audio.volume - 0.1)); break;
    }
});

// ============================================
// MOBILE NAVIGATION
// ============================================
function toggleMobileMenu() {
    const nav = document.getElementById('nav-panel');
    const overlay = document.getElementById('sidebar-overlay');
    if (!nav || !overlay) return;
    const isOpen = nav.classList.contains('mobile-open');
    if (isOpen) {
        nav.classList.remove('mobile-open');
        overlay.classList.remove('active');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    } else {
        overlay.style.display = 'block';
        requestAnimationFrame(() => {
            nav.classList.add('mobile-open');
            overlay.classList.add('active');
        });
    }
}

function mobileNav(view) {
    if (view === 'search') {
        const input = document.getElementById('mobile-search-input');
        if (input) {
            input.focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const mainView = document.getElementById('main-view');
            if (mainView) mainView.scrollTop = 0;
        }
        return;
    }
    router.go(view);
    // Update mobile bottom nav active state
    document.querySelectorAll('#mobile-bottom-nav .mobile-nav-btn').forEach(btn => btn.classList.remove('active'));
    const viewMap = { 'home': 0, 'trending': 1, 'albums': 2, 'playlists': 3 };
    const idx = viewMap[view];
    const btns = document.querySelectorAll('#mobile-bottom-nav .mobile-nav-btn');
    if (idx !== undefined && btns[idx]) btns[idx].classList.add('active');
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
    debugLog('Initializing D\'Tunes Player...');
    
    const vCanvas = document.getElementById('visualizer-canvas');
    visualizerCtx = vCanvas.getContext('2d');
    resizeVisualizer();
    window.addEventListener('resize', () => {
        if(!window._resizeTimeout) {
            window._resizeTimeout = setTimeout(() => { resizeVisualizer(); window._resizeTimeout = null; }, 100);
        }
    });

    // Load preferences
    preferences.load();

    // Initialize search
    searchManager.init();

    // Load homepage content from JioSaavn
    homeView.load();
    
    // Initialize UI listeners
    ui.initListeners();
    
    // Start visualizer
    viz.startLoop();
    
    // Render liked songs
    ui.renderLikedSongs();
    
    // Restore last played track metadata in player (without auto-playing)
    try {
        const lastTrack = JSON.parse(localStorage.getItem('lastPlayedTrack'));
        if (lastTrack && lastTrack.name) {
            state.currentTrack = lastTrack;
            ui.updateMetadata(lastTrack);
            ui.updateLikeBtn();
            const island = document.getElementById('info-island');
            if (island) {
                island.style.opacity = '1';
                island.style.transform = 'translateY(0)';
            }
            const playerCard = document.getElementById('player-card');
            if (playerCard) playerCard.classList.add('rounded-tl-[8px]');
        }
    } catch(e) {}
}

init();
