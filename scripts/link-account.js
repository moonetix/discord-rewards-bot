'use strict';

// Local testing only. Creates a site account and links it to a Discord user ID,
// standing in for the sign-up and Discord OAuth2 linking on your real site.
//   node --env-file=.env scripts/link-account.js --discord 123456789012345678 --name Ana --age-16-plus

const { openStore } = require('../src/store');

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const discordId = value('--discord');
const name = value('--name') || 'Member';
if (!/^\d{17,20}$/.test(String(discordId))) {
  console.error('Usage: scripts/link-account.js --discord <discord user id> [--name <name>] [--age-16-plus]');
  process.exit(1);
}

const store = openStore(process.env.DATABASE_PATH || './data.sqlite');
const accountId = store.createAccount({ displayName: name, is16Plus: args.includes('--age-16-plus') });
store.linkDiscord(accountId, discordId);
console.log(`Site account ${accountId} linked to Discord user ${discordId}.`);
store.close();
