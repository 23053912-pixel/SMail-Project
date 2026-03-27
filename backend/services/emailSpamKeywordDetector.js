'use strict';

/**
 * Keyword-Based Email Spam Detector
 * Fast, reliable email spam detection without ML training delays
 * Detects: phishing, scams, malware, promotional spam, and fraudulent offers
 */

class EmailSpamDetector {
  constructor() {
    // Phishing patterns (fake login requests, credential theft)
    this.phishingKeywords = [
      'verify identity', 'confirm account', 'verify account', 'verify credentials',
      'update password', 'reset password', 'confirm password', 'authenticate',
      'sign in', 'log in', 'click here', 'click link', 'urgent action required',
      'account suspended', 'account locked', 'verify payment', 'update payment',
      'billing problem', 'payment declined', 'reactivate account', 'unlock account'
    ];

    // Financial fraud patterns (crypto, investment scams, money offers)
    this.fraudKeywords = [
      'bitcoin', 'ethereum', 'crypto', 'cryptocurrency', 'blockchain',
      'investment opportunity', 'guaranteed return', 'high yield', 'guaranteed profit',
      'stop loss', 'forex', 'trading signal', 'stock tip', 'penny stock',
      'lottery winner', 'inheritance', 'tax refund', 'million dollar', 'claim reward',
      'microloan', 'payday loan', 'quick cash', 'easy money', 'earn money fast'
    ];

    // Promotional spam patterns
    this.promotionalKeywords = [
      '90% off', '95% discount', 'special offer', 'limited time', 'act now',
      'exclusive deal', 'buy now', 'shop now', 'order now', 'don\'t miss',
      'unbelievable price', 'free gift', 'free shipping', 'free sample',
      'click to claim', 'apply now', 'register today'
    ];

    // Malware/malicious patterns
    this.malwareKeywords = [
      'download now', 'install software', 'run this file', 'enable macros',
      'security alert', 'virus detected', 'malware warning', 'immediate action',
      'your computer', 'suspicious activity', 'antivirus', 'security software',
      'update now', 'patch available'
    ];

    // Job scam patterns
    this.jobScamKeywords = [
      'work from home', 'earn money at home', 'easy job', 'no experience needed',
      'no qualifications', 'quick money', 'high paying job', 'part time job',
      'job opportunity', 'recruitment', 'hiring now', 'urgent hiring',
      'monthly salary', 'per week', 'per day', 'instant job'
    ];

    // Dating/romance scam patterns
    this.romanceKeywords = [
      'dating site', 'singles in your area', 'meet women', 'meet men',
      'chat now', 'flirt', 'lonely', 'single and ready', 'love match',
      'romance', 'dating opportunity', 'exclusive members'
    ];

    // Tech impersonation (Apple, Google, Microsoft, Adobe, etc.)
    this.techBrandKeywords = [
      'apple id', 'icloud', 'itunes', 'google account', 'gmail', 'google play',
      'microsoft account', 'office365', 'windows update', 'adobe account',
      'adobe creative', 'netflix account', 'amazon account', 'paypal account',
      'twitter account', 'facebook account', 'instagram account'
    ];

    // Suspicious link/domain patterns
    this.suspiciousPatterns = [
      '-verify', '-confirm', '-update', '-secure', '-account', '-login',
      '-banking', '-paypal', '-apple', '-amazon', '-google', '-microsoft'
    ];
  }

  /**
   * Detect if email is spam
   * @param {string} subject - Email subject
   * @param {string} body - Email body text
   * @returns {Object} { isSpam, level, score, indicators, recommendations }
   */
  detectSpam(subject = '', body = '') {
    const text = `${subject} ${body}`.toLowerCase();
    const indicators = [];
    let score = 0;

    // Check phishing patterns
    if (this.matchesKeywords(text, this.phishingKeywords)) {
      score += 35;
      indicators.push('⚠️ Phishing attempt: Requesting account verification or credentials');
    }

    // Check financial fraud
    if (this.matchesKeywords(text, this.fraudKeywords)) {
      score += 40;
      indicators.push('🚨 Financial scam: Offering unrealistic investment returns or money');
    }

    // Check job scams
    if (this.matchesKeywords(text, this.jobScamKeywords)) {
      score += 30;
      indicators.push('💼 Job scam: Too-good-to-be-true employment opportunity');
    }

    // Check malware patterns
    if (this.matchesKeywords(text, this.malwareKeywords)) {
      score += 35;
      indicators.push('🦠 Potential malware: Requesting to download/install files');
    }

    // Check promotional spam
    if (this.matchesKeywords(text, this.promotionalKeywords)) {
      score += 15;
      indicators.push('📢 Promotional: Suspicious discount or special offer');
    }

    // Check tech brand impersonation
    if (this.matchesKeywords(text, this.techBrandKeywords)) {
      // Only count if it also has phishing/fraud indicators
      if (score > 0) {
        score += 15;
        indicators.push('🎭 Brand impersonation: Fake tech company notification');
      }
    }

    // Check for suspicious URL patterns
    if (this.hasSuspiciousUrls(text)) {
      score += 25;
      indicators.push('🔗 Suspicious links: Shortened or spoofed URLs detected');
    }

    // Determine severity level
    let level = 'safe';
    if (score >= 75) level = 'critical';
    else if (score >= 60) level = 'high';
    else if (score >= 40) level = 'medium';
    else if (score > 0) level = 'low';

    return {
      isSpam: score > 15,
      level,
      score: Math.min(score, 100),
      indicators,
      recommendations: this.getRecommendations(level)
    };
  }

  matchesKeywords(text, keywords) {
    return keywords.some(kw => {
      // Try whole word match first
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      return regex.test(text);
    });
  }

  hasSuspiciousUrls(text) {
    // Check for URL shorteners common in phishing
    const shorteners = ['bit.ly', 'tinyurl', 'short.url', 'ow.ly', 'goo.gl'];
    const hasShortenedUrl = shorteners.some(s => text.includes(s));

    // Check for suspicious patterns in domainsifs
    const suspiciousDomains = /[a-z]+-[a-z]+-[a-z]+\.(tk|ml|ga|cf|com)/gi;
    const hasSuspiciousDomain = suspiciousDomains.test(text);

    // Check for IP-based URLs (often phishing)
    const ipUrl = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
    const hasIpUrl = ipUrl.test(text);

    return hasShortenedUrl || hasSuspiciousDomain || hasIpUrl;
  }

  getRecommendations(level) {
    const recommendations = {
      critical: [
        '❌ DELETE this email immediately',
        '🚫 Block the sender',
        '⚠️ Never click links or download attachments',
        '📞 Call the official company directly to verify',
        '🛡️ Report to spam/abuse'
      ],
      high: [
        '⚠️ Be very careful - do not click links',
        '❓ Verify with the company before responding',
        '📞 Use official contact information, not this email',
        '🗑️ Delete or move to spam'
      ],
      medium: [
        '🤔 Be cautious about clicking links',
        '✓ Verify sender address carefully',
        '📋 Review unfamiliar offer details'
      ],
      low: [
        '✓ Likely suspicious but review context',
        '👀 Verify sender if you don\'t recognize them'
      ],
      safe: [
        '✓ Appears to be legitimate'
      ]
    };

    return recommendations[level] || recommendations.safe;
  }
}

module.exports = new EmailSpamDetector();
