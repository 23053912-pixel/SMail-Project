# Backend Restructuring - Usage Examples

## Quick Start Examples

### Example 1: Full Email Processing Pipeline

```javascript
// In your route handler
const emailProcessing = require('../services/emailProcessing');
const emailFetching = require('../services/emailFetching');

router.post('/api/emails/process', async (req, res) => {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    // Create Gmail client
    const gmail = emailFetching.createGmailClient(session.user.accessToken);
    
    // Process emails (fetches, categorizes, detects spam, saves to DB)
    const result = await emailProcessing.processEmails(
      gmail,
      'in:inbox -in:trash -in:spam',  // Gmail query
      50,                               // Max emails
      session.user.email,               // User email
      db                                // Database connection
    );

    // result contains:
    // - success: true/false
    // - emails: [{ id, from, subject, categories, spam: {...} }, ...]
    // - stats: { total, spam, categorized }
    // - nextPageToken: for pagination

    res.json(result);
  } catch (err) {
    console.error('Processing error:', err.message);
    res.status(500).json({ error: 'Failed to process emails' });
  }
});
```

---

### Example 2: Fetch Emails Only

```javascript
const emailFetching = require('../services/emailFetching');

// Create Gmail client with user's access token
const gmail = emailFetching.createGmailClient(accessToken);

// Fetch emails
const result = await emailFetching.fetchGmailMessageList(
  gmail,
  'in:inbox',      // Gmail query
  50,              // Max results
  'user@gmail.com', // User's email
  null             // Page token (null for first page)
);

console.log(result);
// {
//   messages: [
//     {
//       id: 'email-id-123',
//       from: 'sender@example.com',
//       to: 'user@gmail.com',
//       subject: 'Hello',
//       body: 'Email body text',
//       date: Date,
//       preview: 'Email body text...',
//       starred: false,
//       read: true,
//       labels: 'INBOX,IMPORTANT'
//     },
//     ...
//   ],
//   nextPageToken: 'NEXT_PAGE_TOKEN'
// }
```

---

### Example 3: Categorize Emails

```javascript
const emailCategorization = require('../services/emailCategorization');

const emails = [
  {
    id: '1',
    subject: '50% OFF SALE!',
    body: 'Limited time offer - click here now',
    from: 'sales@shop.com'
  },
  {
    id: '2',
    subject: 'LinkedIn profile update',
    body: 'Your profile was viewed by...',
    from: 'notifications@linkedin.com'
  }
];

// Categorize single email
const categories1 = emailCategorization.categorizeEmail(emails[0]);
console.log(categories1); // ['promotional', 'spam']

// Categorize batch
const categorized = emailCategorization.categorizeBatch(emails);
console.log(categorized);
// [
//   { id: '1', categories: ['promotional', 'spam'] },
//   { id: '2', categories: ['social'] }
// ]

// Filter by category
const promoEmails = emailCategorization.filterByCategory(emails, 'promotional');
console.log(promoEmails); // [email with 'promotional' category]

// Get display name
const name = emailCategorization.getCategoryDisplayName('promotional');
console.log(name); // '🛍️ Promotions'
```

---

### Example 4: Spam Detection with ML Model

```javascript
const spamDetection = require('../services/spamDetection');

// Single email spam prediction
const prediction = await spamDetection.predictSpam(
  'Subject: Viagra for sale! Body: Click here now!!!'
);

console.log(prediction);
// {
//   isSpam: true,
//   probability: 0.95,
//   rawPrediction: { prediction: 1, confidence: 0.95 }
// }

// Batch spam predictions
const emails = [
  { id: '1', subject: 'Meeting tomorrow?', body: 'Can we meet at 2pm?' },
  { id: '2', subject: 'You won the lottery!', body: 'Claim your prize now' }
];

const predictions = await spamDetection.predictSpamBatch(emails);
console.log(predictions);
// [
//   { 
//     emailId: '1', 
//     isSpam: false, 
//     probability: 0.05,
//     processedAt: '2026-03-26T10:00:00.000Z'
//   },
//   { 
//     emailId: '2', 
//     isSpam: true, 
//     probability: 0.98,
//     processedAt: '2026-03-26T10:00:00.000Z'
//   }
// ]

// Warm up ML model
await spamDetection.warmupMLModel();
// Logs: "✓ ML model pre-warmed (first prediction cached)"
```

---

### Example 5: Custom Processing with Individual Services

```javascript
const emailFetching = require('../services/emailFetching');
const emailCategorization = require('../services/emailCategorization');
const spamDetection = require('../services/spamDetection');

async function customEmailProcessing(gmail) {
  // Step 1: Fetch
  console.log('📬 Fetching emails...');
  const { messages: emails } = await emailFetching.fetchGmailMessageList(
    gmail,
    'in:inbox',
    20,
    'user@gmail.com'
  );

  // Step 2: Categorize
  console.log('📂 Categorizing...');
  const emailsWithCats = emails.map(email => ({
    ...email,
    categories: emailCategorization.categorizeEmail(email)
  }));

  // Step 3: Spam detect only promotional emails
  console.log('🤖 Detecting spam...');
  const promoEmails = emailsWithCats.filter(e => 
    e.categories.includes('promotional')
  );
  
  if (promoEmails.length > 0) {
    const spamPreds = await spamDetection.predictSpamBatch(promoEmails);
    // ... update emails with spam predictions
  }

  // Step 4: Sort by spam score
  emailsWithCats.sort((a, b) => 
    (b.spamScore || 0) - (a.spamScore || 0)
  );

  return emailsWithCats;
}

const result = await customEmailProcessing(gmail);
```

---

### Example 6: From Frontend - Call the New API

```javascript
// Frontend JavaScript
async function processInboxEmails() {
  try {
    const response = await fetch('/api/emails/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: 'inbox',
        maxResults: 50
      })
    });

    const result = await response.json();

    console.log(`Processed ${result.stats.total} emails`);
    console.log(`Found ${result.stats.spam} spam emails`);
    console.log(`Categorized ${result.stats.categorized} emails`);

    // Display emails
    result.emails.forEach(email => {
      console.log(`
        From: ${email.from}
        Subject: ${email.subject}
        Categories: ${email.categories.join(', ')}
        Spam Score: ${email.spam.probability}
      `);
    });

  } catch (error) {
    console.error('Failed to process emails:', error);
  }
}
```

---

### Example 7: Pagination

```javascript
const emailFetching = require('../services/emailFetching');

// First batch
let result = await emailFetching.fetchGmailMessageList(
  gmail,
  'in:inbox',
  50,
  'user@gmail.com',
  null  // No page token = first page
);

console.log(`Fetched ${result.messages.length} emails`);
console.log(`Has more: ${!!result.nextPageToken}`);

// Load next batch
if (result.nextPageToken) {
  const nextBatch = await emailFetching.fetchGmailMessageList(
    gmail,
    'in:inbox',
    50,
    'user@gmail.com',
    result.nextPageToken  // Use page token from previous result
  );

  console.log(`Fetched ${nextBatch.messages.length} more emails`);
}
```

---

### Example 8: Error Handling

```javascript
const emailFetching = require('../services/emailFetching');
const spamDetection = require('../services/spamDetection');

try {
  // Fetch with error handling
  const gmail = emailFetching.createGmailClient(accessToken);
  const result = await emailFetching.fetchGmailMessageList(
    gmail,
    'in:inbox',
    50,
    'user@gmail.com'
  );
} catch (err) {
  if (err.message.includes('timeout')) {
    console.error('Gmail API is slow or offline');
  } else if (err.message.includes('rate limit')) {
    console.error('Rate limited - wait and retry');
  } else {
    console.error('Unknown error:', err.message);
  }
}

try {
  // Spam detection with graceful degradation
  const predictions = await spamDetection.predictSpamBatch(emails);
  
  predictions.forEach(pred => {
    if (pred.error) {
      console.warn(`Failed to detect spam for ${pred.emailId}: ${pred.error}`);
      // Email treated as not-spam
    } else {
      console.log(`${pred.emailId}: ${pred.isSpam ? 'SPAM' : 'HAM'}`);
    }
  });
} catch (err) {
  console.error('ML API error:', err.message);
  // Fallback to rule-based detection
}
```

---

## Service Testing Examples

```javascript
// test/emailCategorization.test.js
const emailCategorization = require('../services/emailCategorization');

describe('Email Categorization', () => {
  it('should detect promotional emails', () => {
    const email = {
      subject: '50% OFF TODAY ONLY!',
      body: 'Limited time offer',
      from: 'sales@shop.com'
    };
    const cats = emailCategorization.categorizeEmail(email);
    expect(cats).toContain('promotional');
  });

  it('should detect social media emails', () => {
    const email = {
      subject: 'Someone viewed your profile',
      body: '...',
      from: 'notifications@linkedin.com'
    };
    const cats = emailCategorization.categorizeEmail(email);
    expect(cats).toContain('social');
  });

  it('should batch categorize', () => {
    const emails = [...];
    const result = emailCategorization.categorizeBatch(emails);
    expect(result).toHaveLength(emails.length);
    expect(result[0]).toHaveProperty('categories');
  });
});
```

---

## Summary

The restructured backend provides:
- ✅ **Modular services** - Each handles one responsibility
- ✅ **Easy integration** - Mix and match services as needed
- ✅ **Clear error handling** - Service-level error management
- ✅ **Scalable design** - Easy to add new services
- ✅ **Testable code** - Each service can be tested independently
- ✅ **Well-documented** - Self-explanatory code structure
