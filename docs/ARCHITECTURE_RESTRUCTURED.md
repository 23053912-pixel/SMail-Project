# Restructured Backend Architecture

## Overview

The backend has been restructured to match the system architecture diagram with clear separation of concerns:

```
Email Categorization & Spam Detection System
    ↓
Node.js Server (API)
    ├── Email Fetching Logic (emailFetching.js)
    ├── Email Categorization Logic (emailCategorization.js)
    ├── Spam Detection Model (spamDetection.js)
    └── Email Processing Orchestrator (emailProcessing.js)
```

## Service Architecture

### 1. **Email Fetching Service** (`services/emailFetching.js`)
Handles all Gmail API integration and email retrieval.

**Key Functions:**
- `createGmailClient(accessToken)` - Creates authenticated Gmail client
- `fetchGmailMessageList(gmail, query, maxResults, userEmail, pageToken)` - Fetches and parses emails
- `fetchDraftEmails(gmail, userEmail)` - Fetches draft emails
- `extractBody(payload)` - Extracts text/HTML from email
- `stripHtml(html)` - Converts HTML to plain text
- `withRetry(fn, maxAttempts)` - Implements exponential backoff for rate limiting

**Responsibilities:**
✓ Gmail API communication
✓ Message parsing and formatting
✓ Email body extraction
✓ Rate limit handling
✓ Timeout management

---

### 2. **Email Categorization Service** (`services/emailCategorization.js`)
Handles categorization of emails into logical groups.

**Key Functions:**
- `categorizeEmail(email)` - Categorize a single email
- `categorizeBatch(emails)` - Categorize multiple emails
- `filterByCategory(emails, category)` - Filter by category
- `getCategoryDisplayName(category)` - Get user-friendly names

**Built-in Categories:**
- `spam` - Detected spam content
- `promotional` - Sales/discount emails
- `social` - Social network notifications
- `updates` - System notifications/alerts

**Responsibilities:**
✓ Content-based categorization
✓ Rule-based classification
✓ Batch processing
✓ Category filtering

---

### 3. **Spam Detection Service** (`services/spamDetection.js`)
Integrates with ML model for spam detection predictions.

**Key Functions:**
- `predictSpam(emailText)` - Predict if email is spam using ML
- `predictSpamBatch(emails)` - Batch predict spam
- `warmupMLModel()` - Pre-warm model for faster first prediction
- `calculateSpamScore(email, mlPrediction)` - Calculate composite spam score

**ML Integration:**
- Connects to Python ML API on port 5001
- Sends text to `/predict` endpoint
- Receives probability scores
- Handles API timeouts and errors gracefully

**Responsibilities:**
✓ ML model communication
✓ Spam probability prediction
✓ Batch processing
✓ Timeout handling
✓ Error recovery

---

### 4. **Email Processing Orchestrator** (`services/emailProcessing.js`)
Coordinates the full email processing pipeline.

**Key Functions:**
- `processEmails(gmail, query, maxResults, userEmail, db)` - Full pipeline
- `saveProcessedEmailsToDB(db, emails)` - Persist to database

**Processing Pipeline:**
1. Fetch emails from Gmail
2. Categorize emails
3. Detect spam using ML model
4. Save results to database

**Responsibilities:**
✓ Pipeline orchestration
✓ Service coordination
✓ Data persistence
✓ Progress logging

---

## API Endpoints

### Email Processing

**POST /api/emails/process**
Full email processing pipeline (fetch + categorize + spam detect)
```json
{
  "folder": "inbox",
  "maxResults": 50
}
```

Response:
```json
{
  "success": true,
  "emails": [...],
  "nextPageToken": "...",
  "stats": {
    "total": 50,
    "spam": 5,
    "categorized": 40
  }
}
```

### Email Fetching

**POST /api/emails/refresh**
Refresh emails from Gmail

**GET /api/emails/:folder**
Get emails from specific folder (inbox, sent, drafts, spam, etc.)

**GET /api/emails/:folder/more**
Load next page of emails

### Categorization

**POST /api/emails/categorize**
Categorize emails using rule-based logic
```json
{
  "emails": [
    { "id": "1", "subject": "Sale!", "body": "50% off", "from": "..." }
  ]
}
```

### Spam Detection

**POST /api/emails/spam-detect**
Detect spam using ML model
```json
{
  "emails": [
    { "id": "1", "subject": "...", "body": "..." }
  ]
}
```

---

## File Structure

```
backend/
├── services/
│   ├── emailFetching.js       (Gmail API integration)
│   ├── emailCategorization.js (Rule-based categorization)
│   ├── spamDetection.js       (ML model integration)
│   ├── emailProcessing.js     (Pipeline orchestrator)
│   └── gmail.js               (Legacy - can be deprecated)
├── routes/
│   ├── emailsRestructured.js  (New modular routes)
│   ├── emails.js              (Legacy routes)
│   └── auth.js
├── middleware/
│   └── auth.js
├── utils/
│   └── session.js
├── server.js
└── config.js
```

---

## Migration Guide

### Before (Legacy Structure)
```javascript
// Old: Mixed concerns
const gmail = require('../services/gmail');
const emails = await gmail.fetchGmailEmails(session, token);
```

### After (New Modular Structure)
```javascript
// New: Separated concerns
const emailFetching = require('../services/emailFetching');
const emailCategorization = require('../services/emailCategorization');
const spamDetection = require('../services/spamDetection');
const emailProcessing = require('../services/emailProcessing');

// Option 1: Use full pipeline
const result = await emailProcessing.processEmails(gmail, query, maxResults, userEmail, db);

// Option 2: Use individual services
const emails = await emailFetching.fetchGmailMessageList(...);
const categories = emailCategorization.categorizeBatch(emails);
const spam = await spamDetection.predictSpamBatch(emails);
```

---

## Environment Variables

```bash
# ML Model API
ML_API_HOST=localhost
ML_API_PORT=5001

# Gmail API (existing)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...

# JWT
JWT_SECRET=...
```

---

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Fetch 50 emails | ~5-8s | Depends on Gmail API |
| Categorize 50 emails | ~100ms | Rule-based, no I/O |
| Spam detect 50 emails | ~8-12s | ML model inference |
| Full pipeline | ~15-25s | Fetch + Categorize + Spam detect |
| Database save | ~200-500ms | Batch insert |

---

## Benefits of New Structure

✅ **Separation of Concerns** - Each service has single responsibility
✅ **Testability** - Services can be tested independently
✅ **Reusability** - Services can be used in different contexts
✅ **Maintainability** - Clear code organization
✅ **Scalability** - Easy to add new services (summarization, reply suggestions, etc.)
✅ **Error Handling** - Service-level error handling
✅ **Logging** - Better debugging and monitoring
✅ **Documentation** - Self-documenting code structure

---

## Next Steps

1. **Update Frontend** to use new `/api/emails/process` endpoint
2. **Add Unit Tests** for each service
3. **Implement Caching** for categorization rules
4. **Monitor ML API** performance
5. **Add Logging** using Winston or similar
6. **Deprecate Legacy Routes** once new routes are stable
