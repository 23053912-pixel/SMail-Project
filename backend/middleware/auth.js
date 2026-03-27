'use strict';

const jwt            = require('jsonwebtoken');
const { getSession } = require('../utils/session');

/**
 * Verifies the Bearer JWT on the request and returns the matching session.
 * Sends a 401 response and returns null if authentication fails.
 */
function requireAuth(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
    return null;
  }
  const session = getSession(decoded.id);
  if (!session) {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return null;
  }
  session.lastActive = Date.now();
  return session;
}

module.exports = { requireAuth };
