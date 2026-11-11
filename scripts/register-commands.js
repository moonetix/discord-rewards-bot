'use strict';

// Registers /earn and /balance with Discord. Run once, and again after you change COMMANDS:
//   node --env-file=.env scripts/register-commands.js
// With DISCORD_GUILD_ID set, the commands go to that server only and show up right away.
// Without it, they are registered globally.
// This replaces the full command list of your application, so run it only for the app that owns these commands.

const { COMMANDS } = require('../src/commands');

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !token) {
  console.error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first.');
  process.exit(1);
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

(async () => {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://github.com/moonetix/discord-rewards-bot, 1.0.0)',
    },
    body: JSON.stringify(COMMANDS),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Discord answered ${res.status}: ${body}`);
    process.exit(1);
  }
  console.log(`Registered ${COMMANDS.map((c) => '/' + c.name).join(', ')} ${guildId ? 'in guild ' + guildId : 'globally'}.`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
