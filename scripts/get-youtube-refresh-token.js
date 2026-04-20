#!/usr/bin/env node
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const {spawn} = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.YOUTUBE_OAUTH_PORT || 53682);
const DEFAULT_REDIRECT_URI = process.env.YOUTUBE_OAUTH_REDIRECT_URI || `http://127.0.0.1:${DEFAULT_PORT}`;
const DEFAULT_SCOPE = process.env.YOUTUBE_OAUTH_SCOPE || 'https://www.googleapis.com/auth/youtube.upload';
const DEFAULT_TIMEOUT_MS = Number(process.env.YOUTUBE_OAUTH_TIMEOUT_MS || 300000);
const DEFAULT_ENV_PATH = path.join(PROJECT_ROOT, '.env');

const usage = () => {
  console.log('Usage: node scripts/get-youtube-refresh-token.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --manual                Paste redirect URL/code manually instead of local callback listener');
  console.log('  --no-open               Do not auto-open browser');
  console.log('  --save-env              Save YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN to .env');
  console.log('  --client-id=<id>        OAuth client id (fallback: env/.env YOUTUBE_CLIENT_ID)');
  console.log('  --client-secret=<sec>   OAuth client secret (fallback: env/.env YOUTUBE_CLIENT_SECRET)');
  console.log('  --redirect-uri=<uri>    Redirect URI (default: http://127.0.0.1:53682)');
  console.log('  --scope=<scope>         OAuth scope (default: youtube.upload)');
  console.log('  --code=<code_or_url>    Skip browser/listener and exchange this code directly');
  console.log('  --env-file=<path>       Env file path for --save-env (default: .env)');
  console.log('  --help                  Show this help');
};

const loadDotEnv = (envPath) => {
  if (!fsSync.existsSync(envPath)) {
    return;
  }

  const raw = fsSync.readFileSync(envPath, 'utf-8');
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
};

const ask = (question) => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
};

const parseBrowserCommand = (raw) => {
  return String(raw || '')
    .trim()
    .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
    ?.map((part) => part.replace(/^['"]|['"]$/g, '')) || [];
};

const openBrowser = (url) => {
  if (process.env.BROWSER) {
    try {
      const pieces = parseBrowserCommand(process.env.BROWSER);
      if (pieces.length > 0) {
        const command = pieces[0];
        let args = pieces.slice(1);

        if (args.some((arg) => arg.includes('%s'))) {
          args = args.map((arg) => arg.replace(/%s/g, url));
        } else {
          args.push(url);
        }

        const child = spawn(command, args, {detached: true, stdio: 'ignore'});
        child.unref();
        return true;
      }
    } catch (error) {
      return false;
    }
  }

  const platform = process.platform;
  let command;
  let args = [];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {detached: true, stdio: 'ignore'});
    child.unref();
    return true;
  } catch (error) {
    return false;
  }
};

const parseAuthCode = (input) => {
  const raw = String(input || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.includes('code=')) {
    try {
      const parsed = new URL(raw);
      return parsed.searchParams.get('code') || '';
    } catch (error) {
      const match = raw.match(/[?&]code=([^&]+)/);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  }

  return raw;
};

const buildAuthUrl = ({clientId, redirectUri, scope, state}) => {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
};

const waitForCode = ({redirectUri, state, timeoutMs}) => {
  const redirect = new URL(redirectUri);
  const host = redirect.hostname === 'localhost' ? '127.0.0.1' : redirect.hostname;
  const port = Number(redirect.port || (redirect.protocol === 'https:' ? '443' : '80'));
  const expectedPath = redirect.pathname || '/';

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close(() => fn(value));
    };

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);
        if (reqUrl.pathname !== expectedPath) {
          res.writeHead(404, {'Content-Type': 'text/plain'});
          res.end('Not found');
          return;
        }

        const err = reqUrl.searchParams.get('error');
        if (err) {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end(`Authorization failed: ${err}`);
          done(reject, new Error(`Authorization failed: ${err}`));
          return;
        }

        const returnedState = reqUrl.searchParams.get('state');
        if (returnedState !== state) {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end('Invalid state');
          done(reject, new Error('Invalid OAuth state'));
          return;
        }

        const code = reqUrl.searchParams.get('code');
        if (!code) {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end('Missing authorization code');
          done(reject, new Error('Missing authorization code'));
          return;
        }

        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Authorization complete. You can close this tab and return to the terminal.');
        done(resolve, code);
      } catch (error) {
        done(reject, error);
      }
    });

    server.on('error', (error) => done(reject, error));
    server.listen(port, host, () => {
      console.log(`[oauth] Listening on ${host}:${port}${expectedPath}`);
    });

    const timer = setTimeout(() => {
      done(reject, new Error(`Timed out waiting for OAuth callback after ${timeoutMs} ms`));
    }, timeoutMs);
  });
};

const exchangeCode = async ({code, clientId, clientSecret, redirectUri}) => {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body,
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Token endpoint returned non-JSON response (${response.status}): ${text}`);
  }

  if (!response.ok) {
    const providerError = payload?.error_description || payload?.error || text;
    throw new Error(`Token exchange failed (${response.status}): ${providerError}`);
  }

  return payload;
};

const upsertEnv = async (envPath, updates) => {
  let lines = [];
  try {
    const original = await fs.readFile(envPath, 'utf-8');
    lines = original.split(/\r?\n/);
  } catch (error) {
    lines = [];
  }

  const indexByKey = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) {
      indexByKey.set(match[1], i);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    const safeValue = String(value || '').replace(/[\r\n]+/g, '').trim();
    const next = `${key}=${safeValue}`;
    if (indexByKey.has(key)) {
      lines[indexByKey.get(key)] = next;
    } else {
      lines.push(next);
      indexByKey.set(key, lines.length - 1);
    }
  }

  const output = `${lines.filter((line, idx) => idx !== lines.length - 1 || line !== '').join('\n')}\n`;
  await fs.mkdir(path.dirname(envPath), {recursive: true});
  await fs.writeFile(envPath, output, 'utf-8');
};

const parseArgs = (argv) => {
  const options = {
    manual: false,
    noOpen: false,
    saveEnv: false,
    code: '',
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    redirectUri: DEFAULT_REDIRECT_URI,
    scope: DEFAULT_SCOPE,
    envFile: DEFAULT_ENV_PATH,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--manual') {
      options.manual = true;
    } else if (arg === '--no-open') {
      options.noOpen = true;
    } else if (arg === '--save-env') {
      options.saveEnv = true;
    } else if (arg.startsWith('--code=')) {
      options.code = arg.slice('--code='.length).trim();
    } else if (arg.startsWith('--client-id=')) {
      options.clientId = arg.slice('--client-id='.length).trim();
    } else if (arg.startsWith('--client-secret=')) {
      options.clientSecret = arg.slice('--client-secret='.length).trim();
    } else if (arg.startsWith('--redirect-uri=')) {
      options.redirectUri = arg.slice('--redirect-uri='.length).trim();
    } else if (arg.startsWith('--scope=')) {
      options.scope = arg.slice('--scope='.length).trim();
    } else if (arg.startsWith('--env-file=')) {
      const rawPath = arg.slice('--env-file='.length).trim();
      options.envFile = path.isAbsolute(rawPath) ? rawPath : path.join(PROJECT_ROOT, rawPath);
    }
  }

  return options;
};

const main = async () => {
  loadDotEnv(DEFAULT_ENV_PATH);

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  if (!options.clientId) {
    options.clientId = await ask('[oauth] Enter YOUTUBE_CLIENT_ID: ');
  }
  if (!options.clientSecret) {
    options.clientSecret = await ask('[oauth] Enter YOUTUBE_CLIENT_SECRET: ');
  }

  if (!options.clientId || !options.clientSecret) {
    throw new Error('Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = buildAuthUrl({
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    scope: options.scope,
    state,
  });

  console.log(`[oauth] Redirect URI: ${options.redirectUri}`);
  console.log(`[oauth] Scope: ${options.scope}`);
  console.log('[oauth] Authorization URL:');
  console.log(authUrl);

  let code = parseAuthCode(options.code);

  if (!code) {
    if (!options.manual) {
      if (!options.noOpen) {
        openBrowser(authUrl);
      }
      code = await waitForCode({
        redirectUri: options.redirectUri,
        state,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } else {
      if (!options.noOpen) {
        openBrowser(authUrl);
      }
      const pasted = await ask('[oauth] Paste full redirect URL (or just code): ');
      code = parseAuthCode(pasted);
    }
  }

  if (!code) {
    throw new Error('Authorization code was not provided');
  }

  const tokenPayload = await exchangeCode({
    code,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: options.redirectUri,
  });

  const refreshToken = tokenPayload.refresh_token || '';
  if (refreshToken) {
    console.log('');
    console.log(`[oauth] Refresh token:\n${refreshToken}`);
  } else {
    console.log('');
    console.log('[oauth] No refresh_token returned. Revoke app access and retry with consent prompt.');
  }

  if (options.saveEnv) {
    await upsertEnv(options.envFile, {
      YOUTUBE_CLIENT_ID: options.clientId,
      YOUTUBE_CLIENT_SECRET: options.clientSecret,
      YOUTUBE_REFRESH_TOKEN: refreshToken,
    });
    console.log(`[oauth] Updated env file: ${path.relative(PROJECT_ROOT, options.envFile) || '.env'}`);
  }
};

main().catch((error) => {
  console.error(`[oauth] Failed: ${error.message || error}`);
  process.exit(1);
});
