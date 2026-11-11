'use strict';

const REQUIRED = [
  'DISCORD_PUBLIC_KEY',
  'SITE_URL',
  'MOONETIX_APP_ID',
  'MOONETIX_LINK_SALT',
  'MOONETIX_POSTBACK_KEY',
];

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  return {
    port: Number(env.PORT || 3000),
    databasePath: env.DATABASE_PATH || './data.sqlite',
    siteUrl: env.SITE_URL.replace(/\/+$/, ''),
    linkAccountUrl: env.LINK_ACCOUNT_URL || `${env.SITE_URL.replace(/\/+$/, '')}/account`,
    discordPublicKey: env.DISCORD_PUBLIC_KEY,
    earnCooldownSeconds: Number(env.EARN_COOLDOWN_SECONDS ?? 30),
    currencyName: env.CURRENCY_NAME || 'Coins',
    appId: env.MOONETIX_APP_ID,
    linkSalt: env.MOONETIX_LINK_SALT,
    postbackKey: env.MOONETIX_POSTBACK_KEY,
  };
}

module.exports = { loadConfig };
