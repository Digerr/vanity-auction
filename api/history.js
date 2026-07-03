// /api/history — GET история ставок
const { getState, json } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});
  try {
    const { state } = await getState();
    return json(res, { history: (state.history || []).slice(0, 50) });
  } catch (e) {
    return json(res, { error: 'fetch_failed', message: e.message }, 500);
  }
};
