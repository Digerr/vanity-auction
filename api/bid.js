// /api/bid — POST новая ставка
const { validateInitData, getState, saveState, sendLog, fmt, makeAvatarColors, json } = require('./_lib');

// Rate limit per user (минимальный интервал между ставками в секундах)
const RATE_LIMIT_SEC = 5;
const MAX_MSG_LEN = 140;
const MAX_NAME_LEN = 20;

// Простой фильтр спама/мата (можно расширить)
const BANNED_WORDS = [
  'http://', 'https://', '.com', '.ru', '.me', '.net', '.org', 't.me/', '@',
  'казино', 'ставка', 'заработок', 'заработать'
];
// Примечание: фильтр мягкий, чтобы не блокировать нормальные сообщения со ссылками.
// Для прода — внешний модерационный API (Perspective API, OpenAI moderation).

function sanitize(str) {
  return String(str || '').slice(0, MAX_MSG_LEN).trim();
}

function sanitizeName(str) {
  return String(str || '').slice(0, MAX_NAME_LEN).trim();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  if (req.method !== 'POST') return json(res, { error: 'method_not_allowed' }, 405);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { initData, message, displayName } = body || {};

    // 1. Валидация Telegram
    const user = validateInitData(initData);
    if (!user) {
      return json(res, { error: 'auth_failed', message: 'invalid Telegram signature' }, 401);
    }

    // 2. Проверка rate limit
    const { state, sha } = await getState();
    const lastBid = (state.history || []).find(h => h.userId === user.id);
    if (lastBid) {
      const age = (Date.now() - lastBid.time) / 1000;
      if (age < RATE_LIMIT_SEC) {
        return json(res, { error: 'rate_limit', message: `Подожди ${Math.ceil(RATE_LIMIT_SEC - age)} сек` }, 429);
      }
    }

    // 3. Валидация сообщения
    const msg = sanitize(message);
    if (msg.length === 0) {
      return json(res, { error: 'empty_message' }, 400);
    }

    // 4. Имя (если передано — берём его, иначе — username из Telegram)
    const name = sanitizeName(displayName) || user.username || ('user_' + user.id);
    const avatarLetter = (name[0] || '?').toUpperCase();
    const colors = makeAvatarColors(String(user.id));
    const cost = state.nextBid;
    const prevHolder = state.holder;

    // 5. Обновляем состояние
    const newState = {
      currentBid: cost,
      nextBid: cost + 1,
      holder: name,
      holderAvatar: avatarLetter,
      holderColors: colors,
      holderMeta: `${(user.username ? '@' + user.username : 'user ' + user.id)} · Telegram`,
      message: msg,
      overthrows: (state.overthrows || 0) + 1,
      history: [
        {
          name,
          avatar: avatarLetter,
          colors,
          action: prevHolder ? `сбросил ${prevHolder}` : 'занял трон',
          amount: cost,
          time: Date.now(),
          userId: user.id
        },
        ...(state.history || [])
      ].slice(0, 100) // храним последние 100
    };

    await saveState(newState, sha);

    // 6. Лог в канал
    await sendLog(
      `👑 <b>Новая ставка!</b>\n\n` +
      `<b>${name}</b> перебил ${prevHolder ? '<b>' + prevHolder + '</b>' : 'пустой трон'} за <b>${fmt(cost)} ★</b>\n\n` +
      `<i>${msg}</i>\n\n` +
      `Текущая ставка: ${fmt(cost)} ★\n` +
      `Следующий перебив: ${fmt(newState.nextBid)} ★`
    );

    return json(res, {
      ok: true,
      state: {
        ...newState,
        history: newState.history.slice(0, 20)
      }
    });
  } catch (e) {
    console.error('bid error', e);
    return json(res, { error: 'server_error', message: e.message }, 500);
  }
};
