'use strict';

/**
 * Email Processing Orchestrator
 * Coordinates email fetching, categorization, and spam detection
 * Integrates all three email processing services
 */

const emailFetching = require('./emailFetching');
const emailCategorization = require('./emailCategorization');
const spamDetection = require('./spamDetection');

/**
 * Full email processing pipeline
 * Fetches emails, categorizes them, and detects spam
 * @param {Object} gmail - Gmail client instance
 * @param {string} query - Gmail query string
 * @param {number} maxResults - Max emails to fetch
 * @param {string} userEmail - User's email address
 * @returns {Promise<Object>} Processed emails with categories and spam predictions
 */
async function processEmails(gmail, query, maxResults, userEmail) {
  try {
    // Step 1: Fetch emails from Gmail
    console.log('📬 Fetching emails...');
    const fetchResult = await emailFetching.fetchGmailMessageList(
      gmail,
      query,
      maxResults,
      userEmail
    );
    const emails = fetchResult.messages;
    console.log(`✓ Fetched ${emails.length} emails`);

    // Step 2: Categorize emails
    console.log('📂 Categorizing emails...');
    const categorized = emailCategorization.categorizeBatch(emails);
    const emailsWithCategories = emails.map((email, idx) => ({
      ...email,
      categories: categorized[idx].categories
    }));
    console.log(`✓ Categorized ${emailsWithCategories.length} emails`);

    // Step 3: Detect spam using ML model
    console.log('🤖 Running spam detection...');
    const spamPredictions = await spamDetection.predictSpamBatch(emailsWithCategories);
    const emailsWithSpamScores = emailsWithCategories.map((email, idx) => ({
      ...email,
      spam: spamPredictions[idx]
    }));
    console.log(`✓ Spam detection complete`);

    return {
      success: true,
      emails: emailsWithSpamScores,
      nextPageToken: fetchResult.nextPageToken,
      stats: {
        total: emailsWithSpamScores.length,
        spam: emailsWithSpamScores.filter(e => e.spam?.isSpam).length,
        categorized: emailsWithSpamScores.filter(e => e.categories.length > 0).length
      }
    };
  } catch (err) {
    console.error('Email processing pipeline error:', err.message);
    throw err;
  }
}

module.exports = {
  processEmails
};
