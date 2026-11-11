'use strict';

const crypto = require('node:crypto');

// DER prefix that turns a raw 32-byte Ed25519 public key into SPKI.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function publicKeyFromHex(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(hex))) throw new Error('DISCORD_PUBLIC_KEY must be 64 hex characters');
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

// Checks X-Signature-Ed25519 over timestamp + raw body, as Discord documents for
// https://discord.com/developers/docs/interactions/overview#preparing-for-interactions
function verifyInteraction({ rawBody, signature, timestamp, publicKey, maxAgeSeconds = 300, now = Date.now() }) {
  if (typeof signature !== 'string' || !/^[0-9a-fA-F]{128}$/.test(signature)) return false;
  if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > maxAgeSeconds) return false;
  try {
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody)]),
      publicKey,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}

module.exports = { publicKeyFromHex, verifyInteraction };
