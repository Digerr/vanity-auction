// /api/_lib.js — общие функции для serverless endpoints

const crypto = require('crypto');

const GH_TOKEN = process.env.GH_TOKEN;
const REPO = 'Digerr/vanity-auction';
const STATE_PATH = 'data/state.json';
const BALANCES_PATH = 'data/balances.json';
const TG_TOKEN = process.env.TG_TOKEN;
const LOG_CHANNEL = process.env.LOG_CHANNEL;

// ===== Telegram initData validation =====
function validateInitData(initData) {
  if (!initData || !TG_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(TG_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  try {
    const userJson = params.get('user');
    if (userJson) return JSON.parse(userJson);
  } catch (e) {}
  return null;
}

// ===== Pretty display name (без @) =====
function getDisplayName(user) {
  const first = user.first_name || '';
  const last = user.last_name || '';
  const name = (first + ' ' + last).trim();
  if (name) return name;
  return user.username ? '@' + user.username : ('User ' + user.id);
}

// ===== GitHub file storage =====
async function getGHFile(path) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    { headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github+json' } }
  );
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error('getGHFile failed: ' + r.status);
  }
  const data = await r.json();
  return { content: JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8')), sha: data.sha };
}

async function saveGHFile(path, content, sha, message) {
  const body = {
    message: message || 'update',
    content: Buffer.from(JSON.stringify(content)).toString('base64')
  };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('saveGHFile failed: ' + r.status + ' ' + txt);
  }
  const data = await r.json();
  return data.content.sha;
}

// getState / saveState (упрощённые обёртки)
async function getState() {
  const r = await getGHFile(STATE_PATH);
  return r ? { state: r.content, sha: r.sha } : { state: null, sha: null };
}
async function saveState(state, sha) {
  return saveGHFile(STATE_PATH, state, sha, 'bid update');
}

// getBalance / saveBalance (per-user)
async function getBalances() {
  const r = await getGHFile(BALANCES_PATH);
  return r ? { balances: r.content, sha: r.sha } : { balances: {}, sha: null };
}
async function saveBalances(balances, sha) {
  return saveGHFile(BALANCES_PATH, balances, sha, 'balance update');
}

async function getBalance(userId) {
  const { balances } = await getBalances();
  return balances[userId] || 0;
}

// ===== Telegram log =====
async function sendLog(text) {
  if (!LOG_CHANNEL) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: LOG_CHANNEL,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {}
}

// ===== Telegram Stars API =====
async function createStarInvoice(userId, amount) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `${amount} звёзд для Vanity`,
      description: 'Пополнение баланса в аукционе тщеславия',
      payload: JSON.stringify({ uid: userId, amount, ts: Date.now() }),
      currency: 'XTR',
      prices: [{ label: 'Stars', amount }],
      provider_token: '' // пусто для Stars
    })
  });
  const data = await r.json();
  if (!data.ok) throw new Error('createInvoiceLink: ' + JSON.stringify(data));
  return data.result;
}

async function getStarTransactions(limit = 100, offset) {
  const url = new URL(`https://api.telegram.org/bot${TG_TOKEN}/getStarTransactions`);
  url.searchParams.set('limit', limit);
  if (offset) url.searchParams.set('offset', offset);
  const r = await fetch(url);
  const data = await r.json();
  if (!data.ok) throw new Error('getStarTransactions: ' + JSON.stringify(data));
  return data.result.transactions || [];
}

// ===== Helpers =====
function fmt(n) { return n.toLocaleString('ru-RU'); }

function makeAvatarColors(seed) {
  const palettes = [
    ['#6B8EFF', '#A855F7'],
    ['#FA5A5A', '#FF8A3D'],
    ['#4ADE80', '#10B981'],
    ['#E8B339', '#FA5A5A'],
    ['#A855F7', '#EC4899'],
    ['#6B8EFF', '#4ADE80'],
    ['#FF8A3D', '#E8B339'],
    ['#EC4899', '#A855F7']
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function json(res, data, status = 200) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

module.exports = {
  validateInitData,
  getDisplayName,
  getState, saveState,
  getBalances, saveBalances, getBalance,
  createStarInvoice, getStarTransactions,
  sendLog, fmt, makeAvatarColors, json
};
