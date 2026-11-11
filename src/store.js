'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Only hashes of codes and session tokens are stored.
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);

function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    -- Accounts on YOUR site. Their id is the user_id the offerwall sees.
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      is_16_plus INTEGER NOT NULL DEFAULT 0,
      balance_micro INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Filled by your Discord OAuth2 account linking. Never sent to Moonetix.
    CREATE TABLE IF NOT EXISTS discord_links (
      discord_id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_codes (
      code_hash TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moonetix_transactions (
      transaction_id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      reward_micro INTEGER NOT NULL,
      status INTEGER NOT NULL CHECK (status IN (1, 2)),
      offer_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS moonetix_transactions_account ON moonetix_transactions (account_id, updated_at);
  `);

  const q = {
    insertAccount: db.prepare('INSERT INTO accounts (display_name, is_16_plus) VALUES (?, ?)'),
    byId: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    byDiscord: db.prepare('SELECT a.* FROM discord_links l JOIN accounts a ON a.id = l.account_id WHERE l.discord_id = ?'),
    linkOf: db.prepare('SELECT * FROM discord_links WHERE discord_id = ? OR account_id = ?'),
    insertLink: db.prepare('INSERT INTO discord_links (discord_id, account_id) VALUES (?, ?)'),
    insertCode: db.prepare('INSERT INTO login_codes (code_hash, account_id, expires_at) VALUES (?, ?, ?)'),
    takeCode: db.prepare('DELETE FROM login_codes WHERE code_hash = ? RETURNING account_id, expires_at'),
    purgeCodes: db.prepare('DELETE FROM login_codes WHERE expires_at < ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at >= ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    addBalance: db.prepare('UPDATE accounts SET balance_micro = balance_micro + ? WHERE id = ?'),
    getTx: db.prepare('SELECT * FROM moonetix_transactions WHERE transaction_id = ?'),
    insertTx: db.prepare(`INSERT INTO moonetix_transactions (transaction_id, account_id, reward_micro, status, offer_name)
      VALUES (?, ?, ?, 1, ?) ON CONFLICT (transaction_id) DO NOTHING`),
    reverseTx: db.prepare("UPDATE moonetix_transactions SET status = 2, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ? AND status = 1"),
    recent: db.prepare(`SELECT transaction_id, reward_micro, status, offer_name, updated_at FROM moonetix_transactions
      WHERE account_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?`),
  };

  function inTransaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    createAccount({ displayName, is16Plus }) {
      return Number(q.insertAccount.run(String(displayName), is16Plus ? 1 : 0).lastInsertRowid);
    },

    getAccount(id) {
      return q.byId.get(id) || null;
    },

    accountByDiscordId(discordId) {
      return q.byDiscord.get(String(discordId)) || null;
    },

    // One Discord account per site account, and the other way around.
    linkDiscord(accountId, discordId) {
      const existing = q.linkOf.get(String(discordId), accountId);
      if (existing) throw new Error('This Discord account or site account is already linked.');
      q.insertLink.run(String(discordId), accountId);
    },

    createLoginCode(accountId, ttlSeconds = 600) {
      const code = crypto.randomBytes(32).toString('base64url');
      q.purgeCodes.run(nowSeconds());
      q.insertCode.run(sha256(code), accountId, nowSeconds() + ttlSeconds);
      return code;
    },

    // Single use: the code is deleted whether or not it is still valid.
    redeemLoginCode(code) {
      if (typeof code !== 'string' || code.length > 100) return null;
      const row = q.takeCode.get(sha256(code));
      return row && row.expires_at >= nowSeconds() ? row.account_id : null;
    },

    createSession(accountId, ttlSeconds = 86400) {
      const token = crypto.randomBytes(32).toString('base64url');
      q.purgeSessions.run(nowSeconds());
      q.insertSession.run(sha256(token), accountId, nowSeconds() + ttlSeconds);
      return token;
    },

    accountBySession(token) {
      if (typeof token !== 'string' || token === '' || token.length > 100) return null;
      const row = q.session.get(sha256(token), nowSeconds());
      return row ? this.getAccount(row.account_id) : null;
    },

    deleteSession(token) {
      if (typeof token === 'string') q.deleteSession.run(sha256(token));
    },

    recentTransactions(accountId, limit = 10) {
      return q.recent.all(accountId, limit);
    },

    // Applies one verified postback. Returns what happened, as a short word.
    applyPostback({ transactionId, accountId, rewardMicro, status, offerName }) {
      return inTransaction(() => {
        const account = q.byId.get(accountId);
        if (status === 1) {
          if (q.getTx.get(transactionId)) return 'duplicate';
          if (!account) return 'unknown_user';
          const res = q.insertTx.run(transactionId, accountId, rewardMicro, offerName || null);
          if (res.changes !== 1) return 'duplicate';
          q.addBalance.run(rewardMicro, accountId);
          return 'credited';
        }
        const tx = q.getTx.get(transactionId);
        if (!tx) return 'not_credited';
        if (tx.status === 2) return 'duplicate';
        if (tx.account_id !== accountId) return 'user_mismatch';
        q.reverseTx.run(transactionId);
        // Take back exactly what was credited, never more.
        q.addBalance.run(-tx.reward_micro, tx.account_id);
        return 'reversed';
      });
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openStore };
