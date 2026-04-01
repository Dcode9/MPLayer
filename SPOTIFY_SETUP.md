# Spotify Playlist Migration Setup Guide

This guide will help you set up Spotify integration in MPLayer (D'Tunes) to import and play your Spotify playlists.

> **Note:** If you see console warnings or messages in your browser's developer tools, please refer to [CONSOLE_MESSAGES.md](./CONSOLE_MESSAGES.md) for explanations. Most console messages are informational and don't indicate problems.

## Features

- **Sign in with Spotify**: Securely authenticate using OAuth 2.0 with PKCE (Proof Key for Code Exchange)
- **View All Playlists**: Browse all your Spotify playlists in the app
- **Playlist Migration**: Automatically convert Spotify playlists to playable tracks by finding matching songs on JioSaavn
- **Real-time Progress**: See conversion progress as tracks are matched
- **Persistent Authentication**: Stay signed in across sessions

## Setup Instructions

### Step 1: Create a Spotify App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **"Create app"**
4. Fill in the app details:
   - **App name**: MPLayer (or any name you prefer)
   - **App description**: Music player with Spotify integration
   - **Website**: Your website URL (can be http://localhost for local development)
   - **Redirect URI**:
     - For local development: `http://localhost:8000/home/index.html` (adjust port if needed)
     - For production: Your deployed URL (e.g., `https://yourdomain.com/home/index.html`)
5. Check the **"Web API"** option
6. Agree to the terms and click **"Save"**

### Step 2: Get Your Client ID

1. After creating the app, you'll see your **Client ID** on the app dashboard
2. Copy this Client ID (you'll need it in the next step)
3. **Important**: The Client ID is safe to use in frontend code. Do NOT use the Client Secret in a frontend app.

### Step 3: Configure the App

1. Open the file: `/home/js/spotify-auth.js`
2. Find line 8 where it says:
   ```javascript
   clientId: 'YOUR_SPOTIFY_CLIENT_ID',
   ```
3. Replace `'YOUR_SPOTIFY_CLIENT_ID'` with your actual Spotify Client ID:
   ```javascript
   clientId: 'abc123def456ghi789',  // Your actual Client ID
   ```
4. Save the file

### Step 4: Set the Redirect URI

1. Make sure the `redirectUri` in `spotify-auth.js` matches your app's URL
2. By default, it's set to use the current page URL:
   ```javascript
   redirectUri: window.location.origin + window.location.pathname,
   ```
3. If you need to customize it, update this line accordingly

### Step 5: Update Spotify App Settings

1. Go back to your [Spotify App Dashboard](https://developer.spotify.com/dashboard)
2. Click on your app
3. Click **"Settings"**
4. Under **"Redirect URIs"**, add your app's URL (must exactly match what's in your code)
   - Example: `http://localhost:8000/home/index.html`
   - You can add multiple URIs for different environments (local, staging, production)
5. Click **"Add"** then **"Save"**

## How to Use

### Sign In

1. Open MPLayer (D'Tunes) in your browser
2. In the left sidebar, scroll down to find the **"Connect Spotify"** button (green button with Spotify logo)
3. Click the button
4. You'll be redirected to Spotify to authorize the app
5. Grant the requested permissions:
   - Read your playlists
   - Read your saved tracks
6. You'll be redirected back to MPLayer, now signed in

### View Your Playlists

1. Click on **"Playlists"** in the left sidebar
2. Your Spotify playlists will appear at the top of the page
3. Each playlist shows:
   - Playlist name
   - Number of tracks
   - Playlist owner
   - Spotify badge

### Play a Playlist

1. Click on any Spotify playlist
2. The app will automatically:
   - Fetch all tracks from the playlist
   - Search for matching songs on JioSaavn
   - Show a progress dialog
   - Start playing the matched tracks
3. You'll see a success message showing how many tracks were matched
4. The matched tracks will start playing immediately

### Sign Out

1. Scroll down in the left sidebar
2. Click the **"Disconnect Spotify"** button
3. Your Spotify data will be cleared from the app

## Technical Details

### Authentication Flow

- Uses **OAuth 2.0 Authorization Code Flow with PKCE**
- No client secret required (safe for frontend apps)
- Access tokens are stored in localStorage
- Tokens are automatically checked for expiration
- Session persists across page reloads

### Playlist Conversion

When you click on a Spotify playlist:

1. The app fetches all tracks from the playlist (handles pagination for large playlists)
2. For each track, it searches JioSaavn using the track name and artist
3. The first matching result is selected
4. A progress bar shows the conversion status
5. All matched tracks are added to the queue and start playing

**Note**: Not all Spotify tracks may be available on JioSaavn. The app shows you the match rate (e.g., "45 of 50 tracks matched").

### Data Storage

The app stores the following in localStorage:

- `spotify_access_token`: Your Spotify access token
- `spotify_token_expiry`: When the token expires
- `spotify_playlists`: Cached list of your playlists
- `spotify_user`: Your Spotify user profile

All data is stored locally in your browser and is never sent to any server except Spotify's API.

## Troubleshooting

### "Spotify Client ID not configured" Error

- Make sure you replaced `'YOUR_SPOTIFY_CLIENT_ID'` with your actual Client ID in `spotify-auth.js`
- Refresh the page after making changes

### "Redirect URI mismatch" Error

- The redirect URI in your code must EXACTLY match the one in your Spotify app settings
- Include the protocol (`http://` or `https://`)
- Include the port if using localhost (e.g., `:8000`)
- Include the full path (e.g., `/home/index.html`)
- Check for typos or extra spaces

### "Authentication Failed" Error

- Check your browser console for detailed error messages
- Make sure you granted all requested permissions
- Try signing out and signing in again
- Clear your browser's localStorage and try again

### No Playlists Showing Up

- Click the refresh button (circular arrow) next to "Spotify Playlists"
- Check your browser console for API errors
- Make sure you have playlists in your Spotify account
- Try signing out and signing in again

### Low Match Rate

- Spotify tracks may not be available on JioSaavn, especially for:
  - International artists with limited distribution in India
  - Very new releases
  - Rare or obscure tracks
- Try playlists with popular Bollywood or Indian music for better results

## Security Notes

- **Never share your Spotify Client Secret** - This implementation uses PKCE which doesn't require a client secret
- The Client ID is safe to include in frontend code
- Access tokens are temporary (expire after 1 hour)
- All authentication is handled directly with Spotify - no intermediate servers

## Privacy

- Your Spotify credentials are never stored or accessed by this app
- Only the access token provided by Spotify is stored locally
- The app only requests read-only access to your playlists
- No data is sent to any server except Spotify's official API

## Rate Limits

- Spotify API has rate limits
- If you see "Rate limited" messages, wait a moment before trying again
- The app automatically handles rate limiting with retry logic

## Support

If you encounter issues:

1. Check the browser console for error messages
2. Verify your Spotify app settings
3. Make sure your Client ID is correct
4. Try clearing localStorage and signing in again

## Credits

- Spotify Web API: https://developer.spotify.com/documentation/web-api
- OAuth 2.0 PKCE: https://oauth.net/2/pkce/
