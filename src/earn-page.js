'use strict';

const { formatAmount } = require('./moonetix');

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/earn.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function messagePage(title, text) {
  return layout(title, `<h1>${esc(title)}</h1>\n<p>${esc(text)}</p>`);
}

function earnPage({ account, wallUrl, recent, currency }) {
  const rows = recent.map((tx) => `<li><span>${esc(tx.offer_name || 'Offer')}</span> <strong class="${tx.status === 1 ? 'plus' : 'minus'}">${tx.status === 1 ? '+' : '-'}${esc(formatAmount(tx.reward_micro))}</strong>${tx.status === 2 ? ' <em>reversed</em>' : ''}</li>`).join('\n');
  return layout('Earn', `<header>
<h1>Hi, ${esc(account.display_name)}</h1>
<p class="balance">${esc(formatAmount(account.balance_micro))} <span>${esc(currency)}</span></p>
<form method="post" action="/logout"><button type="submit">Sign out</button></form>
</header>
<p>Complete offers to earn ${esc(currency)}. Rewards arrive after the advertiser confirms the offer, and can be taken back if the advertiser reverses it. Turn off any VPN first.</p>
<p><a class="open" href="${esc(wallUrl)}" target="_blank" rel="noopener noreferrer">Open the offerwall in a new tab</a></p>
<iframe title="Offerwall" src="${esc(wallUrl)}"></iframe>
<h2>Recent rewards</h2>
${rows ? `<ul class="recent">\n${rows}\n</ul>` : '<p>No rewards yet.</p>'}`);
}

module.exports = { earnPage, messagePage };
