const service = require('../services/mentorOnboarding.service');

async function status(req, res) {
  try { res.json(await service.getState(req.user.id)); }
  catch (error) { res.status(500).json({ error: 'Could not load onboarding' }); }
}

async function selectRole(req, res) {
  try { res.json(await service.selectRole(req.user.id, req.body.role)); }
  catch (error) { res.status(400).json({ error: error.message }); }
}

async function answer(req, res) {
  try { res.json(await service.answer(req.user.id, req.body.answer, Boolean(req.body.skip))); }
  catch (error) { console.error('Onboarding answer error:', error); res.status(400).json({ error: error.message }); }
}

module.exports = { status, selectRole, answer };
