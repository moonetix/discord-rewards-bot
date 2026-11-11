'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { openStore } = require('./store');
const { publicKeyFromHex, verifyInteraction } = require('./discord');
const { createInteractionHandler } = require('./commands');
const { buildWallLink } = require('./moonetix');
const { handlePostback } = require('./postback');
const { earnPage, messagePage } = require('./earn-page');

const COOKIE = 'earn_session';
const SESSION_SECONDS = 86400;
const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  'frame-src https://wall.moonetix.com',
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

function createApp({ config, store, log = defaultLog, now }) {
  const publicKey = publicKeyFromHex(config.discordPublicKey);
  const handleInteraction = createInteractionHandler({ config, store, now });
  const secureCookie = config.siteUrl.startsWith('https://');
  const ctx = { config, store, log, publicKey, handleInteraction, secureCookie };

  return http.createServer(async (req, res) => {
    try {
      await route(req, res, ctx);
    } catch (err) {
      if (err && err.statusCode) return sendText(res, err.statusCode, err.message);
      log('unhandled error', { error: err && err.message });
      sendText(res, 500, 'server error');
    }
  });
}

async function route(req, res, ctx) {
  const { config, store, log } = ctx;
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/interactions') {
    const rawBody = await readBody(req, 65536);
    const ok = verifyInteraction({
      rawBody,
      signature: req.headers['x-signature-ed25519'],
      timestamp: req.headers['x-signature-timestamp'],
      publicKey: ctx.publicKey,
    });
    // Discord expects 401 for a bad signature.
    if (!ok) return sendText(res, 401, 'invalid request signature');
    let interaction;
    try {
      interaction = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return sendText(res, 400, 'invalid json');
    }
    const response = ctx.handleInteraction(interaction);
    if (!response) return sendText(res, 400, 'unsupported interaction');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(response));
  }

  if (req.method === 'GET' && url.pathname === '/moonetix/postback') {
    const { code, body } = handlePostback(url.searchParams, { postbackKey: config.postbackKey, store, log });
    return sendText(res, code, body);
  }

  if (req.method === 'GET' && url.pathname === '/earn') {
    const code = url.searchParams.get('code');
    if (code !== null) {
      const accountId = store.redeemLoginCode(code);
      if (!accountId) {
        return sendHtml(res, 400, messagePage('Link expired', 'This link was already used or is too old. Run /earn in Discord to get a new one.'));
      }
      const token = store.createSession(accountId, SESSION_SECONDS);
      // Redirect so the code does not stay in the address bar or the history.
      res.writeHead(303, {
        Location: '/earn',
        'Set-Cookie': cookie(COOKIE, token, SESSION_SECONDS, ctx.secureCookie),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      return res.end();
    }

    const account = store.accountBySession(readCookie(req, COOKIE));
    if (!account) {
      return sendHtml(res, 401, messagePage('Sign in', 'Run /earn in Discord to open your earn page.'));
    }
    if (!account.is_16_plus) {
      return sendHtml(res, 403, messagePage('Not available', 'Earning is open to members aged 16 and over with a verified account.'));
    }
    // The signed link is built here, on the server, from YOUR account ID.
    const wallUrl = buildWallLink({
      appId: config.appId,
      linkSalt: config.linkSalt,
      userId: String(account.id),
      subs: { sub1: 'discord' },
    });
    const recent = store.recentTransactions(account.id, 10);
    return sendHtml(res, 200, earnPage({ account, wallUrl, recent, currency: config.currencyName }));
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    store.deleteSession(readCookie(req, COOKIE));
    res.writeHead(303, { Location: '/earn', 'Set-Cookie': cookie(COOKIE, '', 0, ctx.secureCookie) });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/earn.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'public', 'earn.css')));
  }

  sendText(res, 404, 'not found');
}

function cookie(name, value, maxAge, secure) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function sendHtml(res, code, html) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': PAGE_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function defaultLog(message, data) {
  console.log(new Date().toISOString(), message, data ? JSON.stringify(data) : '');
}

if (require.main === module) {
  const config = loadConfig();
  const store = openStore(config.databasePath);
  createApp({ config, store }).listen(config.port, () => {
    console.log(`Listening on port ${config.port}`);
  });
}

module.exports = { createApp };
