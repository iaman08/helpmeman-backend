const express = require('express');
const router = express.Router();
const { searchOrganizations, resolveOrganization } = require('../services/organization.service');

router.get('/search', async (req, res) => {
  try {
    const { q = '', type = null, limit = 10 } = req.query;
    const orgs = await searchOrganizations(q, type, parseInt(limit) || 10);
    res.json({ organizations: orgs });
  } catch (err) {
    console.error('Error searching organizations:', err);
    res.status(500).json({ error: 'Failed to search organizations' });
  }
});

router.get('/resolve', async (req, res) => {
  try {
    const { name = '', type = null } = req.query;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const org = await resolveOrganization(name, type);
    res.json({ organization: org });
  } catch (err) {
    console.error('Error resolving organization:', err);
    res.status(500).json({ error: 'Failed to resolve organization' });
  }
});

module.exports = router;
