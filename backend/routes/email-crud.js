'use strict';

/**
 * Email CRUD routes — get, star, archive, spam, read, delete
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { markEmailsDirty } = require('../utils/session');
const { findEmailInSession } = require('../utils/emailHelpers');

const router = express.Router();

// ── GET /api/email/:id ────────────────────────────────────────────────────────
router.get('/email/:id', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing email ID' });

    const allEmails = [
      ...(session.userEmails || []),
      ...(session.sentEmails || []),
      ...(session.spamEmails || []),
      ...(session.trashEmails || []),
      ...(session.snoozedEmails || []),
      ...(session.archivedEmails || [])
    ];

    const email = allEmails.find(e => e.id === id);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const completeEmail = {
      id: email.id || '',
      subject: email.subject || '(No Subject)',
      from: email.from || 'Unknown',
      to: email.to || email.recipient || session.user.email || '',
      date: email.date || new Date().toISOString(),
      body: email.body || email.preview || '',
      bodyHtml: email.bodyHtml || null,
      preview: email.preview || (email.body ? email.body.substring(0, 100) : ''),
      read: email.read !== false,
      unread: email.unread === true || email.read === false,
      starred: email.starred === true,
      labels: email.labels || [],
      sender: email.from || 'Unknown'
    };

    res.json(completeEmail);
  } catch (err) {
    console.error('Get email error:', err.message);
    res.status(500).json({ error: 'Failed to fetch email' });
  }
});

// ── PUT /api/email/:id/star ───────────────────────────────────────────────────
router.put('/email/:id/star', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const result = findEmailInSession(session, id);
    if (!result) return res.status(404).json({ error: 'Email not found' });

    result.email.starred = !result.email.starred;
    markEmailsDirty(session);
    res.json({ starred: result.email.starred });
  } catch (err) {
    console.error('Star email error:', err.message);
    res.status(500).json({ error: 'Failed to star email' });
  }
});

// ── PUT /api/email/:id/archive ────────────────────────────────────────────────
router.put('/email/:id/archive', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const result = findEmailInSession(session, id);
    if (!result) return res.status(404).json({ error: 'Email not found' });

    const idx = result.arr.findIndex(e => e.id === id);
    const email = result.arr.splice(idx, 1)[0];
    if (!session.archivedEmails) session.archivedEmails = [];
    session.archivedEmails.unshift(email);
    markEmailsDirty(session);
    res.json({ archived: true });
  } catch (err) {
    console.error('Archive email error:', err.message);
    res.status(500).json({ error: 'Failed to archive email' });
  }
});

// ── PUT /api/email/:id/spam ───────────────────────────────────────────────────
router.put('/email/:id/spam', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const result = findEmailInSession(session, id);
    if (!result) return res.status(404).json({ error: 'Email not found' });

    const idx = result.arr.findIndex(e => e.id === id);
    const email = result.arr.splice(idx, 1)[0];
    if (!session.spamEmails) session.spamEmails = [];
    session.spamEmails.unshift(email);
    markEmailsDirty(session);
    res.json({ moved: true });
  } catch (err) {
    console.error('Mark spam error:', err.message);
    res.status(500).json({ error: 'Failed to mark as spam' });
  }
});

// ── PUT /api/email/:id/read ───────────────────────────────────────────────────
router.put('/email/:id/read', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const { read = true } = req.body;
    const result = findEmailInSession(session, id);
    if (!result) return res.status(404).json({ error: 'Email not found' });

    result.email.read = read;
    result.email.unread = !read;
    markEmailsDirty(session);
    res.json({ read });
  } catch (err) {
    console.error('Mark read error:', err.message);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ── DELETE /api/email/:id ─────────────────────────────────────────────────────
router.delete('/email/:id', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const result = findEmailInSession(session, id);
    if (!result) return res.status(404).json({ error: 'Email not found' });

    const idx = result.arr.findIndex(e => e.id === id);
    const email = result.arr.splice(idx, 1)[0];
    if (!session.trashEmails) session.trashEmails = [];
    session.trashEmails.unshift(email);
    markEmailsDirty(session);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete email error:', err.message);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

module.exports = router;
