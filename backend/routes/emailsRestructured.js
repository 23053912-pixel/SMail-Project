'use strict';

/**
 * Email Routes API
 * Defines endpoints for email operations
 * Uses the new modular services for fetching, categorization, and spam detection
 */

const express = require('express');
const https = require('https');
const { requireAuth } = require('../middleware/auth');
const { getCachedFolder, getAllEmailsDeduped } = require('../utils/session');
const emailFetching = require('../services/emailFetching');
const emailCategorization = require('../services/emailCategorization');
const spamDetection = require('../services/spamDetection');
const emailSpamKeywordDetector = require('../services/emailSpamKeywordDetector');
const emailProcessing = require('../services/emailProcessing');

const router = express.Router();

// Lazily require db to avoid circular dependency
let db = null;
function getDb() {
  if (!db) {
    db = require('../server').db;
  }
  return db;
}

const VALID_FOLDERS = new Set(['inbox', 'sent', 'drafts', 'trash', 'snoozed', 'spam', 'starred', 'important', 'all', 'archive']);
const QUERY_MAP = {
  inbox:     'in:inbox -in:trash -in:spam',
  starred:   'is:starred -in:trash -in:spam',
  snoozed:   'in:snoozed',
  important: 'is:important -in:trash -in:spam',
  spam:      'in:spam',
  sent:      'in:sent',
  trash:     'in:trash',
  all:       'in:anywhere -in:trash -in:spam',
  archive:   'label:archive -in:inbox'
};
const MAX_MAP = { inbox: 50, starred: 50, snoozed: 50, important: 50, spam: 50, sent: 50, trash: 50, all: 80, archive: 50 };
const SESSION_KEY_MAP = { inbox: 'userEmails', sent: 'sentEmails', trash: 'trashEmails', snoozed: 'snoozedEmails', spam: 'spamEmails', archive: 'archivedEmails' };

// ── GET /api/user ─────────────────────────────────────────────────────────────
router.get('/user', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const { id, email, name, picture, provider } = session.user;
  res.json({ id, email, name, picture, provider });
});

// ── POST /api/emails/process ──────────────────────────────────────────────────
// Full email processing pipeline: fetch + categorize + spam detect
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

    const gmail = emailFetching.createGmailClient(session.user.accessToken);
    const query = QUERY_MAP[folder] || QUERY_MAP.inbox;
    
    const result = await emailProcessing.processEmails(
      gmail,
      query,
      maxResults,
      session.user.email,
      db
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
// Refresh emails from Gmail
router.post('/emails/refresh', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  if (!session.user.accessToken) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const gmail = emailFetching.createGmailClient(session.user.accessToken);
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
// Get emails from a specific folder
router.get('/emails/:folder', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  const { folder } = req.params;
  if (!VALID_FOLDERS.has(folder)) {
    return res.status(400).json({ error: 'Invalid folder' });
  }

  const forceRefresh = req.query.refresh === 'true';
  const cached = getCachedFolder(session, folder);
  
  // For inbox: always fetch fresh (or if cache is older than 30s)
  // For other folders: use cache if available
  const now = Date.now();
  const cacheAge = now - (session.lastEmailRefresh?.[folder] || 0);
  const cacheExpired = cacheAge > 30000; // 30 second cache TTL
  
  if (!forceRefresh && cached.length > 0 && !cacheExpired && folder !== 'inbox') {
    return res.json({ emails: cached, hasMore: !!(session.nextPageTokens?.[folder]) });
  }

  if (!session.user.accessToken) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  try {
    const gmail = emailFetching.createGmailClient(session.user.accessToken);
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
    
    // Track when cache was refreshed for TTL checking
    session.lastEmailRefresh = session.lastEmailRefresh || {};
    session.lastEmailRefresh[folder] = now;

    res.json({ emails, hasMore: !!result.nextPageToken });
  } catch (err) {
    console.error(`Get emails (${folder}) error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// ── GET /api/emails/:folder/more ──────────────────────────────────────────────
// Load next page of emails from a folder
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
    const gmail = emailFetching.createGmailClient(session.user.accessToken);
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

    res.json({ emails: result.messages, hasMore: !!result.nextPageToken });
  } catch (err) {
    console.error(`Load more error (${folder}):`, err.message);
    res.status(500).json({ error: 'Failed to load more emails' });
  }
});

// ── POST /api/emails/categorize ───────────────────────────────────────────────
// Categorize a batch of emails
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
// Detect spam using ML model
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

// ── POST /api/send ────────────────────────────────────────────────────────────
// Send an email via Gmail API
router.post('/send', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  // Sanitize and validate input
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  // Validate recipient email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const angleMatch = to.match(/<([^>]+)>/);
  const bareEmail = angleMatch ? angleMatch[1].trim() : to.trim();
  if (!emailRegex.test(bareEmail)) {
    return res.status(400).json({ error: 'Invalid recipient email address' });
  }

  // Validate subject length (RFC 2822: ≤ 998 chars)
  if (subject.length > 998) {
    return res.status(400).json({ error: 'Subject line too long (max 998 characters)' });
  }

  const accessToken = session.user.accessToken;
  if (!accessToken) {
    return res.status(401).json({ error: 'No access token. Please sign in again.' });
  }

  try {
    // Build email in RFC 2822 format
    const raw = [
      `From: ${session.user.email}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body
    ].join('\r\n');

    // Encode to base64url
    const encoded = Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const postData = JSON.stringify({ raw: encoded });

    // Send via Gmail API
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
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

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.abort();
        reject(new Error('Send request timeout'));
      });

      req.write(postData);
      req.end();
    });

    if (result.status === 200) {
      const newEmail = {
        id: result.data.id || Date.now().toString(),
        from: session.user.email,
        to,
        subject,
        body,
        date: new Date(),
        read: true,
        starred: false
      };

      // Save to database
      if (session.sentEmails) {
        session.sentEmails.unshift(newEmail);
      }

      getDb().run(
        `INSERT OR REPLACE INTO emails (id, sender, recipient, subject, body, date, labels, read, starred)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newEmail.id, session.user.email, to, subject, body, new Date().toISOString(), 'SENT', 1, 0],
        (err) => {
          if (err) {
            console.error('Database error saving sent email:', err.message);
          }
        }
      );

      res.json({ success: true, message: 'Email sent successfully', email: newEmail });
    } else {
      console.error('Gmail API error:', result.status, result.data);
      res.status(500).json({ error: 'Failed to send email via Gmail API' });
    }
  } catch (err) {
    console.error('Send error:', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// ── POST /api/draft ───────────────────────────────────────────────────────────
// Save a draft email
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
    // Update existing draft or add new one
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

    // Save to database
    getDb().run(
      `INSERT OR REPLACE INTO emails (id, sender, recipient, subject, body, date, labels, read, starred)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [draft.id, session.user.email || 'draft', draft.to, draft.subject, draft.body, new Date().toISOString(), 'DRAFT', 0, 0],
      (err) => {
        if (err) {
          console.error('Database error saving draft:', err.message);
        }
      }
    );

    res.json({ success: true, message: 'Draft saved', draft });
  } catch (err) {
    console.error('Draft save error:', err.message);
    res.status(500).json({ error: 'Failed to save draft: ' + err.message });
  }
});

// ── GET /api/email/:id ────────────────────────────────────────────────────────
// Get a single email by ID
router.get('/email/:id', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing email ID' });

    // Search in all cached emails
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

    // Ensure all required fields are present
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

// ── GET /api/email/:id/scan ───────────────────────────────────────────────────
// Scan email for spam/scam using: Google labels + Keyword detection + ML model
router.get('/email/:id/scan', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    
    // Find email in session cache
    const allEmails = [
      ...(session.userEmails || []),
      ...(session.sentEmails || []),
      ...(session.spamEmails || []),
      ...(session.trashEmails || []),
      ...(session.snoozedEmails || []),
      ...(session.archivedEmails || [])
    ];

    const email = allEmails.find(e => e.id === id);
    if (!email) {
      return res.json({
        level: 'safe',
        score: 0,
        summary: 'Email not found',
        indicators: [],
        recommendations: []
      });
    }

    // FIRST: Check if Google already marked this as spam (most reliable)
    const isGoogleSpam = email.inSpamFolder || (email.labels && email.labels.includes('SPAM'));
    
    if (isGoogleSpam) {
      return res.json({
        level: 'critical',
        score: 95,
        summary: 'Google flagged this as spam',
        indicators: [
          { category: 'Google Security', detail: 'This email is in Gmail spam folder', severity: 'critical', icon: 'gpp_bad' },
          { category: 'Gmail Detection', detail: 'Google marked this as suspicious', severity: 'critical', icon: 'block' }
        ],
        recommendations: [
          'Delete this email',
          'Block the sender in Gmail',
          'Never click links or download attachments from this sender'
        ]
      });
    }

    // SECOND: Use keyword-based detection (fast, no ML latency)
    const emailText = `${email.subject || ''} ${email.body || ''}`;
    const keywordResult = emailSpamKeywordDetector.detectSpam(email.subject || '', email.body || '');

    if (keywordResult.level !== 'safe') {
      // Convert string indicators from keyword detector to object format for consistent UI rendering
      const normalizedIndicators = keywordResult.indicators.map(ind => {
        // Parse indicator string (format: "emoji Category: description")
        const parts = ind.match(/^(.*?)\s+(\w+(?:\s+\w+)*?):\s*(.*)$/);
        if (parts) {
          const [_, emoji, category, detail] = parts;
          const iconMap = { '⚠️': 'warning', '🚨': 'error', '💼': 'work', '🦠': 'virus', '📢': 'notifications', '🎭': 'auto_awesome', '🔗': 'link' };
          const severityMap = { 'Phishing': 'high', 'Financial': 'high', 'Job': 'medium', 'Potential': 'medium', 'Promotional': 'low', 'Brand': 'medium', 'Suspicious': 'high' };
          return {
            category: category.trim(),
            detail: detail.trim(),
            severity: severityMap[category.trim()] || keywordResult.level,
            icon: iconMap[emoji] || 'warning'
          };
        }
        return { category: 'Alert', detail: ind, severity: keywordResult.level, icon: 'warning' };
      });
      
      return res.json({
        level: keywordResult.level,
        score: keywordResult.score,
        summary: `${keywordResult.level.toUpperCase()}: This email appears suspicious`,
        indicators: normalizedIndicators,
        recommendations: keywordResult.recommendations
      });
    }

    // THIRD: Run ML model as backup for emails not caught by keywords
    let prediction;
    try {
      prediction = await spamDetection.predictSpam(emailText);
    } catch (err) {
      console.warn('ML prediction failed:', err.message);
      // If ML fails, return keyword result (which is "safe" at this point)
      return res.json({
        level: 'safe',
        score: 0,
        summary: 'Scanned - Appears legitimate',
        indicators: [],
        recommendations: []
      });
    }

    // Determine risk level based on ML probability
    let level = 'safe';
    if (prediction.isSpam) {
      if (prediction.probability > 0.8) level = 'critical';
      else if (prediction.probability > 0.6) level = 'high';
      else if (prediction.probability > 0.4) level = 'medium';
      else level = 'low';
    }

    const result = {
      level,
      score: Math.round(prediction.probability * 100),
      summary: level === 'safe' ? 'This email appears safe' : `Spam risk detected (${Math.round(prediction.probability * 100)}%)`,
      indicators: [
        level !== 'safe' ? {
          category: 'ML Prediction',
          detail: `ML model detected ${(prediction.probability * 100).toFixed(1)}% probability of spam`,
          severity: level,
          icon: 'warning'
        } : null
      ].filter(Boolean),
      recommendations: level !== 'safe' ? [
        'Be cautious with links and attachments',
        'Verify sender email address',
        'Do not provide personal information'
      ] : []
    };

    res.json(result);
  } catch (err) {
    console.error('Scan email error:', err.message);
    res.json({
      level: 'safe',
      score: 0,
      summary: 'Unable to scan (API error)',
      indicators: [],
      recommendations: []
    });
  }
});

// ── POST /api/emails/inbox/auto-spam-scan ────────────────────────────────────
// Auto-detect and move spam emails (Google labels + Keyword detection + ML)
router.post('/emails/inbox/auto-spam-scan', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { sensitivity = 'normal' } = req.body;
    const threshold = sensitivity === 'strict' ? 0.5 : sensitivity === 'lenient' ? 0.8 : 0.65;

    const inbox = session.userEmails || [];
    const movedIds = [];

    for (const email of inbox) {
      // FIRST: Check if Google already marked as spam  (most reliable)
      const isGoogleSpam = email.inSpamFolder || (email.labels && email.labels.includes('SPAM'));
      if (isGoogleSpam) {
        movedIds.push(email.id);
        continue;
      }

      // SECOND: Use keyword-based detection (fast, no ML latency)
      const keywordResult = emailSpamKeywordDetector.detectSpam(email.subject || '', email.body || '');
      if (keywordResult.level !== 'safe') {
        movedIds.push(email.id);
        continue;
      }

      // THIRD: Use ML model for additional detection
      const emailText = `${email.subject || ''} ${email.body || ''}`;
      try {
        const prediction = await spamDetection.predictSpam(emailText);
        if (prediction.isSpam && prediction.probability > threshold) {
          movedIds.push(email.id);
        }
      } catch (err) {
        // Silently skip ML prediction if API fails
        console.warn(`ML prediction failed for email ${email.id}:`, err.message);
      }
    }

    // Remove from inbox and add to spam
    if (!session.spamEmails) session.spamEmails = [];
    session.userEmails = (session.userEmails || []).filter(e => !movedIds.includes(e.id));
    const movedEmails = inbox.filter(e => movedIds.includes(e.id));
    session.spamEmails.unshift(...movedEmails);

    res.json({
      success: true,
      moved: movedIds.length,
      movedIds
    });
  } catch (err) {
    console.error('Auto-spam scan error:', err.message);
    res.status(500).json({ success: false, moved: 0, error: err.message });
  }
});

// ── PUT /api/email/:id/star ───────────────────────────────────────────────────
// Star or unstar an email
router.put('/email/:id/star', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const allEmailArrays = [
      session.userEmails,
      session.sentEmails,
      session.spamEmails,
      session.trashEmails,
      session.snoozedEmails,
      session.archivedEmails
    ];

    for (const arr of allEmailArrays) {
      if (arr) {
        const email = arr.find(e => e.id === id);
        if (email) {
          email.starred = !email.starred;
          return res.json({ starred: email.starred });
        }
      }
    }

    res.status(404).json({ error: 'Email not found' });
  } catch (err) {
    console.error('Star email error:', err.message);
    res.status(500).json({ error: 'Failed to star email' });
  }
});

// ── PUT /api/email/:id/archive ────────────────────────────────────────────────
// Archive an email
router.put('/email/:id/archive', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const allEmailArrays = [
      session.userEmails,
      session.sentEmails,
      session.spamEmails,
      session.trashEmails,
      session.snoozedEmails
    ];

    for (const arr of allEmailArrays) {
      if (arr) {
        const idx = arr.findIndex(e => e.id === id);
        if (idx >= 0) {
          const email = arr.splice(idx, 1)[0];
          if (!session.archivedEmails) session.archivedEmails = [];
          session.archivedEmails.unshift(email);
          return res.json({ archived: true });
        }
      }
    }

    res.status(404).json({ error: 'Email not found' });
  } catch (err) {
    console.error('Archive email error:', err.message);
    res.status(500).json({ error: 'Failed to archive email' });
  }
});

// ── PUT /api/email/:id/spam ───────────────────────────────────────────────────
// Mark email as spam
router.put('/email/:id/spam', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const allEmailArrays = [
      session.userEmails,
      session.sentEmails,
      session.trashEmails,
      session.snoozedEmails,
      session.archivedEmails
    ];

    for (const arr of allEmailArrays) {
      if (arr) {
        const idx = arr.findIndex(e => e.id === id);
        if (idx >= 0) {
          const email = arr.splice(idx, 1)[0];
          if (!session.spamEmails) session.spamEmails = [];
          session.spamEmails.unshift(email);
          return res.json({ moved: true });
        }
      }
    }

    res.status(404).json({ error: 'Email not found' });
  } catch (err) {
    console.error('Mark spam error:', err.message);
    res.status(500).json({ error: 'Failed to mark as spam' });
  }
});

// ── PUT /api/email/:id/read ───────────────────────────────────────────────────
// Mark email as read/unread
router.put('/email/:id/read', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const { read = true } = req.body;
    const allEmailArrays = [
      session.userEmails,
      session.sentEmails,
      session.spamEmails,
      session.trashEmails,
      session.snoozedEmails,
      session.archivedEmails
    ];

    for (const arr of allEmailArrays) {
      if (arr) {
        const email = arr.find(e => e.id === id);
        if (email) {
          email.read = read;
          email.unread = !read;
          return res.json({ read });
        }
      }
    }

    res.status(404).json({ error: 'Email not found' });
  } catch (err) {
    console.error('Mark read error:', err.message);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ── DELETE /api/email/:id ─────────────────────────────────────────────────────
// Delete (move to trash) an email
router.delete('/email/:id', (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;
    const allEmailArrays = [
      session.userEmails,
      session.sentEmails,
      session.spamEmails,
      session.snoozedEmails,
      session.archivedEmails
    ];

    for (const arr of allEmailArrays) {
      if (arr) {
        const idx = arr.findIndex(e => e.id === id);
        if (idx >= 0) {
          const email = arr.splice(idx, 1)[0];
          if (!session.trashEmails) session.trashEmails = [];
          session.trashEmails.unshift(email);
          return res.json({ deleted: true });
        }
      }
    }

    res.status(404).json({ error: 'Email not found' });
  } catch (err) {
    console.error('Delete email error:', err.message);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

module.exports = router;
