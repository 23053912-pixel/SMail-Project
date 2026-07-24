'use strict';

/**
 * Email send and draft routes
 */

const express = require('express');
const https = require('https');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { markEmailsDirty } = require('../utils/session');
const { sanitizeHeader, escapeHtmlEntities, sanitizeFilename } = require('../utils/emailHelpers');
const emailFetching = require('../services/emailFetching');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── POST /api/send ────────────────────────────────────────────────────────────
router.post('/send', upload.array('attachments', 10), async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const angleMatch = to.match(/<([^>]+)>/);
  const bareEmail = angleMatch ? angleMatch[1].trim() : to.trim();
  if (!emailRegex.test(bareEmail)) {
    return res.status(400).json({ error: 'Invalid recipient email address' });
  }

  if (subject.length > 998) {
    return res.status(400).json({ error: 'Subject line too long (max 998 characters)' });
  }

  const accessToken = await emailFetching.getValidAccessToken(session);
  if (!accessToken) {
    return res.status(401).json({ error: 'No access token. Please sign in again.' });
  }

  try {
    const safeTo = sanitizeHeader(to);
    const safeSubject = sanitizeHeader(subject);
    const safeBody = escapeHtmlEntities(body).replace(/\n/g, '<br>');
    const files = req.files || [];

    let raw;
    if (files.length === 0) {
      raw = [
        `From: ${session.user.email}`,
        `To: ${safeTo}`,
        `Subject: ${safeSubject}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        safeBody
      ].join('\r\n');
    } else {
      const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const parts = [];
      parts.push(`From: ${session.user.email}`);
      parts.push(`To: ${safeTo}`);
      parts.push(`Subject: ${safeSubject}`);
      parts.push('MIME-Version: 1.0');
      parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      parts.push('');
      parts.push(`--${boundary}`);
      parts.push('Content-Type: text/html; charset=utf-8');
      parts.push('');
      parts.push(safeBody);
      for (const file of files) {
        const safeName = sanitizeFilename(file.originalname);
        parts.push(`--${boundary}`);
        parts.push(`Content-Type: ${file.mimetype}; name="${safeName}"`);
        parts.push('Content-Transfer-Encoding: base64');
        parts.push(`Content-Disposition: attachment; filename="${safeName}"`);
        parts.push('');
        parts.push(file.buffer.toString('base64'));
      }
      parts.push(`--${boundary}--`);
      raw = parts.join('\r\n');
    }

    const encoded = Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const postData = JSON.stringify({ raw: encoded });

    const result = await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'gmail.googleapis.com',
        path: '/gmail/v1/users/me/messages/send',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, data: JSON.parse(data) });
          } catch (e) {
            reject(new Error('Invalid JSON response from Gmail API'));
          }
        });
      });

      req2.on('error', reject);
      req2.setTimeout(15000, () => {
        req2.destroy();
        reject(new Error('Send request timeout'));
      });

      req2.write(postData);
      req2.end();
    });

    if (result.status === 200) {
      const newEmail = {
        id: result.data.id || Date.now().toString(),
        from: session.user.email,
        to: safeTo,
        subject: safeSubject,
        body,
        date: new Date(),
        read: true,
        starred: false
      };

      if (session.sentEmails) {
        session.sentEmails.unshift(newEmail);
      }
      markEmailsDirty(session);

      res.json({ success: true, message: 'Email sent successfully', email: newEmail });
    } else {
      console.error('Gmail API error:', result.status, result.data);
      res.status(500).json({ error: 'Failed to send email via Gmail API' });
    }
  } catch (err) {
    console.error('Send error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

// ── GET /api/drafts ─────────────────────────────────────────────────────────
router.get('/drafts', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;
  res.json(session.draftEmails || []);
});

// ── POST /api/draft ───────────────────────────────────────────────────────────
router.post('/draft', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const { to, subject, body, id } = req.body;
  if (!to && !subject && !body) {
    return res.status(400).json({ error: 'Draft is empty' });
  }

  const draft = {
    id: id || Date.now().toString(),
    to: to || '',
    subject: subject || '',
    body: body || '',
    date: new Date(),
    read: false,
    starred: false,
    labels: ['DRAFT']
  };

  try {
    if (id && session.draftEmails) {
      const idx = session.draftEmails.findIndex(e => e.id === id);
      if (idx !== -1) {
        session.draftEmails[idx] = draft;
      } else {
        session.draftEmails.push(draft);
      }
    } else if (session.draftEmails) {
      session.draftEmails.push(draft);
    }
    markEmailsDirty(session);

    res.json({ success: true, message: 'Draft saved', draft });
  } catch (err) {
    console.error('Draft save error:', err.message);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

module.exports = router;
