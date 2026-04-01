# Spotify Playlist Troubleshooting Guide

If you're experiencing issues with Spotify playlists not loading or working properly, follow this guide to diagnose and fix the problem.

## Common Issues and Solutions

### Issue 1: "Only the name comes" - Playlists show but no track count or images

**Symptoms:**
- Playlist cards display only the playlist name
- Track count shows "0 tracks"
- No playlist images/thumbnails
- Or playlists appear blank/incomplete

**Possible Causes & Solutions:**

#### Solution A: Check Browser Console for Debug Logs

1. Open your browser's Developer Tools:
   - **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
   - **Firefox**: Press `F12` or `Ctrl+Shift+K` (Windows) / `Cmd+Option+K` (Mac)
   - **Safari**: Enable Developer menu first, then press `Cmd+Option+I`

2. Click on the **Console** tab

3. Look for debug messages starting with `[JioSaavn Player]` including:
   - `Spotify API response for playlists:` - Shows raw API data
   - `First playlist raw data:` - Shows first playlist structure
   - `Normalizing playlist:` - Shows data extraction process
   - `Rendering playlist:` - Shows what's being rendered

4. Check if you see any of these error messages:
   - `Not authenticated with Spotify` - You need to sign in
   - `Spotify session expired` - Re-authenticate with Spotify
   - `Network error` - Check your internet connection
   - API errors (401, 403, 429, etc.) - See specific error solutions below

#### Solution B: Verify Spotify Authentication

1. Make sure you're signed in to Spotify in the app
2. Check that the "Disconnect Spotify" button is visible (if you see "Connect Spotify", you're not authenticated)
3. If unsure, sign out and sign in again:
   - Click "Disconnect Spotify"
   - Clear browser localStorage (DevTools → Application → Local Storage → Clear)
   - Click "Connect Spotify" and authorize again

#### Solution C: Check API Response Structure

In the console, look for the message `First playlist raw data:` and check the structure:

**Expected structure:**
```javascript
{
  id: "playlist_id_here",
  name: "Playlist Name",
  images: [{url: "https://..."}],
  tracks: {
    href: "https://api.spotify.com/v1/playlists/.../tracks",
    total: 25  // ← This is the track count
  },
  owner: {
    display_name: "Owner Name"
  }
}
```

**If `tracks.total` is missing or 0:**
- The Spotify API might not be returning full data
- Try refreshing the playlists (click the refresh button)
- Check if the playlist is empty on Spotify itself

#### Solution D: Clear Cached Data

Sometimes cached data can be stale or corrupted:

1. Open DevTools → Console
2. Run this command to clear Spotify cache:
   ```javascript
   localStorage.removeItem('spotify_playlists');
   localStorage.removeItem('spotify_user');
   ```
3. Refresh the page
4. Navigate to Playlists view again

### Issue 2: Playlists don't play when clicked

**Symptoms:**
- Clicking a playlist does nothing
- Loading overlay appears but nothing happens
- Error message appears

**Diagnostic Steps:**

#### Step 1: Check Console for Click Events

When you click a playlist, you should see:
```
[JioSaavn Player] Opening Spotify playlist: <playlist_id>
[JioSaavn Player] Loading overlay shown
[JioSaavn Player] Starting playlist conversion...
[JioSaavn Player] Converting Spotify playlist <id> to JioSaavn
[JioSaavn Player] Retrieved X tracks from Spotify playlist
[JioSaavn Player] Processing track 1/X: <track name> - <artist>
```

**If you don't see these messages:**
- The onclick handler might not be firing
- JavaScript error might be preventing execution
- Check for any red error messages in the console

**If you see "Error converting Spotify playlist":**
- Check the error details in the console
- Common issues:
  - Network timeout
  - JioSaavn API unavailable
  - Rate limiting

#### Step 2: Verify Track Matching

For each track, you should see either:
- `✓ Matched: <track name>` - Track found on JioSaavn
- `✗ No match found for: <track name>` - Track not available on JioSaavn

**If all tracks show "No match found":**
- JioSaavn API might be down
- Try a playlist with popular Bollywood/Indian music (better match rate)
- Check network connectivity

#### Step 3: Check Final Result

At the end, you should see:
```
[JioSaavn Player] Conversion complete: X/Y tracks matched (Z%)
[JioSaavn Player] Playing X matched tracks
```

**If match rate is 0%:**
- JioSaavn doesn't have the songs from your Spotify playlist
- Try a different playlist with more mainstream/Indian music
- Check that JioSaavn API is working (try searching for songs manually)

### Issue 3: "Spotify session expired" error

**Solution:**
1. Click "Disconnect Spotify"
2. Wait a few seconds
3. Click "Connect Spotify"
4. Authorize again on Spotify
5. You'll be redirected back and playlists should load

### Issue 4: "Network error" or "Cannot connect to music service"

**Solutions:**
1. **Check internet connection**
   - Make sure you're online
   - Try loading other websites

2. **Check Spotify API status**
   - Visit https://developer.spotify.com/
   - Check if Spotify API is operational

3. **Check CORS/Network issues**
   - Some networks block Spotify API
   - Try from a different network/location
   - Disable VPN if active (or try with VPN if without doesn't work)

4. **Browser extensions**
   - Ad blockers might block API requests
   - Try disabling extensions temporarily

### Issue 5: Rate limiting (429 error)

**Symptoms:**
- Error message about too many requests
- Some playlists load but others fail

**Solution:**
1. Wait 30-60 seconds before trying again
2. The app has built-in retry logic, so just wait
3. Avoid rapidly refreshing or clicking multiple playlists

### Issue 6: Redirect URI mismatch

**Symptoms:**
- After clicking "Connect Spotify", you see an error on Spotify's page
- Error message: "INVALID_CLIENT: Invalid redirect URI"

**Solution:**
See [SPOTIFY_REDIRECT_URI_SETUP.md](./SPOTIFY_REDIRECT_URI_SETUP.md) for detailed instructions.

Quick fix:
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Open your app settings
3. Add these exact URIs to "Redirect URIs":
   - `https://play.dverse.fun/home/index.html` (for production)
   - `http://localhost:8000/home/index.html` (for local development)
4. Click "Save"

## Advanced Debugging

### Enable Detailed Logging

The app already has debug mode enabled. To see all logs:

1. Open Console (F12)
2. Filter for `[JioSaavn Player]` to see app-specific logs
3. Look for these categories:
   - Authentication: `Spotify:` prefix
   - API calls: `Spotify API response`
   - Playlists: `Loading Spotify playlists`, `Fetched X playlists`
   - Rendering: `Rendering playlist:`, `Playlists rendered successfully`
   - Conversion: `Converting Spotify playlist`, `Processing track`
   - Errors: `[JioSaavn Player Error]` prefix

### Check Network Tab

1. Open DevTools → Network tab
2. Click "Playlists" or refresh the view
3. Look for requests to:
   - `https://api.spotify.com/v1/me/playlists` - Should return 200
   - `https://api.spotify.com/v1/playlists/<id>/tracks` - Should return 200
4. Click on each request to see:
   - Response status (should be 200)
   - Response data (should contain playlist/track info)
   - Any error messages

### Inspect Local Storage

1. Open DevTools → Application tab (Chrome) or Storage tab (Firefox)
2. Navigate to Local Storage → your domain
3. Check these keys:
   - `spotify_access_token` - Should have a long string (if authenticated)
   - `spotify_token_expiry` - Should be a timestamp in the future
   - `spotify_playlists` - Should contain JSON array of playlists
   - `spotify_user` - Should contain user info

**To manually check token expiry:**
```javascript
const expiry = parseInt(localStorage.getItem('spotify_token_expiry'));
const now = Date.now();
console.log('Token expires in:', Math.round((expiry - now) / 1000 / 60), 'minutes');
```

### Test API Endpoints Manually

In the console, you can test API calls:

```javascript
// Check if authenticated
console.log('Authenticated:', spotifyAuth.isAuthenticated);
console.log('Has token:', !!spotifyAuth.getAccessToken());

// Test getting playlists
spotifyAPI.getAllPlaylists().then(playlists => {
    console.log('Playlists:', playlists);
});

// Test getting playlist tracks
spotifyAPI.getPlaylistTracks('YOUR_PLAYLIST_ID').then(tracks => {
    console.log('Tracks:', tracks);
});
```

## Still Having Issues?

If none of the above solutions work:

1. **Collect Debug Information:**
   - Open Console (F12)
   - Reproduce the issue
   - Copy all console logs
   - Take screenshots of the error

2. **Check Browser Compatibility:**
   - Recommended: Chrome, Firefox, Safari (latest versions)
   - Clear browser cache and cookies
   - Try in incognito/private mode

3. **Verify Setup:**
   - Confirm Spotify Client ID is configured correctly
   - Confirm Redirect URIs match exactly
   - Check that you're using HTTPS (not HTTP) in production

4. **Report the Issue:**
   - Include browser version and OS
   - Include console logs
   - Describe exact steps to reproduce
   - Mention what you tried from this guide

## Understanding How It Works

The Spotify playlist feature works in several stages:

1. **Authentication**: You sign in with Spotify using OAuth 2.0
2. **Fetch Playlists**: App calls `/me/playlists` to get your playlist list
3. **Display**: Playlists are shown with name, image, track count, owner
4. **On Click**: When you click a playlist:
   - App fetches all tracks from that playlist
   - For each track, it searches JioSaavn for a match
   - Matched tracks are added to the queue
   - Playback starts

**Important Notes:**
- Not all Spotify songs are on JioSaavn
- Matching is done by searching "song name + artist name"
- Match rates vary by playlist content (Indian music = higher match rate)
- The conversion process takes time (about 100ms per track)

## Performance Tips

- **Large playlists (50+ tracks)** will take longer to convert
- **Match rates** are typically 40-70% for international music, 70-90% for Indian music
- **Avoid clicking multiple playlists** rapidly (can cause rate limiting)
- **Use the refresh button** sparingly (max once per minute)

## Privacy & Security

- Your Spotify credentials are NEVER stored by this app
- Only the OAuth access token is stored in your browser's localStorage
- The app only requests READ-ONLY access to playlists
- No data is sent to any server except Spotify's official API and JioSaavn
