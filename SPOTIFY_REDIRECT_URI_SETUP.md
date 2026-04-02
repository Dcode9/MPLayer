# Spotify Redirect URI Configuration

## Issue: "redirect_uri: Not matching configuration"

This error occurs when the redirect URI sent in the OAuth request doesn't match exactly what's configured in your Spotify Developer Dashboard.

## Current Redirect URIs

The application uses these redirect URIs:

1. **Root application** (`/index.html`): `https://play.dverse.fun/index.html`
2. **Home application** (`/home/index.html`): `https://play.dverse.fun/home/index.html`

## How to Configure in Spotify Developer Dashboard

### Step 1: Access Your Spotify App Settings

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click on your app (or create a new one)
3. Click on **"Settings"** button

### Step 2: Add Redirect URIs

In the **Redirect URIs** section, add **BOTH** of these URIs **EXACTLY** as shown:

```
https://play.dverse.fun/index.html
https://play.dverse.fun/home/index.html
```

**Important Notes:**

- ✅ **Include the full path** including the HTML file name
- ✅ **Use HTTPS** (not HTTP) for production
- ✅ **No trailing slashes**
- ✅ **Match the protocol exactly** (https:// vs http://)
- ✅ **Match the domain exactly** (including subdomains)
- ✅ **Match the path exactly** (case-sensitive)

### Step 3: Save Changes

1. Click **"Add"** after entering each URI
2. Click **"Save"** at the bottom of the page
3. Wait a few seconds for changes to propagate

### For Local Development

If you're testing locally, also add these URIs:

```
http://localhost:8000/index.html
http://localhost:8000/home/index.html
```

Or adjust the port number if you're using a different local server port.

## Troubleshooting

### Still Getting "redirect_uri: Not matching configuration"?

1. **Check for typos**: The URI must match EXACTLY character-by-character
2. **Check protocol**: Make sure you're using `https://` not `http://` (or vice versa)
3. **Check trailing slashes**: The URIs should NOT have trailing slashes
4. **Check path**: Make sure `/index.html` or `/home/index.html` is included
5. **Wait**: Sometimes it takes a minute for Spotify to sync changes
6. **Clear cache**: Try clearing browser cache and localStorage
7. **Check URL in browser**: Make sure you're actually accessing the URL that matches the redirect URI

### Common Mistakes

❌ `https://play.dverse.fun` (missing the HTML file)
❌ `https://play.dverse.fun/` (trailing slash)
❌ `http://play.dverse.fun/index.html` (wrong protocol)
❌ `https://play.dverse.fun/Index.html` (wrong case)
❌ `https://play.dverse.fun/home` (missing the HTML file)

✅ `https://play.dverse.fun/index.html` (correct)
✅ `https://play.dverse.fun/home/index.html` (correct)

## Updating Redirect URI in Code

If you need to change the redirect URI (e.g., for a different domain):

### For Root Application (`/index.html`)

Edit line 752 in `/index.html`:

```javascript
redirectUri: 'https://your-domain.com/index.html',
```

### For Home Application (`/home/index.html`)

Edit line 9 in `/home/js/spotify-auth.js`:

```javascript
redirectUri: 'https://your-domain.com/home/index.html',
```

**Important**: After changing the redirect URI in code, you MUST also update it in your Spotify Developer Dashboard!

## Why This Error Happens

Spotify requires the redirect URI to match EXACTLY for security reasons. This prevents attackers from:
- Intercepting OAuth tokens
- Redirecting users to malicious sites
- Stealing user credentials

The redirect URI acts as a security whitelist - only URLs you explicitly approve can receive the OAuth response.

## Related Files

- `/index.html` - Line 752 (spotifyManager.redirectUri)
- `/home/js/spotify-auth.js` - Line 9 (spotifyAuth.redirectUri)
- `SPOTIFY_SETUP.md` - General Spotify setup documentation

## Support

If you continue to have issues:
1. Double-check all URIs match exactly
2. Try removing and re-adding the URIs in Spotify Dashboard
3. Verify your app is using the correct Client ID
4. Check browser console for additional error messages
