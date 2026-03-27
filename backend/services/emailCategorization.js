'use strict';

/**
 * Email Categorization Logic Service
 * Handles categorization of emails into folders/labels
 * Separates categorization rules from fetching and spam detection
 */

const CATEGORIZATION_RULES = {
  spam: (email) => {
    // Pre-defined spam keywords
    const spamKeywords = ['viagra', 'casino', 'lottery', 'prize', 'click here', 'limited time'];
    const bodyLower = (email.body || '').toLowerCase();
    return spamKeywords.some(keyword => bodyLower.includes(keyword));
  },
  
  promotional: (email) => {
    const promoKeywords = ['sale', 'discount', 'offer', 'limited offer', 'special deals'];
    const subjectLower = (email.subject || '').toLowerCase();
    const bodyLower = (email.body || '').toLowerCase();
    return promoKeywords.some(keyword => subjectLower.includes(keyword) || bodyLower.includes(keyword));
  },
  
  social: (email) => {
    const socialDomains = ['facebook', 'twitter', 'linkedin', 'instagram', 'snapchat', 'github'];
    const fromLower = (email.from || '').toLowerCase();
    return socialDomains.some(domain => fromLower.includes(domain));
  },
  
  updates: (email) => {
    const updateKeywords = ['update', 'notification', 'alert', 'reminder', 'event'];
    const subjectLower = (email.subject || '').toLowerCase();
    return updateKeywords.some(keyword => subjectLower.includes(keyword));
  }
};

/**
 * Categorize an email based on content rules
 * @param {Object} email - Email object with subject, body, from
 * @returns {Array} Array of category strings
 */
function categorizeEmail(email) {
  const categories = [];
  
  for (const [category, rule] of Object.entries(CATEGORIZATION_RULES)) {
    try {
      if (rule(email)) {
        categories.push(category);
      }
    } catch (err) {
      console.error(`Error applying ${category} rule:`, err.message);
    }
  }
  
  return categories;
}

/**
 * Batch categorize multiple emails
 * @param {Array} emails - Array of email objects
 * @returns {Array} Array of objects with email id and categories
 */
function categorizeBatch(emails) {
  return emails.map(email => ({
    id: email.id,
    categories: categorizeEmail(email),
    originalLabels: email.labels || ''
  }));
}

/**
 * Get display name for a category
 * @param {string} category - Category key
 * @returns {string} Human-readable category name
 */
function getCategoryDisplayName(category) {
  const names = {
    spam: '🚨 Spam',
    promotional: '🛍️ Promotions',
    social: '👥 Social',
    updates: '🔔 Updates',
    important: '⭐ Important',
    work: '💼 Work'
  };
  return names[category] || category;
}

/**
 * Filter emails by category
 * @param {Array} emails - Array of emails
 * @param {string} category - Category to filter by
 * @returns {Array} Filtered emails
 */
function filterByCategory(emails, category) {
  return emails.filter(email => {
    const categories = categorizeEmail(email);
    return categories.includes(category);
  });
}

module.exports = {
  categorizeEmail,
  categorizeBatch,
  getCategoryDisplayName,
  filterByCategory,
  CATEGORIZATION_RULES
};
