// /api/bid — POST новая ставка
const {
  validateInitData, getDisplayName,
  getState, saveState,
  getBalances, saveBalances,
  sendLog, fmt, makeAvatarColors, json
} = require('./_lib');

const RATE_LIMIT_SEC = 5;
const MAX_MSG_LEN = 140;
const MAX_NAME_LEN = 24;
const MAX_RETRIES = 3; // защита от race condition

function sanitize(str) {
  return String(str || '').slice(0, MAX_MSG_LEN).trim();
}

function sanitizeName(str) {
  return String(str || '').slice(0, MAX_NAME_LEN).trim();
}

async function attemptBid(user, msg, displayName) {
  // 1. Получаем текущее состояние И баланс (отдельные файлы — отдельные sha)
  const { state, sha: stateSha } = await getState();
  if (!state) throw { code: 'no_state' };

  const { balances, sha: balSha } = await getBalances();

  // 2. Rate limit
  const lastBid = (state.history || []).find(h => h.userId === user.id);
  if (lastBid) {
    const age = (Date.now() - lastBid.time) / 1000;
    if (age < RATE_LIMIT_SEC) {
      throw { code: 'rate_limit', message: `Подожди ${Math.ceil(RATE_LIMIT_SEC - age)} сек` };
    }
  }

  // 3. Имя
  const name = sanitizeName(displayName) || sanitizeName(getDisplayName(user));
  const avatarLetter = (name[0] || '?').toUpperCase();
  const colors = makeAvatarColors(String(user.id));
  const cost = state.nextBid;

  // 4. Проверка баланса
  const currentBalance = balances[user.id] || 0;
  if (currentBalance < cost) {
    throw { code: 'insufficient_funds', balance: currentBalance, needed: cost };
  }

  // 5. Списываем
  const newBalances = { ...balances, [user.id]: currentBalance - cost };

  // 6. Обновляем трон
  const prevHolder = state.holder;
  const newState = {
    currentBid: cost,
    nextBid: cost + 1,
    holder: name,
    holderAvatar: avatarLetter,
    holderColors: colors,
    holderMeta: getDisplayName(user) + ' · Telegram',
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
    ].slice(0, 100)
  };

  // 7. Сохраняем — сначала балансы (отдельный файл, реже конфликты), потом state
  // Если state Sha изменился — retry с начала
  try {
    await saveBalances(newBalances, balSha);
  } catch (e) {
    // Возможно concurrent update балансов — retry
    throw { code: 'retry' };
  }

  try {
    await saveState(newState, stateSha);
  } catch (e) {
    // State file был изменён concurrent ставкой — откатываем баланс и просим retry
    // Восстанавливаем баланс
    try {
      const freshBalances = await getBalances();
      await saveBalances(balances, freshBalances.sha, 'rollback balance');
    } catch (rollbackErr) {}
    throw { code: 'retry' };
  }

  return { newState, newBalance: newBalances[user.id] };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  if (req.method !== 'POST') return json(res, { error: 'method_not_allowed' }, 405);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { initData, message, displayName } = body || {};

    const user = validateInitData(initData);
    if (!user) {
      return json(res, { error: 'auth_failed', message: 'invalid Telegram signature' }, 401);
    }

    const msg = sanitize(message);
    if (msg.length === 0) {
      return json(res, { error: 'empty_message' }, 400);
    }

    // Retry loop для race condition
    let lastErr;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const { newState, newBalance } = await attemptBid(user, msg, displayName);

        // Лог в канал
        await sendLog(
          `👑 <b>Новая ставка!</b>\n\n` +
          `<b>${newState.holder}</b> перебил ${newState.history[1] ? '<b>' + newState.history[1].name + '</b>' : 'пустой трон'} за <b>${fmt(newState.currentBid)} ★</b>\n\n` +
          `<i>${msg}</i>\n\n` +
          `Текущая ставка: ${fmt(newState.currentBid)} ★\n` +
          `Следующий перебив: ${fmt(newState.nextBid)} ★`
        );

        return json(res, {
          ok: true,
          state: { ...newState, history: newState.history.slice(0, 20) },
          userBalance: newBalance
        });
      } catch (e) {
        if (e.code === 'retry') {
          lastErr = e;
          // Ждём 200-500мс и retry
          await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
          continue;
        }
        // Другие ошибки — сразу возвращаем
        if (e.code === 'rate_limit') return json(res, { error: 'rate_limit', message: e.message }, 429);
        if (e.code === 'insufficient_funds') return json(res, { error: 'insufficient_funds', balance: e.balance, needed: e.needed }, 402);
        if (e.code === 'no_state') return json(res, { error: 'no_state' }, 500);
        throw e;
      }
    }

    return json(res, { error: 'busy_retry', message: 'Сервер занят, попробуйте ещё раз' }, 503);
  } catch (e) {
    console.error('bid error', e);
    return json(res, { error: 'server_error', message: e.message }, 500);
  }
};
