'use strict';

/**
 * Email scan routes — spam detection, auto-spam-scan
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { markEmailsDirty } = require('../utils/session');
const spamDetection = require('../services/spamDetection');
const emailSpamKeywordDetector = require('../services/emailSpamKeywordDetector');

const router = express.Router();

// ── GET /api/email/:id/scan ───────────────────────────────────────────────────
router.get('/email/:id/scan', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { id } = req.params;

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

    // FIRST: Check if Google already marked this as spam
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

    // SECOND: Keyword-based detection
    const keywordResult = emailSpamKeywordDetector.detectSpam(email.subject || '', email.body || '');

    if (keywordResult.level !== 'safe') {
      const normalizedIndicators = keywordResult.indicators.map(ind => {
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

    // THIRD: ML model as backup
    const emailText = `${email.subject || ''} ${email.body || ''}`;
    let prediction;
    try {
      prediction = await spamDetection.predictSpam(emailText);
    } catch (err) {
      console.warn('ML prediction failed:', err.message);
      return res.json({
        level: 'safe',
        score: 0,
        summary: 'Scanned - Appears legitimate',
        indicators: [],
        recommendations: []
      });
    }

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
router.post('/emails/inbox/auto-spam-scan', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const { sensitivity = 'normal' } = req.body;
    const threshold = sensitivity === 'strict' ? 0.5 : sensitivity === 'lenient' ? 0.8 : 0.65;

    const inbox = session.userEmails || [];
    const movedIds = [];

    // First pass: fast checks (no ML calls)
    const needsML = [];
    for (const email of inbox) {
      const isGoogleSpam = email.inSpamFolder || (email.labels && email.labels.includes('SPAM'));
      if (isGoogleSpam) {
        movedIds.push(email.id);
        continue;
      }
      const keywordResult = emailSpamKeywordDetector.detectSpam(email.subject || '', email.body || '');
      if (keywordResult.level !== 'safe') {
        movedIds.push(email.id);
        continue;
      }
      needsML.push(email);
    }

    // Second pass: ML predictions in parallel
    const ML_CONCURRENCY = 5;
    for (let i = 0; i < needsML.length; i += ML_CONCURRENCY) {
      const batch = needsML.slice(i, i + ML_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(email => {
          const emailText = `${email.subject || ''} ${email.body || ''}`;
          return spamDetection.predictSpam(emailText);
        })
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled' && result.value.isSpam && result.value.probability > threshold) {
          movedIds.push(batch[j].id);
        }
      }
    }

    // Remove from inbox and add to spam
    if (!session.spamEmails) session.spamEmails = [];
    session.userEmails = (session.userEmails || []).filter(e => !movedIds.includes(e.id));
    const movedEmails = inbox.filter(e => movedIds.includes(e.id));
    session.spamEmails.unshift(...movedEmails);
    markEmailsDirty(session);

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

module.exports = router;
