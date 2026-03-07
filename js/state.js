// ============================================
// STATE MANAGEMENT
// ============================================
const state = { 
    queue: [], 
    idx: -1, 
    playing: false, 
    loaded: false,
    likedIds: (() => {
        try {
            const data = JSON.parse(localStorage.getItem('likedIds') || '[]');
            return Array.isArray(data) ? data : [];
        } catch(e) { return []; }
    })(),
    likedSongs: (() => {
        try {
            const data = JSON.parse(localStorage.getItem('likedSongs') || '[]');
            return Array.isArray(data) ? data.slice(0, 500) : []; // Limit to 500 songs
        } catch(e) { return []; }
    })(),
    isDragging: false,
    hoverProgress: -1,
    lastHoverProgress: 0.5,
    shuffle: false,
    repeat: 0, // 0: off, 1: all, 2: one
    currentTrack: null,
    playHistory: (() => {
        try {
            const data = JSON.parse(localStorage.getItem('playHistory') || '[]');
            return Array.isArray(data) ? data : [];
        } catch(e) { return []; }
    })(),
    artistPlayCounts: (() => {
        try {
            const data = JSON.parse(localStorage.getItem('artistPlayCounts') || '{}');
            return typeof data === 'object' && data !== null ? data : {};
        } catch(e) { return {}; }
    })(),
    isLoading: false,
    searchDebounce: null
};

// ============================================
// SONG STORE (For safe click handlers - prevents XSS)
// ============================================
const songStore = {
    songs: new Map(),
    counter: 0,
    
    add: (song) => {
        const id = `song_${songStore.counter++}`;
        songStore.songs.set(id, song);
        return id;
    },
    
    get: (id) => {
        return songStore.songs.get(id);
    },
    
    clear: () => {
        songStore.songs.clear();
        songStore.counter = 0;
    }
};

// Global function for safe song playback
window.playSongById = (storeId) => {
    const song = songStore.get(storeId);
    if (song) {
        player.playDirect(song);
    }
};

// Global function for safe album opening
window.openAlbumById = (albumId) => {
    albumsView.openAlbum(albumId);
};

// Global function for safe artist search
window.searchArtistByName = (artistName) => {
    searchManager.searchByArtist(artistName);
};
