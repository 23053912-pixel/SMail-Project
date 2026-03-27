'use strict';

/**
 * Spam Detection Service
 * Integrates with ML model and handles spam detection logic
 * Communicates with the Python ML API for predictions
 */

const http = require('http');
const https = require('https');

// ML API Configuration
const ML_HOST = process.env.ML_API_HOST || 'localhost';
const ML_PORT = parseInt(process.env.ML_API_PORT || '5001', 10);
const ML_PROTOCOL = ML_PORT === 443 ? https : http;

/**
 * Call ML API to predict if an email is spam
 * @param {string} emailText - Email body/subject combined text
 * @returns {Promise<Object>} ML prediction result { isSpam, probability, confidence }
 */
async function predictSpam(emailText) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: emailText });
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
      timeout: 10000
    };

    const req = ML_PROTOCOL.request(options, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({
            isSpam: result.prediction === 1 || result.prediction === 'spam',
            probability: result.spam_probability || result.probability || result.confidence || 0,
            rawPrediction: result
          });
        } catch (err) {
          reject(new Error(`Failed to parse ML response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`ML API request error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.abort();
      reject(new Error('ML API request timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Batch predict spam for multiple emails
 * @param {Array} emails - Array of email objects with body/subject
 * @returns {Promise<Array>} Array of predictions with email id and spam result
 */
async function predictSpamBatch(emails) {
  const predictions = [];
  
  for (const email of emails) {
    try {
      const emailText = `${email.subject || ''} ${email.body || ''}`;
      const prediction = await predictSpam(emailText);
      
      predictions.push({
        emailId: email.id,
        ...prediction,
        processedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error(`Spam prediction error for email ${email.id}:`, err.message);
      predictions.push({
        emailId: email.id,
        isSpam: false,
        probability: 0,
        error: err.message,
        processedAt: new Date().toISOString()
      });
    }
  }
  
  return predictions;
}

/**
 * Pre-warm ML model at startup for instant first prediction
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
    timeout: 3000
  };

  const req = ML_PROTOCOL.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => console.log('✓ ML model pre-warmed (first prediction cached)'));
  });

  req.on('error', () => console.log('⚠ ML model warmup skipped (API not ready)'));
  req.on('timeout', () => req.abort());
  
  req.write(body);
  req.end();
}

/**
 * Calculate spam score based on multiple factors
 * @param {Object} email - Email object
 * @param {Object} mlPrediction - ML model prediction result
 * @returns {number} Spam score 0-1
 */
function calculateSpamScore(email, mlPrediction) {
  let score = 0;
  
  // Base score from ML model
  score += (mlPrediction?.probability || 0) * 0.7;
  
  // Check for suspicious characteristics
  if (!email.from || email.from === 'Unknown Sender') score += 0.15;
  if (!email.subject || email.subject === '(No Subject)') score += 0.1;
  
  return Math.min(score, 1);
}

module.exports = {
  predictSpam,
  predictSpamBatch,
  warmupMLModel,
  calculateSpamScore
};
