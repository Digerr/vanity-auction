// /api/_lib.js — общие функции для serverless endpoints

const crypto = require('crypto');

const GH_TOKEN = process.env.GH_TOKEN;
const REPO = 'Digerr/vanity-auction';
const STATE_PATH = 'data/state.json';
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

// ===== GitHub state storage =====
async function getState() {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${STATE_PATH}`,
    { headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github+json' } }
  );
  if (!r.ok) throw new Error('getState failed: ' + r.status);
  const data = await r.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { state: JSON.parse(content), sha: data.sha };
}

async function saveState(state, sha) {
  const content = Buffer.from(JSON.stringify(state)).toString('base64');
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${STATE_PATH}`,
    {
      method: 'PUT',
      headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'bid update', content, sha })
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('saveState failed: ' + r.status + ' ' + txt);
  }
  const data = await r.json();
  return data.content.sha;
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

module.exports = { validateInitData, getState, saveState, sendLog, fmt, makeAvatarColors, json };
