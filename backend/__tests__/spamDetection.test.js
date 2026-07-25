'use strict';

/**
 * Tests for Enhanced Spam Detection
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Import the spam detection service
const spamDetection = require('../services/spamDetection');

describe('Enhanced Spam Detection', () => {
  
  describe('checkDomainReputation', () => {
    it('should flag known spam domains', () => {
      const result = spamDetection.checkDomainReputation('user@bit.ly');
      assert.equal(result.isSuspicious, true);
      assert.ok(result.reasons.includes('known_spam_domain'));
    });

    it('should flag suspicious TLDs', () => {
      const result = spamDetection.checkDomainReputation('user@malware.xyz');
      assert.equal(result.isSuspicious, true);
      assert.ok(result.reasons.some(r => r.startsWith('suspicious_tld')));
    });

    it('should flag typosquatting domains', () => {
      const result = spamDetection.checkDomainReputation('user@gmai1.com');
      assert.equal(result.isSuspicious, true);
      assert.ok(result.reasons.some(r => r.includes('typosquatting')));
    });

    it('should flag numeric-only domains', () => {
      const result = spamDetection.checkDomainReputation('user@123456.com');
      assert.equal(result.isSuspicious, true);
      assert.ok(result.reasons.includes('numeric_only_domain'));
    });

    it('should pass legitimate domains', () => {
      const result = spamDetection.checkDomainReputation('user@gmail.com');
      assert.equal(result.isSuspicious, false);
      assert.equal(result.reasons.length, 0);
    });

    it('should handle invalid email format', () => {
      const result = spamDetection.checkDomainReputation('invalid-email');
      assert.equal(result.isSuspicious, true);
      assert.ok(result.reasons.includes('invalid_email_format'));
    });

    it('should handle null/empty sender', () => {
      const result = spamDetection.checkDomainReputation(null);
      assert.equal(result.isSuspicious, false);
    });
  });

  describe('classifyWithRules', () => {
    it('should detect urgency language', () => {
      const result = spamDetection.classifyWithRules('URGENT: Act now before it expires!');
      assert.equal(result.isSpam, true);
      assert.ok(result.reasons.includes('urgency_language'));
    });

    it('should detect prize scams', () => {
      const result = spamDetection.classifyWithRules('Congratulations! You won a prize!');
      assert.equal(result.isSpam, true);
      assert.ok(result.reasons.includes('prize_scam'));
    });

    it('should detect phishing language', () => {
      const result = spamDetection.classifyWithRules('Verify your account immediately');
      assert.equal(result.isSpam, true);
      assert.ok(result.reasons.includes('phishing_language'));
    });

    it('should detect crypto scams', () => {
      const result = spamDetection.classifyWithRules('Bitcoin investment: 500% guaranteed returns');
      assert.equal(result.isSpam, true);
      assert.ok(result.reasons.includes('crypto_scam'));
    });

    it('should detect pharmacy spam', () => {
      const result = spamDetection.classifyWithRules('Buy cheap pharmacy viagra cialis');
      assert.equal(result.isSpam, true);
      assert.ok(result.reasons.includes('pharmacy_spam'));
    });

    it('should flag suspicious sender domains', () => {
      const result = spamDetection.classifyWithRules('Hello friend', 'user@bit.ly');
      assert.ok(result.reasons.includes('known_spam_domain'));
    });

    it('should pass legitimate emails', () => {
      const result = spamDetection.classifyWithRules('Hi, the meeting is at 3 PM', 'colleague@company.com');
      assert.equal(result.isSpam, false);
    });

    it('should handle empty text', () => {
      const result = spamDetection.classifyWithRules('');
      assert.equal(result.isSpam, false);
    });
  });

  describe('extractEmailFeatures', () => {
    it('should count URLs', () => {
      const features = spamDetection.extractEmailFeatures('Visit https://example.com and www.test.com');
      assert.equal(features.urlCount, 2);
    });

    it('should detect IP-based URLs', () => {
      const features = spamDetection.extractEmailFeatures('Click http://192.168.1.1/malware');
      assert.equal(features.hasIpUrl, true);
    });

    it('should detect shortened URLs', () => {
      const features = spamDetection.extractEmailFeatures('Link: http://bit.ly/abc123');
      assert.equal(features.hasShortenedUrl, true);
    });

    it('should count exclamation marks', () => {
      const features = spamDetection.extractEmailFeatures('Free!!! Claim now!!!');
      assert.ok(features.exclamationCount >= 2);
    });

    it('should calculate uppercase ratio', () => {
      const features = spamDetection.extractEmailFeatures('FREE OFFER NOW');
      assert.ok(features.uppercaseRatio > 0.5);
    });

    it('should detect urgency words', () => {
      const features = spamDetection.extractEmailFeatures('Urgent action required immediately');
      assert.ok(features.urgencyScore >= 2);
    });

    it('should detect financial words', () => {
      const features = spamDetection.extractEmailFeatures('Free winner congratulations prize');
      assert.ok(features.financialScore >= 3);
    });

    it('should detect HTML content', () => {
      const features = spamDetection.extractEmailFeatures('<html><body>Hello</body></html>');
      assert.equal(features.hasHtml, true);
    });
  });

  describe('quickDomainCheck', () => {
    it('should return domain reputation result', () => {
      const result = spamDetection.quickDomainCheck('user@gmail.com');
      assert.equal(result.domain, 'gmail.com');
      assert.equal(result.isSuspicious, false);
    });

    it('should work with null input', () => {
      const result = spamDetection.quickDomainCheck(null);
      assert.equal(result.isSuspicious, false);
    });
  });
});
