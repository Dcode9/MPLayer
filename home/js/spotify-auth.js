// ============================================
// SPOTIFY AUTHENTICATION MODULE
// Implements OAuth 2.0 with PKCE (Proof Key for Code Exchange)
// ============================================

const spotifyAuth = {
    // Spotify App Credentials (REPLACE WITH YOUR OWN)
    clientId: '8fba37005d964e2599ce567c69ee7f1d', // Replace with your Spotify Client ID
    redirectUri: window.location.origin + window.location.pathname,
    scopes: [
        'playlist-read-private',
        'playlist-read-collaborative',
        'user-library-read'
    ].join(' '),

    // State management
    isAuthenticated: false,
    accessToken: null,
    tokenExpiry: null,

    // Initialize authentication state from localStorage
    init: () => {
        const token = localStorage.getItem('spotify_access_token');
        const expiry = localStorage.getItem('spotify_token_expiry');

        if (token && expiry) {
            const expiryTime = parseInt(expiry);
            if (Date.now() < expiryTime) {
                spotifyAuth.accessToken = token;
                spotifyAuth.tokenExpiry = expiryTime;
                spotifyAuth.isAuthenticated = true;
                debugLog('Spotify: Restored authentication from localStorage');
                return true;
            } else {
                debugLog('Spotify: Token expired, clearing localStorage');
                spotifyAuth.logout();
            }
        }

        // Check for OAuth callback
        spotifyAuth.handleCallback();
        return spotifyAuth.isAuthenticated;
    },

    // Generate random string for PKCE
    generateRandomString: (length) => {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return values.reduce((acc, x) => acc + possible[x % possible.length], '');
    },

    // Generate code challenge for PKCE
    generateCodeChallenge: async (codeVerifier) => {
        const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(codeVerifier)
        );
        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    },

    // Start OAuth flow
    login: async () => {
        if (spotifyAuth.clientId === 'YOUR_SPOTIFY_CLIENT_ID') {
            errorHandler.show('Spotify Client ID not configured. Please add your Client ID in spotify-auth.js', 6000);
            return;
        }

        const codeVerifier = spotifyAuth.generateRandomString(64);
        const codeChallenge = await spotifyAuth.generateCodeChallenge(codeVerifier);

        // Store code verifier for later use
        localStorage.setItem('spotify_code_verifier', codeVerifier);

        // Build authorization URL
        const params = new URLSearchParams({
            client_id: spotifyAuth.clientId,
            response_type: 'code',
            redirect_uri: spotifyAuth.redirectUri,
            scope: spotifyAuth.scopes,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
        });

        const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
        debugLog('Spotify: Redirecting to authorization URL');
        window.location.href = authUrl;
    },

    // Handle OAuth callback
    handleCallback: async () => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const error = params.get('error');

        if (error) {
            errorHandler.show(`Spotify authorization failed: ${error}`);
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }

        if (code) {
            debugLog('Spotify: Authorization code received, exchanging for token');
            const codeVerifier = localStorage.getItem('spotify_code_verifier');

            if (!codeVerifier) {
                errorHandler.show('Spotify authentication error: Code verifier not found');
                window.history.replaceState({}, document.title, window.location.pathname);
                return;
            }

            try {
                // Exchange code for access token
                const response = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        client_id: spotifyAuth.clientId,
                        grant_type: 'authorization_code',
                        code: code,
                        redirect_uri: spotifyAuth.redirectUri,
                        code_verifier: codeVerifier,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Token exchange failed: ${response.status}`);
                }

                const data = await response.json();

                // Store token
                spotifyAuth.accessToken = data.access_token;
                spotifyAuth.tokenExpiry = Date.now() + (data.expires_in * 1000);
                spotifyAuth.isAuthenticated = true;

                localStorage.setItem('spotify_access_token', data.access_token);
                localStorage.setItem('spotify_token_expiry', spotifyAuth.tokenExpiry.toString());
                localStorage.removeItem('spotify_code_verifier');

                debugLog('Spotify: Authentication successful');
                errorHandler.show('Successfully connected to Spotify!', 3000);

                // Clean up URL and reload to update UI
                window.history.replaceState({}, document.title, window.location.pathname);

                // Update UI
                if (typeof ui !== 'undefined' && ui.updateSpotifyButton) {
                    ui.updateSpotifyButton();
                }

                // Auto-load playlists if we're on the playlists view
                if (typeof router !== 'undefined' && router.currentView === 'playlists') {
                    if (typeof playlistsView !== 'undefined' && playlistsView.loadSpotifyPlaylists) {
                        playlistsView.loadSpotifyPlaylists();
                    }
                }

            } catch (error) {
                debugError('Spotify token exchange error:', error);
                errorHandler.show('Failed to connect to Spotify. Please try again.');
                localStorage.removeItem('spotify_code_verifier');
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    },

    // Logout and clear tokens
    logout: () => {
        spotifyAuth.accessToken = null;
        spotifyAuth.tokenExpiry = null;
        spotifyAuth.isAuthenticated = false;

        localStorage.removeItem('spotify_access_token');
        localStorage.removeItem('spotify_token_expiry');
        localStorage.removeItem('spotify_code_verifier');
        localStorage.removeItem('spotify_playlists');

        debugLog('Spotify: Logged out');

        // Update UI
        if (typeof ui !== 'undefined' && ui.updateSpotifyButton) {
            ui.updateSpotifyButton();
        }
    },

    // Check if token is still valid
    isTokenValid: () => {
        if (!spotifyAuth.accessToken || !spotifyAuth.tokenExpiry) {
            return false;
        }
        return Date.now() < spotifyAuth.tokenExpiry;
    },

    // Get valid access token
    getAccessToken: () => {
        if (spotifyAuth.isTokenValid()) {
            return spotifyAuth.accessToken;
        }
        return null;
    }
};
