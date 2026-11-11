'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWallLink, postbackHash, parseAmount, formatAmount } = require('../src/moonetix');
const { vectors } = require('./helpers');

// The vectors were produced by the Moonetix link and postback code with the test keys in the file.
test('wall links match the links Moonetix builds and checks', () => {
  for (const [userId, expected] of Object.entries(vectors.walls)) {
    assert.equal(buildWallLink({ appId: vectors.app_id, linkSalt: vectors.link_salt, userId }), expected);
  }
});

test('sub IDs are appended and invalid ones are dropped', () => {
  const url = buildWallLink({ appId: 'a1', linkSalt: 's', userId: '1', subs: { sub1: 'telegram_bot', sub2: 'bad value!', sub9: 'x' } });
  assert.match(url, /&sub1=telegram_bot$/);
});

test('rejects user IDs Moonetix does not accept', () => {
  assert.throws(() => buildWallLink({ appId: 'a1', linkSalt: 's', userId: 'has space' }));
  assert.throws(() => buildWallLink({ appId: 'a1', linkSalt: 's', userId: '' }));
});

test('postback hash matches the Moonetix postback vectors', () => {
  for (const [name, url] of Object.entries(vectors.postbacks)) {
    if (name === 'credit_wrong_key') continue;
    const q = new URL(url).searchParams;
    assert.equal(postbackHash(vectors.postback_key, q.get('tx'), q.get('user'), q.get('reward'), q.get('status')), q.get('hash'), name);
  }
});

test('amounts are exact', () => {
  assert.equal(parseAmount('150'), 150000000);
  assert.equal(parseAmount('0.75'), 750000);
  assert.equal(parseAmount('1.23456'), 1234560);
  assert.equal(parseAmount('-1'), null);
  assert.equal(parseAmount('1e3'), null);
  assert.equal(parseAmount('1.1234567'), null);
  assert.equal(formatAmount(150750000), '150.75');
  assert.equal(formatAmount(-750000), '-0.75');
  assert.equal(formatAmount(0), '0');
});
