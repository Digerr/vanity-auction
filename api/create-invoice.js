// /api/create-invoice — POST создание Telegram Stars invoice
const { validateInitData, createStarInvoice, getBalances, saveBalances, json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  if (req.method !== 'POST') return json(res, { error: 'method_not_allowed' }, 405);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { initData, amount } = body || {};

    const user = validateInitData(initData);
    if (!user) {
      return json(res, { error: 'auth_failed' }, 401);
    }

    // Валидация суммы
    const amt = parseInt(amount, 10);
    if (!amt || amt < 50 || amt > 100000) {
      return json(res, { error: 'invalid_amount', message: 'min 50, max 100000' }, 400);
    }

    const invoiceUrl = await createStarInvoice(user.id, amt);

    return json(res, {
      ok: true,
      invoiceUrl,
      amount: amt
    });
  } catch (e) {
    console.error('create-invoice error', e);
    return json(res, { error: 'server_error', message: e.message }, 500);
  }
};
