'use strict';

/**
 * Enhanced Spam Detection Service
 * 
 * Improvements:
 * 1. Sender email passed to ML API for domain reputation
 * 2. Local domain reputation checking (fast path)
 * 3. Email-specific feature extraction
 * 4. Prediction logging
 * 5. Multi-tier detection (domain → rules → ML)
 */

const http = require('http');
const https = require('https');

// ML API Configuration
const ML_HOST = process.env.ML_API_HOST || 'localhost';
const ML_PORT = parseInt(process.env.ML_API_PORT || '5001', 10);
const ML_PROTOCOL = ML_PORT === 443 ? https : http;

// Persistent HTTP agent for connection reuse
const _keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

// ── Known spam/phishing domains (local cache for fast path) ──────────────────
const KNOWN_SPAM_DOMAINS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd',
  't.co', 'buff.ly', 'adf.ly', 'bc.vc',
  // Phishing domains
  'secure-bankofamerica.com', 'paypal-verify.com', 'apple-id.com',
  'microsoft-support.com', 'amazon-security.com', 'netflix-billing.com',
  'google-security.com', 'facebook-security.com', 'instagram-verify.com',
  // Known spam senders
  'spam.com', 'spammy.com', 'junk.com', 'bulk.com',
]);

// Suspicious TLDs
const SUSPICIOUS_TLDS = new Set(['.xyz', '.top', '.work', '.click', '.link', '.info', '.buzz', '.loan']);

// ── Feature Extraction ────────────────────────────────────────────────────────

/**
 * Extract email-specific features for spam detection
 * @param {string} text - Email text (subject + body)
 * @param {string} senderEmail - Sender email address
 * @returns {Object} Extracted features
 */
function extractEmailFeatures(text, senderEmail = null) {
  const features = {
    urlCount: 0,
    hasIpUrl: false,
    hasShortenedUrl: false,
    exclamationCount: 0,
    uppercaseRatio: 0,
    specialCharRatio: 0,
    urgencyScore: 0,
    financialScore: 0,
    textLength: 0,
    wordCount: 0,
    hasHtml: false,
  };

  if (!text) return features;

  const textStr = String(text);
  const textLower = textStr.toLowerCase();

  // URL features
  const urls = textStr.match(/https?:\/\/\S+|www\.\S+/g) || [];
  features.urlCount = urls.length;
  features.hasIpUrl = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(textStr);
  features.hasShortenedUrl = urls.some(u => {
    try {
      const hostname = new URL(u.startsWith('http') ? u : `http://${u}`).hostname;
      return KNOWN_SPAM_DOMAINS.has(hostname);
    } catch {
      return false;
    }
  });

  // Character analysis
  features.exclamationCount = (textStr.match(/!/g) || []).length;
  features.uppercaseRatio = textStr.length > 0 
    ? (textStr.match(/[A-Z]/g) || []).length / textStr.length 
    : 0;
  features.specialCharRatio = textStr.length > 0 
    ? (textStr.match(/[^a-zA-Z0-9\s]/g) || []).length / textStr.length 
    : 0;

  // Urgency indicators
  const urgencyWords = ['urgent', 'immediate', 'act now', 'limited time', 'expires', 'deadline', 'hurry', 'warning', 'alert'];
  features.urgencyScore = urgencyWords.filter(w => textLower.includes(w)).length;

  // Financial indicators
  const financialWords = ['free', 'winner', 'congratulations', 'prize', 'reward', 'cash', 'bonus', 'offer', 'guarantee', 'no risk'];
  features.financialScore = financialWords.filter(w => textLower.includes(w)).length;

  // Text statistics
  features.textLength = textStr.length;
  features.wordCount = textStr.split(/\s+/).filter(w => w.length > 0).length;
  features.hasHtml = /<html|<body/i.test(textStr);

  return features;
}

/**
 * Check sender domain reputation (local fast path)
 * @param {string} senderEmail - Sender email address
 * @returns {Object} Domain reputation result
 */
function checkDomainReputation(senderEmail) {
  if (!senderEmail) {
    return { isSuspicious: false, reasons: [], domain: null };
  }

  // Extract domain
  const match = senderEmail.match(/@([\w.-]+)/);
  if (!match) {
    return { isSuspicious: true, reasons: ['invalid_email_format'], domain: null };
  }

  const domain = match[1].toLowerCase();
  const reasons = [];

  // Check against known spam domains
  if (KNOWN_SPAM_DOMAINS.has(domain)) {
    reasons.push('known_spam_domain');
  }

  // Check suspicious TLDs
  for (const tld of SUSPICIOUS_TLDS) {
    if (domain.endsWith(tld)) {
      reasons.push(`suspicious_tld:${tld}`);
      break;
    }
  }

  // Check for typosquatting
  const typosquatPatterns = [
    ['gmail', ['gmai1', 'gmial', 'gmal', 'gmaill', 'gmil']],
    ['yahoo', ['yaho0', 'yahho', 'yhaoo']],
    ['outlook', ['outlok', 'outloo', 'outlooook']],
    ['hotmail', ['hotmal', 'hotmai1', 'hotmial']],
  ];
  for (const [legit, fakes] of typosquatPatterns) {
    if (fakes.some(fake => domain.includes(fake))) {
      reasons.push(`typosquatting:${legit}`);
      break;
    }
  }

  // Check for numeric-only domains (e.g., 123456.com)
  const domainParts = domain.split('.');
  if (domainParts.length >= 2 && /^[\d.]+$/.test(domainParts[0])) {
    reasons.push('numeric_only_domain');
  }

  return {
    isSuspicious: reasons.length > 0,
    reasons,
    domain
  };
}

/**
 * Rule-based spam classification
 * @param {string} text - Email text
 * @param {string} senderEmail - Sender email
 * @returns {Object} Rule-based classification result
 */
function classifyWithRules(text, senderEmail = null) {
  const textLower = (text || '').toLowerCase();
  let score = 0;
  const reasons = [];

  // Urgency patterns - high confidence
  if (/urgent|act now|limited time/.test(textLower)) {
    score += 50;
    reasons.push('urgency_language');
  }

  // Financial scam patterns
  if (/you.*won|congratulations|claim.*prize|free.*gift/.test(textLower)) {
    score += 60;
    reasons.push('prize_scam');
  }

  // Phishing patterns
  if (/verify.*account|confirm.*identity|update.*payment|account.*suspended/.test(textLower)) {
    score += 55;
    reasons.push('phishing_language');
  }

  // Crypto/investment scam
  if (/bitcoin|crypto|investment.*guaranteed|double.*money|500.*return/.test(textLower)) {
    score += 60;
    reasons.push('crypto_scam');
  }

  // Pharmacy spam
  if (/pharmacy|viagra|cialis|prescription.*free|buy.*drugs/.test(textLower)) {
    score += 60;
    reasons.push('pharmacy_spam');
  }

  // Check sender reputation
  if (senderEmail) {
    const domainResult = checkDomainReputation(senderEmail);
    if (domainResult.isSuspicious) {
      score += 25;
      reasons.push(...domainResult.reasons);
    }
  }

  return {
    isSpam: score >= 50,
    spamScore: Math.min(score / 100.0, 1.0),
    reasons,
    method: 'rules'
  };
}

// ── ML API Calls ─────────────────────────────────────────────────────────────

/**
 * Call ML API with sender email for enhanced prediction
 * @param {string} emailText - Email body/subject combined
 * @param {string} senderEmail - Sender email for domain reputation
 * @returns {Promise<Object>} Enhanced prediction result
 */
async function predictSpam(emailText, senderEmail = null) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ 
      text: emailText,
      sender_email: senderEmail  // Pass sender for domain reputation
    });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    
    const options = {
      hostname: ML_HOST,
      port: ML_PORT,
      path: '/predict',
      method: 'POST',
      headers,
      timeout: 10000,
      agent: _keepAliveAgent
    };

    const req = ML_PROTOCOL.request(options, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          // Handle enhanced API response with details
          if (result.details) {
            resolve({
              isSpam: result.prediction === 'spam',
              probability: result.spam_probability,
              confidence: result.confidence,
              mlUsed: result.details.ml !== null,
              ruleFlags: result.details.rules?.reasons || [],
              domainFlags: result.details.domain?.reasons || [],
              rawPrediction: result
            });
          } else {
            // Fallback for basic API
            resolve({
              isSpam: result.prediction === 1 || result.prediction === 'spam',
              probability: result.spam_probability || result.probability || result.confidence || 0,
              confidence: result.confidence || result.spam_probability || 0,
              mlUsed: true,
              ruleFlags: [],
              domainFlags: [],
              rawPrediction: result
            });
          }
        } catch (err) {
          reject(new Error(`Failed to parse ML response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`ML API request error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ML API request timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Enhanced batch predict with sender emails
 * @param {Array} emails - Array of email objects with id, subject, body, from
 * @returns {Promise<Array>} Array of predictions
 */
async function predictSpamBatch(emails) {
  const BATCH_CONCURRENCY = 5;

  const tasks = emails.map(async (email) => {
    try {
      const emailText = `${email.subject || ''} ${email.body || ''}`;
      const senderEmail = email.from || null;
      
      // Get ML prediction
      const mlResult = await predictSpam(emailText, senderEmail);
      
      // Get local rule-based classification
      const ruleResult = classifyWithRules(emailText, senderEmail);
      
      // Get domain reputation
      const domainResult = checkDomainReputation(senderEmail);
      
      // Combine scores (ML 60%, Rules 30%, Domain 10%)
      const mlScore = mlResult.probability || 0;
      const ruleScore = ruleResult.spamScore;
      const domainScore = domainResult.isSuspicious ? 1.0 : 0.0;
      
      let finalScore = (0.6 * mlScore) + (0.3 * ruleScore) + (0.1 * domainScore);
      
      // High-confidence overrides
      if (ruleResult.isSpam && ruleResult.spamScore > 0.7) {
        finalScore = Math.max(finalScore, 0.9);
      }
      if (domainResult.isSuspicious && domainResult.reasons.includes('known_spam_domain')) {
        finalScore = Math.max(finalScore, 0.85);
      }

      return {
        emailId: email.id,
        isSpam: finalScore >= 0.5,
        probability: finalScore,
        confidence: Math.max(finalScore, 1 - finalScore),
        mlUsed: mlResult.mlUsed,
        ruleFlags: ruleResult.reasons,
        domainFlags: domainResult.reasons,
        processedAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`Spam prediction error for email ${email.id}:`, err.message);
      return {
        emailId: email.id,
        isSpam: false,
        probability: 0,
        confidence: 0,
        mlUsed: false,
        ruleFlags: [],
        domainFlags: [],
        error: err.message,
        processedAt: new Date().toISOString()
      };
    }
  });

  // Run in batches to avoid overwhelming the ML API
  const results = [];
  for (let i = 0; i < tasks.length; i += BATCH_CONCURRENCY) {
    const batch = tasks.slice(i, i + BATCH_CONCURRENCY);
    const settled = await Promise.allSettled(batch);
    results.push(...settled.map(r => r.status === 'fulfilled' ? r.value : {
      emailId: emails[i]?.id,
      isSpam: false,
      probability: 0,
      confidence: 0,
      error: r.reason?.message || 'Unknown error',
      processedAt: new Date().toISOString()
    }));
  }

  return results;
}

/**
 * Quick domain check (no ML API call)
 * @param {string} senderEmail - Sender email
 * @returns {Object} Domain check result
 */
function quickDomainCheck(senderEmail) {
  return checkDomainReputation(senderEmail);
}

/**
 * Pre-warm ML model at startup
 */
async function warmupMLModel() {
  const warmupText = 'This is a test email for model warmup';
  const body = JSON.stringify({ text: warmupText });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };
  
  const options = {
    hostname: ML_HOST,
    port: ML_PORT,
    path: '/predict',
    method: 'POST',
    headers,
    timeout: 3000,
    agent: _keepAliveAgent
  };

  return new Promise((resolve) => {
    const req = ML_PROTOCOL.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log('✓ ML model pre-warmed');
        resolve(true);
      });
    });

    req.on('error', () => {
      console.log('⚠ ML model warmup skipped (API not ready)');
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    
    req.write(body);
    req.end();
  });
}

module.exports = {
  predictSpam,
  predictSpamBatch,
  warmupMLModel,
  quickDomainCheck,
  checkDomainReputation,
  classifyWithRules,
  extractEmailFeatures
};
