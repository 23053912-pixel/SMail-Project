'use strict';

/**
 * Unit tests for email-scan routes (scan logic)
 * Run with: node --test backend/__tests__/email-scan.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { sampleEmail } = require('./helpers');

describe('email-scan route logic', () => {
  describe('Google spam detection', () => {
    it('detects email in spam folder', () => {
      const email = sampleEmail({ inSpamFolder: true });
      const isGoogleSpam = email.inSpamFolder || (email.labels && email.labels.includes('SPAM'));
      assert.equal(isGoogleSpam, true);
    });

    it('detects email with SPAM label', () => {
      const email = sampleEmail({ labels: ['SPAM'] });
      const isGoogleSpam = email.inSpamFolder || (email.labels && email.labels.includes('SPAM'));
      assert.equal(isGoogleSpam, true);
    });

    it('does not flag normal email', () => {
      const email = sampleEmail({ labels: ['INBOX'] });
      const isGoogleSpam = email.inSpamFolder || (email.labels && email.labels.includes('SPAM'));
      assert.equal(isGoogleSpam, false);
    });
  });

  describe('ML risk level determination', () => {
    function getLevel(prediction) {
      let level = 'safe';
      if (prediction.isSpam) {
        if (prediction.probability > 0.8) level = 'critical';
        else if (prediction.probability > 0.6) level = 'high';
        else if (prediction.probability > 0.4) level = 'medium';
        else level = 'low';
      }
      return level;
    }

    it('returns safe for non-spam', () => {
      assert.equal(getLevel({ isSpam: false, probability: 0.1 }), 'safe');
    });

    it('returns low for low spam probability', () => {
      assert.equal(getLevel({ isSpam: true, probability: 0.3 }), 'low');
    });

    it('returns medium for medium spam probability', () => {
      assert.equal(getLevel({ isSpam: true, probability: 0.5 }), 'medium');
    });

    it('returns high for high spam probability', () => {
      assert.equal(getLevel({ isSpam: true, probability: 0.7 }), 'high');
    });

    it('returns critical for very high spam probability', () => {
      assert.equal(getLevel({ isSpam: true, probability: 0.9 }), 'critical');
    });
  });

  describe('Auto-spam scan threshold', () => {
    it('applies strict threshold (0.5)', () => {
      const sensitivity = 'strict';
      const threshold = sensitivity === 'strict' ? 0.5 : sensitivity === 'lenient' ? 0.8 : 0.65;
      assert.equal(threshold, 0.5);
    });

    it('applies normal threshold (0.65)', () => {
      const sensitivity = 'normal';
      const threshold = sensitivity === 'strict' ? 0.5 : sensitivity === 'lenient' ? 0.8 : 0.65;
      assert.equal(threshold, 0.65);
    });

    it('applies lenient threshold (0.8)', () => {
      const sensitivity = 'lenient';
      const threshold = sensitivity === 'strict' ? 0.5 : sensitivity === 'lenient' ? 0.8 : 0.65;
      assert.equal(threshold, 0.8);
    });

    it('flags email above threshold', () => {
      const threshold = 0.65;
      const probability = 0.75;
      assert.ok(probability > threshold);
    });

    it('does not flag email below threshold', () => {
      const threshold = 0.65;
      const probability = 0.50;
      assert.ok(probability <= threshold);
    });
  });

  describe('Indicator normalization', () => {
    it('parses indicator string format', () => {
      const ind = '⚠️ Phishing: Fake login page detected';
      const parts = ind.match(/^(.*?)\s+(\w+(?:\s+\w+)*?):\s*(.*)$/);
      assert.ok(parts);
      assert.equal(parts[1], '⚠️');
      assert.equal(parts[2], 'Phishing');
      assert.equal(parts[3], 'Fake login page detected');
    });

    it('handles indicator without emoji', () => {
      const ind = 'Some alert message';
      const parts = ind.match(/^(.*?)\s+(\w+(?:\s+\w+)*?):\s*(.*)$/);
      // This won't match the pattern — falls back to generic handler
      assert.equal(parts, null);
    });
  });
});
