'use strict';

/**
 * Email list routes — user info, folder listing, refresh, categorize, spam-detect
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getCachedFolder, markEmailsDirty } = require('../utils/session');
const { VALID_FOLDERS, QUERY_MAP, MAX_MAP, SESSION_KEY_MAP } = require('../utils/emailHelpers');
const emailFetching = require('../services/emailFetching');
const emailCategorization = require('../services/emailCategorization');
const spamDetection = require('../services/spamDetection');

const router = express.Router();

// ── GET /api/user ─────────────────────────────────────────────────────────────
router.get('/user', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const { id, email, name, picture, provider } = session.user;
  res.json({ id, email, name, picture, provider });
});

// ── POST /api/emails/process ──────────────────────────────────────────────────
router.post('/emails/process', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  if (!session.user.accessToken) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const { folder = 'inbox', maxResults = 50 } = req.body;

    if (!VALID_FOLDERS.has(folder)) {
      return res.status(400).json({ error: 'Invalid folder' });
    }

    const accessToken = await emailFetching.getValidAccessToken(session);
    const gmail = emailFetching.createGmailClient(accessToken);
    const query = QUERY_MAP[folder] || QUERY_MAP.inbox;

    const emailProcessing = require('../services/emailProcessing');
    const result = await emailProcessing.processEmails(
      gmail,
      query,
      maxResults,
      session.user.email,
      null
    );

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('Process emails error:', err.message);
    res.status(500).json({ error: 'Failed to process emails' });
  }
});

// ── POST /api/emails/refresh ──────────────────────────────────────────────────
router.post('/emails/refresh', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  if (!session.user.accessToken) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const accessToken = await emailFetching.getValidAccessToken(session);
    const gmail = emailFetching.createGmailClient(accessToken);
    const result = await emailFetching.fetchGmailMessageList(
      gmail,
      QUERY_MAP.inbox,
      50,
      session.user.email
    );

    res.json({
      success: true,
      totalEmails: result.messages.length,
      nextPageToken: result.nextPageToken
    });
  } catch (err) {
    console.error('Refresh error:', err.message);
    res.status(500).json({ error: 'Failed to refresh emails' });
  }
});

// ── GET /api/emails/:folder ───────────────────────────────────────────────────
router.get('/emails/:folder', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const { folder } = req.params;
  if (!VALID_FOLDERS.has(folder)) {
    return res.status(400).json({ error: 'Invalid folder' });
  }

  const forceRefresh = req.query.refresh === 'true';
  const cached = getCachedFolder(session, folder);

  const now = Date.now();
  const cacheAge = now - (session.lastEmailRefresh?.[folder] || 0);
  const cacheExpired = cacheAge > 30000;

  if (!forceRefresh && cached.length > 0 && !cacheExpired && folder !== 'inbox') {
    return res.json({ emails: cached, hasMore: !!(session.nextPageTokens?.[folder]) });
  }

  if (!session.user.accessToken) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const accessToken = await emailFetching.getValidAccessToken(session);
    const gmail = emailFetching.createGmailClient(accessToken);
    const result = await emailFetching.fetchGmailMessageList(
      gmail,
      QUERY_MAP[folder] || QUERY_MAP.inbox,
      MAX_MAP[folder] || 50,
      session.user.email
    );

    const emails = result.messages;
    session.nextPageTokens = session.nextPageTokens || {};
    session.nextPageTokens[folder] = result.nextPageToken || null;

    const key = SESSION_KEY_MAP[folder];
    if (key) session[key] = emails;
    markEmailsDirty(session);

    session.lastEmailRefresh = session.lastEmailRefresh || {};
    session.lastEmailRefresh[folder] = now;

    res.json({ emails, hasMore: !!result.nextPageToken });
  } catch (err) {
    console.error(`Get emails (${folder}) error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// ── GET /api/emails/:folder/more ──────────────────────────────────────────────
router.get('/emails/:folder/more', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const { folder } = req.params;
  if (!VALID_FOLDERS.has(folder)) {
    return res.status(400).json({ error: 'Invalid folder' });
  }

  if (!session.user.accessToken) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const pageToken = session.nextPageTokens?.[folder];
  if (!pageToken) return res.json({ emails: [], hasMore: false });

  try {
    const accessToken = await emailFetching.getValidAccessToken(session);
    const gmail = emailFetching.createGmailClient(accessToken);
    const result = await emailFetching.fetchGmailMessageList(
      gmail,
      QUERY_MAP[folder] || QUERY_MAP.inbox,
      50,
      session.user.email,
      pageToken
    );

    session.nextPageTokens = session.nextPageTokens || {};
    session.nextPageTokens[folder] = result.nextPageToken || null;

    const key = SESSION_KEY_MAP[folder];
    if (key && Array.isArray(session[key])) {
      session[key] = [...session[key], ...result.messages];
    }
    markEmailsDirty(session);

    res.json({ emails: result.messages, hasMore: !!result.nextPageToken });
  } catch (err) {
    console.error(`Load more error (${folder}):`, err.message);
    res.status(500).json({ error: 'Failed to load more emails' });
  }
});

// ── POST /api/emails/categorize ───────────────────────────────────────────────
router.post('/emails/categorize', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: 'Emails must be an array' });
    }

    const categorized = emailCategorization.categorizeBatch(emails);
    res.json({ success: true, categorizations: categorized });
  } catch (err) {
    console.error('Categorization error:', err.message);
    res.status(500).json({ error: 'Failed to categorize emails' });
  }
});

// ── POST /api/emails/spam-detect ───────────────────────────────────────────────
router.post('/emails/spam-detect', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: 'Emails must be an array' });
    }

    const predictions = await spamDetection.predictSpamBatch(emails);
    res.json({ success: true, predictions });
  } catch (err) {
    console.error('Spam detection error:', err.message);
    res.status(500).json({ error: 'Failed to detect spam' });
  }
});

module.exports = router;
