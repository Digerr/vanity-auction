// /api/state — GET текущий трон
const { getState, json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  try {
    const { state } = await getState();
    // Сокращаем историю для фронта — последние 20
    const frontState = {
      ...state,
      history: (state.history || []).slice(0, 20)
    };
    return json(res, frontState);
  } catch (e) {
    return json(res, { error: 'fetch_failed', message: e.message }, 500);
  }
};
