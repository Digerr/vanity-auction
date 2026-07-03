// /api/verify-payment — POST проверка оплаты Telegram Stars
// После того как юзер закрыл инвойс (callback в openInvoice), фронт дёргает этот эндпоинт
// Мы ищем последнюю входящую транзакцию от этого user_id и зачисляем её на баланс
const {
  validateInitData, getStarTransactions,
  getBalances, saveBalances, json
} = require('./_lib');

const POLL_RETRIES = 5;
const POLL_DELAY_MS = 1500;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  if (req.method !== 'POST') return json(res, { error: 'method_not_allowed' }, 405);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { initData } = body || {};

    const user = validateInitData(initData);
    if (!user) return json(res, { error: 'auth_failed' }, 401);

    // Пытаемся найти транзакцию (API может немного задерживаться)
    let foundAmount = null;
    let foundTxId = null;

    for (let i = 0; i < POLL_RETRIES; i++) {
      const txs = await getStarTransactions(100);
      // Ищем входящую транзакцию от нашего юзера
      const tx = txs.find(t =>
        t.source && t.source.user && t.source.user.id === user.id
      );
      if (tx) {
        foundAmount = tx.amount;
        foundTxId = tx.transaction_id || tx.id;
        break;
      }
      await new Promise(r => setTimeout(r, POLL_DELAY_MS));
    }

    if (!foundAmount) {
      // Транзакция не найдена — возможно юзер не оплатил, или API ещё не видел
      return json(res, {
        ok: false,
        error: 'transaction_not_found',
        message: 'Платёж не найден. Если вы оплатили — звёзды придут в течение минуты.'
      }, 202);
    }

    // Зачисляем на баланс (с retry на race condition)
    for (let i = 0; i < 3; i++) {
      try {
        const { balances, sha } = await getBalances();
        const current = balances[user.id] || 0;
        const newBalances = { ...balances, [user.id]: current + foundAmount };
        await saveBalances(newBalances, sha);
        return json(res, {
          ok: true,
          amount: foundAmount,
          transactionId: foundTxId,
          newBalance: newBalances[user.id]
        });
      } catch (e) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return json(res, { error: 'save_failed', message: 'Не удалось сохранить баланс, попробуйте ещё раз' }, 503);
  } catch (e) {
    console.error('verify-payment error', e);
    return json(res, { error: 'server_error', message: e.message }, 500);
  }
};
