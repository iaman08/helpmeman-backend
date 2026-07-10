const jwt = require('jsonwebtoken');
const config = require('../config/env');

function generateAccessToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
}

function generateRefreshToken(payload) {
  return jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: '7d' });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
}

function generateEmailToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
}

function verifyEmailToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateEmailToken,
  verifyEmailToken,
};
