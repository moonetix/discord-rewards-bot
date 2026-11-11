'use strict';

const crypto = require('node:crypto');
const { createApp } = require('../src/server');
const { openStore } = require('../src/store');
const vectors = require('./fixtures/moonetix-vectors.json');

// A local key pair stands in for Discord's signing key.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY_HEX = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');

function sign(body, timestamp = String(Math.floor(Date.now() / 1000)), key = privateKey) {
  const signature = crypto.sign(null, Buffer.from(timestamp + body), key).toString('hex');
  return { signature, timestamp };
}

const config = {
  port: 0,
  databasePath: ':memory:',
  siteUrl: 'https://example.com',
  linkAccountUrl: 'https://example.com/account',
  discordPublicKey: PUBLIC_KEY_HEX,
  earnCooldownSeconds: 30,
  currencyName: 'Coins',
  appId: vectors.app_id,
  linkSalt: vectors.link_salt,
  postbackKey: vectors.postback_key,
};

async function startServer(options = {}) {
  const store = openStore(':memory:');
  const server = createApp({ config: { ...config, ...options.config }, store, log: () => {}, now: options.now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
    // Sends a signed interaction, like Discord does.
    async interact(payload, { tamper, key } = {}) {
      const body = JSON.stringify(payload);
      const { signature, timestamp } = sign(body, undefined, key);
      const res = await fetch(base + '/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp },
        body: tamper ? body.replace('"earn"', '"balance"') : body,
      });
      return res;
    },
    postback(url) {
      const u = new URL(url);
      return fetch(base + u.pathname + u.search);
    },
  };
}

function command(name, discordId, inGuild = true) {
  const user = { id: discordId, username: 'member' };
  return {
    id: '1300000000000000001',
    application_id: '1200000000000000000',
    type: 2,
    token: 'interaction-token',
    version: 1,
    data: { id: '1', name, type: 1 },
    ...(inGuild ? { guild_id: '1100000000000000000', member: { user } } : { user }),
  };
}

module.exports = { PUBLIC_KEY_HEX, sign, config, vectors, startServer, command };
