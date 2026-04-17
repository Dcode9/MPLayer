const fsSync = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const {spawn} = require('node:child_process');
const {google} = require('googleapis');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOTENV_PATH = path.join(PROJECT_ROOT, '.env');

const loadLocalEnv = () => {
  if (!fsSync.existsSync(DOTENV_PATH)) {
    return;
  }

  const raw = fsSync.readFileSync(DOTENV_PATH, 'utf-8');
  const lines = raw.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

const DEFAULT_PORT = Number(process.env.YOUTUBE_OAUTH_PORT || 53682);
const DEFAULT_REDIRECT_URI = process.env.YOUTUBE_OAUTH_REDIRECT_URI || `http://127.0.0.1:${DEFAULT_PORT}`;
const OUTPUT_PATH = process.env.YOUTUBE_OAUTH_OUTPUT_JSON || 'data/phase7-youtube-oauth.json';
const AUTO_OPEN = String(process.env.YOUTUBE_OAUTH_AUTO_OPEN || 'true').toLowerCase() !== 'false';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
];

const parseArgs = (argv) => {
  const options = {
    manual: String(process.env.YOUTUBE_OAUTH_MANUAL || '').toLowerCase() === 'true',
    code: process.env.YOUTUBE_OAUTH_CODE || '',
    saveToEnv: String(process.env.YOUTUBE_OAUTH_SAVE_TO_ENV || 'true').toLowerCase() !== 'false',
  };

  for (const arg of argv) {
    if (arg === '--manual') {
      options.manual = true;
    } else if (arg === '--no-save-env') {
      options.saveToEnv = false;
    } else if (arg.startsWith('--code=')) {
      options.code = arg.slice('--code='.length).trim();
    }
  }

  return options;
};

const getAuthEnv = () => {
  return {
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
  };
};

const fillMissingAuthEnv = async (authEnv) => {
  const next = {...authEnv};

  if (!next.clientId) {
    next.clientId = await askUserInput('[phase-7] Enter YOUTUBE_CLIENT_ID: ');
  }

  if (!next.clientSecret) {
    next.clientSecret = await askUserInput('[phase-7] Enter YOUTUBE_CLIENT_SECRET: ');
  }

  return next;
};

const ensureAuthConfigured = ({clientId, clientSecret}) => {
  const missing = [];
  if (!clientId) missing.push('YOUTUBE_CLIENT_ID');
  if (!clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new Error(`Missing required OAuth credentials: ${missing.join(', ')}`);
  }
};

const resolveProjectPath = (targetPath) => {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.join(PROJECT_ROOT, targetPath);
};

const askUserInput = (promptText) => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(promptText, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
};

const parseAuthCode = (rawInput) => {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('code=')) {
    try {
      const parsedUrl = new URL(trimmed);
      return parsedUrl.searchParams.get('code') || '';
    } catch (error) {
      const codeMatch = trimmed.match(/[?&]code=([^&]+)/);
      if (codeMatch?.[1]) {
        return decodeURIComponent(codeMatch[1]);
      }
    }
  }

  return trimmed;
};

const openBrowser = (url) => {
  if (process.env.BROWSER) {
    const parseCommand = (raw) => {
      return String(raw || '')
        .trim()
        .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
        ?.map((part) => part.replace(/^['"]|['"]$/g, '')) || [];
    };

    try {
      const pieces = parseCommand(process.env.BROWSER);
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

      const child = spawn(process.env.BROWSER, [url], {detached: true, stdio: 'ignore'});
      child.unref();
      return true;
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

const buildAuthUrl = ({oauth2Client, state}) => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
};

const waitForCode = ({redirectUri}) => {
  const redirectUrl = new URL(redirectUri);
  const expectedPath = redirectUrl.pathname || '/';
  const host = redirectUrl.hostname === 'localhost' ? '127.0.0.1' : redirectUrl.hostname;
  const port = Number(redirectUrl.port || '80');
  const stateStore = new Map();

  let server;
  const promise = new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);

        if (requestUrl.pathname !== expectedPath) {
          res.writeHead(404, {'Content-Type': 'text/plain'});
          res.end('Not found');
          return;
        }

        if (requestUrl.searchParams.has('error')) {
          const error = requestUrl.searchParams.get('error');
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end(`Authorization failed: ${error}`);
          reject(new Error(`Authorization failed: ${error}`));
          server.close();
          return;
        }

        const code = requestUrl.searchParams.get('code');
        const returnedState = requestUrl.searchParams.get('state');
        if (!code) {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end('Missing authorization code');
          reject(new Error('Missing authorization code'));
          server.close();
          return;
        }

        if (!stateStore.has(returnedState)) {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end('Invalid state');
          reject(new Error('Invalid OAuth state')); 
          server.close();
          return;
        }

        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Authorization complete. You can close this tab and return to the terminal.');
        resolve(code);
        server.close();
      } catch (error) {
        reject(error);
        if (server) {
          server.close();
        }
      }
    });

    server.on('error', reject);
    server.listen(port, host, () => {
      stateStore.set('ready', true);
    });
  });

  return {
    promise,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    stateStore,
  };
};

const writeOutput = async ({outputPath, payload}) => {
  await fsp.mkdir(path.dirname(outputPath), {recursive: true});
  await fsp.writeFile(outputPath, JSON.stringify(payload, null, 2));
};

const upsertEnvFile = async (updates) => {
  const lines = [];
  let original = '';

  try {
    original = await fsp.readFile(DOTENV_PATH, 'utf-8');
  } catch (error) {
    original = '';
  }

  if (original) {
    lines.push(...original.split(/\r?\n/));
  }

  const keyToLineIndex = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) {
      keyToLineIndex.set(match[1], i);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!key) {
      continue;
    }

    const safeValue = String(value || '').replace(/[\r\n]+/g, '').trim();
    const nextLine = `${key}=${safeValue}`;

    if (keyToLineIndex.has(key)) {
      const existingIndex = keyToLineIndex.get(key);
      lines[existingIndex] = nextLine;
    } else {
      lines.push(nextLine);
      keyToLineIndex.set(key, lines.length - 1);
    }
  }

  const output = `${lines.filter((line, index) => index !== lines.length - 1 || line !== '').join('\n')}\n`;
  await fsp.writeFile(DOTENV_PATH, output, 'utf-8');
};

const getCodeFromLocalServer = async ({redirectUri, state}) => {
  const listener = waitForCode({redirectUri});
  listener.stateStore.set(state, true);
  return listener.promise;
};

const getCodeManually = async ({authUrl}) => {
  console.log('[phase-7] Manual mode enabled.');
  console.log('[phase-7] After consent, copy the full redirected URL (or just the code) and paste it below.');
  console.log('[phase-7] Tip: if localhost callback cannot reach this container, manual mode still works.');
  console.log('');
  console.log('[phase-7] Authorization URL:');
  console.log(authUrl);

  const userInput = await askUserInput('[phase-7] Paste redirect URL or code: ');
  const code = parseAuthCode(userInput);
  if (!code) {
    throw new Error('Authorization code was not provided.');
  }

  return code;
};

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const authEnv = await fillMissingAuthEnv(getAuthEnv());
    ensureAuthConfigured(authEnv);

    const oauth2Client = new google.auth.OAuth2(authEnv.clientId, authEnv.clientSecret, DEFAULT_REDIRECT_URI);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = buildAuthUrl({oauth2Client, state});

    console.log('[phase-7] OAuth scope: https://www.googleapis.com/auth/youtube.upload');
    console.log(`[phase-7] Redirect URI: ${DEFAULT_REDIRECT_URI}`);
    console.log('[phase-7] Open the following URL and approve access:');
    console.log(authUrl);

    if (AUTO_OPEN) {
      openBrowser(authUrl);
    }

    let code = parseAuthCode(options.code);
    if (!code) {
      if (options.manual) {
        code = await getCodeManually({authUrl});
      } else {
        code = await getCodeFromLocalServer({redirectUri: DEFAULT_REDIRECT_URI, state});
      }
    }

    const {tokens} = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const refreshToken = tokens.refresh_token || null;
    const outputPayload = {
      generatedAt: new Date().toISOString(),
      redirectUri: DEFAULT_REDIRECT_URI,
      scope: SCOPES,
      tokens: {
        access_token: tokens.access_token || null,
        refresh_token: refreshToken,
        expiry_date: tokens.expiry_date || null,
        token_type: tokens.token_type || null,
      },
    };

    if (refreshToken) {
      console.log('');
      console.log(`[phase-7] Refresh token: ${refreshToken}`);
    } else {
      console.log('');
      console.log('[phase-7] No refresh_token was returned. Revoke the app access and rerun with prompt=consent.');
    }

    if (OUTPUT_PATH) {
      const resolvedOutput = resolveProjectPath(OUTPUT_PATH);
      await writeOutput({outputPath: resolvedOutput, payload: outputPayload});
      console.log(`[phase-7] OAuth payload written to: ${path.relative(PROJECT_ROOT, resolvedOutput)}`);
    }

    if (options.saveToEnv) {
      await upsertEnvFile({
        YOUTUBE_CLIENT_ID: authEnv.clientId,
        YOUTUBE_CLIENT_SECRET: authEnv.clientSecret,
        YOUTUBE_REFRESH_TOKEN: refreshToken || process.env.YOUTUBE_REFRESH_TOKEN || '',
      });
      console.log('[phase-7] Updated .env with YouTube OAuth variables.');
    }
  } catch (error) {
    console.error('[phase-7] OAuth helper failed:', error.message || error);
    process.exit(1);
  }
};

main();
