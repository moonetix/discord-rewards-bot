'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { publicKeyFromHex, verifyInteraction } = require('../src/discord');
const { PUBLIC_KEY_HEX, sign } = require('./helpers');

const key = publicKeyFromHex(PUBLIC_KEY_HEX);
const body = '{"type":1}';

test('accepts a valid Ed25519 signature', () => {
  const { signature, timestamp } = sign(body);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature, timestamp, publicKey: key }), true);
});

test('rejects a changed body, timestamp or signature', () => {
  const { signature, timestamp } = sign(body);
  assert.equal(verifyInteraction({ rawBody: Buffer.from('{"type":2}'), signature, timestamp, publicKey: key }), false);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature, timestamp: String(Number(timestamp) + 1), publicKey: key }), false);
  const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature: flipped, timestamp, publicKey: key }), false);
});

test('rejects a signature from another key', () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const { signature, timestamp } = sign(body, undefined, other);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature, timestamp, publicKey: key }), false);
});

test('rejects missing or malformed headers', () => {
  const { signature, timestamp } = sign(body);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature: undefined, timestamp, publicKey: key }), false);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature: 'zz', timestamp, publicKey: key }), false);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature, timestamp: undefined, publicKey: key }), false);
});

test('rejects old timestamps (replays)', () => {
  const old = String(Math.floor(Date.now() / 1000) - 600);
  const { signature } = sign(body, old);
  assert.equal(verifyInteraction({ rawBody: Buffer.from(body), signature, timestamp: old, publicKey: key }), false);
});

test('rejects a malformed public key', () => {
  assert.throws(() => publicKeyFromHex('abc'));
});
