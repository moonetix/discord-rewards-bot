'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { vectors, startServer, command, sign } = require('./helpers');
const { EPHEMERAL } = require('../src/commands');

const ANA_DISCORD = '801234567890123456';
const BEN_DISCORD = '801234567890123457';
const KID_DISCORD = '801234567890123458';
const STRANGER = '801234567890123459';

function buttonOf(response) {
  return response.data.components && response.data.components[0].components[0];
}

test('interactions, earn page and postbacks end to end', async (t) => {
  let clock = Date.now();
  const app = await startServer({ now: () => clock });
  t.after(() => app.close());

  const ana = app.store.createAccount({ displayName: 'Ana', is16Plus: true });
  app.store.linkDiscord(ana, ANA_DISCORD);
  const ben = app.store.createAccount({ displayName: 'Ben <b>', is16Plus: true });
  app.store.linkDiscord(ben, BEN_DISCORD);
  const kid = app.store.createAccount({ displayName: 'Kid', is16Plus: false });
  app.store.linkDiscord(kid, KID_DISCORD);
  assert.deepEqual([ana, ben, kid], [1, 2, 3]);

  const balanceText = async (discordId) => (await (await app.interact(command('balance', discordId))).json()).data.content;

  await t.test('answers PING with PONG', async () => {
    const res = await app.interact({ type: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 1 });
  });

  await t.test('bad signatures get 401', async () => {
    let res = await app.interact(command('earn', ANA_DISCORD), { tamper: true });
    assert.equal(res.status, 401);
    res = await app.interact({ type: 1 }, { key: crypto.generateKeyPairSync('ed25519').privateKey });
    assert.equal(res.status, 401);
    res = await fetch(app.base + '/interactions', { method: 'POST', body: '{"type":1}' });
    assert.equal(res.status, 401);
  });

  let earnUrl;
  await t.test('/earn replies ephemerally with a button to the earn page', async () => {
    const res = await app.interact(command('earn', ANA_DISCORD));
    const body = await res.json();
    assert.equal(body.type, 4);
    assert.equal(body.data.flags & EPHEMERAL, EPHEMERAL);
    assert.deepEqual(body.data.allowed_mentions, { parse: [] });
    const button = buttonOf(body);
    assert.equal(button.style, 5);
    assert.match(button.url, /^https:\/\/example\.com\/earn\?code=[A-Za-z0-9_-]{43}$/);
    assert.ok(button.url.length <= 512);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('wall.moonetix.com'), 'no offerwall link in Discord');
    assert.ok(!raw.includes(ANA_DISCORD), 'no Discord ID in the reply');
    earnUrl = new URL(button.url);
  });

  await t.test('/earn has a per-member cooldown', async () => {
    const body = await (await app.interact(command('earn', ANA_DISCORD))).json();
    assert.equal(body.data.flags, EPHEMERAL);
    assert.equal(buttonOf(body), undefined);
    assert.match(body.data.content, /Try again/);
    clock += 31000;
  });

  await t.test('unlinked and under-16 members get no earn link', async () => {
    let body = await (await app.interact(command('earn', STRANGER))).json();
    assert.equal(body.data.flags, EPHEMERAL);
    assert.equal(buttonOf(body).url, 'https://example.com/account');
    body = await (await app.interact(command('earn', KID_DISCORD))).json();
    assert.match(body.data.content, /16/);
    assert.equal(buttonOf(body).url, 'https://example.com/account');
    body = await (await app.interact(command('balance', STRANGER))).json();
    assert.equal(buttonOf(body).url, 'https://example.com/account');
  });

  let cookie;
  await t.test('the earn code signs in once and the page builds the signed link', async () => {
    let res = await fetch(app.base + earnUrl.pathname + earnUrl.search, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/earn');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    cookie = setCookie.split(';')[0];

    res = await fetch(app.base + '/earn', { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    const signed = vectors.walls['1'] + '&sub1=discord';
    assert.ok(html.includes(signed.replace(/&/g, '&amp;')), 'signed link for site account 1');
    assert.ok(!html.includes(ANA_DISCORD));
    assert.ok(!html.includes(vectors.link_salt));
    assert.match(res.headers.get('content-security-policy'), /frame-src https:\/\/wall\.moonetix\.com/);

    res = await fetch(app.base + earnUrl.pathname + earnUrl.search, { redirect: 'manual' });
    assert.equal(res.status, 400, 'code is single use');
    res = await fetch(app.base + '/earn');
    assert.equal(res.status, 401, 'no session, no wall');
    res = await fetch(app.base + '/earn', { headers: { Cookie: 'earn_session=forged' } });
    assert.equal(res.status, 401);
  });

  await t.test('real postbacks: credit once, reverse once', async () => {
    const pb = vectors.postbacks;
    let res = await app.postback(pb.credit_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'credited');
    res = await app.postback(pb.credit_150);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await balanceText(ANA_DISCORD), 'Your balance: 150 Coins.');

    assert.equal(await (await app.postback(pb.credit_decimal)).text(), 'credited');
    assert.equal(await (await app.postback(pb.credit_five_decimals)).text(), 'credited');
    assert.equal(await balanceText(ANA_DISCORD), 'Your balance: 151.98456 Coins.');

    res = await app.postback(pb.reverse_150);
    assert.equal(await res.text(), 'reversed');
    assert.equal(await (await app.postback(pb.reverse_150)).text(), 'duplicate');
    assert.equal(await (await app.postback(pb.credit_150)).text(), 'duplicate');
    assert.equal(await balanceText(ANA_DISCORD), 'Your balance: 1.98456 Coins.');

    assert.equal(await (await app.postback(pb.credit_user2)).text(), 'credited');
    assert.equal(await balanceText(BEN_DISCORD), 'Your balance: 40 Coins.');

    assert.equal(await (await app.postback(pb.reverse_never_credited)).text(), 'not_credited');
    assert.equal(await (await app.postback(pb.reverse_other_user)).text(), 'user_mismatch');
    assert.equal(await (await app.postback(pb.credit_test_user)).text(), 'ignored: unknown user');
    assert.equal(await (await app.postback(pb.credit_missing_account)).text(), 'unknown_user');
    assert.equal(await balanceText(ANA_DISCORD), 'Your balance: 1.98456 Coins.');
  });

  await t.test('tampered and wrongly signed postbacks get 403', async () => {
    const base = new URL(vectors.postbacks.credit_user2);
    for (const [key, value] of [['reward', '4000'], ['user', '1'], ['tx', 'tx_x'], ['status', '2'], ['hash', '']]) {
      const u = new URL(base);
      u.searchParams.set(key, value);
      assert.equal((await app.postback(u.toString())).status, 403, `${key}=${value}`);
    }
    assert.equal((await app.postback(vectors.postbacks.credit_wrong_key)).status, 403);
    assert.equal(await balanceText(BEN_DISCORD), 'Your balance: 40 Coins.');
  });

  await t.test('the earn page shows the updated balance and history, escaped', async () => {
    const html = await (await fetch(app.base + '/earn', { headers: { Cookie: cookie } })).text();
    assert.match(html, /1\.98456 <span>Coins<\/span>/);
    assert.match(html, /Bigo Live &amp; &quot;Friends&quot;/);
    assert.match(html, /reversed/);
  });

  await t.test('sign out ends the session', async () => {
    const res = await fetch(app.base + '/logout', { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal((await fetch(app.base + '/earn', { headers: { Cookie: cookie } })).status, 401);
  });

  await t.test('signed requests with an unknown interaction type get 400', async () => {
    const body = JSON.stringify({ type: 3 });
    const { signature, timestamp } = sign(body);
    const res = await fetch(app.base + '/interactions', {
      method: 'POST',
      headers: { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp },
      body,
    });
    assert.equal(res.status, 400);
  });
});

test('account links are one to one', async () => {
  const { openStore } = require('../src/store');
  const store = openStore(':memory:');
  const a = store.createAccount({ displayName: 'A', is16Plus: true });
  const b = store.createAccount({ displayName: 'B', is16Plus: true });
  store.linkDiscord(a, ANA_DISCORD);
  assert.throws(() => store.linkDiscord(b, ANA_DISCORD));
  assert.throws(() => store.linkDiscord(a, BEN_DISCORD));
  store.close();
});

test('expired earn codes do not sign in', async () => {
  const { openStore } = require('../src/store');
  const store = openStore(':memory:');
  const a = store.createAccount({ displayName: 'A', is16Plus: true });
  const code = store.createLoginCode(a, -1);
  assert.equal(store.redeemLoginCode(code), null);
  assert.equal(store.redeemLoginCode('nope'), null);
  store.close();
});
