const express = require('express');

const router = express.Router();

/** No DB — safe for uptime pings (e.g. Render free tier keep-alive). */
router.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

module.exports = router;
