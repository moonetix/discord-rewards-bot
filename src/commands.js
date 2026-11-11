'use strict';

const { formatAmount } = require('./moonetix');

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4 };
const EPHEMERAL = 1 << 6;

// Slash commands this app answers. scripts/register-commands.js registers the same list.
const COMMANDS = [
  { name: 'earn', description: 'Get your private link to earn coins', type: 1, contexts: [0], integration_types: [0] },
  { name: 'balance', description: 'See your coin balance', type: 1, contexts: [0], integration_types: [0] },
];

function createInteractionHandler({ config, store, now = () => Date.now() }) {
  const lastEarn = new Map();

  return function handleInteraction(interaction) {
    if (interaction.type === InteractionType.PING) return { type: ResponseType.PONG };
    if (interaction.type !== InteractionType.APPLICATION_COMMAND) return null;

    const discordUser = (interaction.member && interaction.member.user) || interaction.user;
    if (!discordUser || !discordUser.id) return null;
    // The Discord ID is only used to look up the linked account here. It never leaves your server.
    const account = store.accountByDiscordId(discordUser.id);
    const name = interaction.data && interaction.data.name;

    if (name === 'balance') {
      if (!account) return notLinked(config);
      return privateReply(`Your balance: ${formatAmount(account.balance_micro)} ${config.currencyName}.`);
    }

    if (name === 'earn') {
      const t = now();
      if (t - (lastEarn.get(discordUser.id) || 0) < config.earnCooldownSeconds * 1000) {
        return privateReply('You just asked for your link. Try again in a moment.');
      }
      lastEarn.set(discordUser.id, t);
      if (lastEarn.size > 10000) lastEarn.clear();

      if (!account) return notLinked(config);
      if (!account.is_16_plus) {
        return privateReply('Earning is open to members aged 16 and over with a verified account.', 'Account settings', config.linkAccountUrl);
      }
      // A one-time sign-in code for YOUR earn page. No offerwall link and no Discord ID in it.
      const code = store.createLoginCode(account.id, 600);
      return privateReply(
        'Your private earn page. The button works once and expires in 10 minutes. Turn off any VPN before you open the offerwall.',
        'Open your earn page',
        `${config.siteUrl}/earn?code=${code}`,
      );
    }

    return privateReply('Unknown command.');
  };
}

function notLinked(config) {
  return privateReply('Link Discord to your account on our site first, then run the command again.', 'Link your account', config.linkAccountUrl);
}

function privateReply(content, buttonLabel, buttonUrl) {
  const data = { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } };
  if (buttonLabel) {
    data.components = [{ type: 1, components: [{ type: 2, style: 5, label: buttonLabel, url: buttonUrl }] }];
  }
  return { type: ResponseType.CHANNEL_MESSAGE, data };
}

module.exports = { COMMANDS, EPHEMERAL, createInteractionHandler };
