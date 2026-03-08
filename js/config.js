// ============================================
// CONFIGURATION & CONSTANTS
// ============================================

// JioSaavn API Configuration - Multiple fallback endpoints
const JIOSAAVN_API_ENDPOINTS = [
    'https://jiosaavn-api-taupe-phi.vercel.app/api',
    'https://jiosaavn-api-v2.vercel.app/api',
    'https://saavn.me/api',
    'https://jio-saavn-api-red.vercel.app/api'
];
let currentApiIndex = 0;
let JIOSAAVN_API = JIOSAAVN_API_ENDPOINTS[currentApiIndex];
const API_RETRY_COUNT = 3;
const API_RETRY_DELAY = 1000;

// Function to switch to next API endpoint
function switchToNextApi() {
    currentApiIndex = (currentApiIndex + 1) % JIOSAAVN_API_ENDPOINTS.length;
    JIOSAAVN_API = JIOSAAVN_API_ENDPOINTS[currentApiIndex];
    console.log('[JioSaavn Player] Switching to API:', JIOSAAVN_API);
    return currentApiIndex !== 0; // Returns true if we haven't cycled through all
}

// ============================================
// DEBUG LOGGING
// ============================================
const DEBUG = false; // Set to true for development
function debugLog(...args) {
    if (DEBUG) console.log('[JioSaavn Player]', ...args);
}
function debugError(...args) {
    console.error('[JioSaavn Player Error]', ...args);
}

// ============================================
// ERROR HANDLING
// ============================================
const errorHandler = {
    show: (message, duration = 4000) => {
        const container = document.getElementById('error-toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    
    handleApiError: (error, context = '') => {
        debugError(`API Error (${context}):`, error);
        let message = 'Something went wrong. Please try again.';
        
        if (error.message) {
            if (error.message.includes('network') || 
                error.message.includes('fetch') || 
                error.message.includes('ERR_NAME_NOT_RESOLVED') ||
                error.name === 'AbortError') {
                message = 'Cannot connect to music service. Trying alternative servers...';
            } else if (error.message.includes('404')) {
                message = 'Content not found.';
            } else if (error.message.includes('429')) {
                message = 'Too many requests. Please wait a moment.';
            }
        }
        
        errorHandler.show(message);
    }
};

// ============================================
// PREFERENCES MANAGER
// ============================================
const preferences = {
    quality: localStorage.getItem('audioQuality') || '160kbps',
    
    setQuality: (quality) => {
        preferences.quality = quality;
        localStorage.setItem('audioQuality', quality);
        debugLog('Quality set to:', quality);
    },
    
    getQualityUrl: (downloadUrls) => {
        if (!downloadUrls || !Array.isArray(downloadUrls)) return null;
        const qualityMap = {
            '12kbps': 0,
            '48kbps': 1,
            '96kbps': 2,
            '160kbps': 3,
            '320kbps': 4
        };
        const preferredIdx = qualityMap[preferences.quality] || 3;
        for (let i = preferredIdx; i >= 0; i--) {
            if (downloadUrls[i] && downloadUrls[i].url) {
                return downloadUrls[i].url;
            }
        }
        for (let i = 0; i < downloadUrls.length; i++) {
            if (downloadUrls[i] && downloadUrls[i].url) {
                return downloadUrls[i].url;
            }
        }
        return null;
    },
    
    load: () => {
        const selector = document.getElementById('quality-selector');
        if (selector) selector.value = preferences.quality;
    }
};
