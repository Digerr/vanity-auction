// /api/state — GET текущий трон + баланс юзера (если есть initData)
const { validateInitData, getState, getBalance, json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  try {
    const { state } = await getState();
    if (!state) return json(res, { error: 'no_state' }, 404);

    // Если есть initData — добавляем баланс юзера
    let userBalance = 0;
    let user = null;
    const initData = req.query.initData || (req.headers['x-tg-init-data']);
    if (initData) {
      user = validateInitData(initData);
      if (user) {
        userBalance = await getBalance(user.id);
      }
    }

    const frontState = {
      ...state,
      history: (state.history || []).slice(0, 20),
      userBalance,
      user: user ? { id: user.id, name: user.first_name || user.username } : null
    };
    return json(res, frontState);
  } catch (e) {
    return json(res, { error: 'fetch_failed', message: e.message }, 500);
  }
};
