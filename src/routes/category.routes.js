const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json({ categories });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
