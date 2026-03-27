# Quick Reference - Backend Services

## 📁 New Files Created

| File | Purpose |
|------|---------|
| `backend/services/emailFetching.js` | Gmail API integration & email fetching |
| `backend/services/emailCategorization.js` | Rule-based email categorization |
| `backend/services/spamDetection.js` | ML model integration for spam detection |
| `backend/services/emailProcessing.js` | Orchestrates full processing pipeline |
| `backend/routes/emailsRestructured.js` | Updated API routes using new services |
| `docs/ARCHITECTURE_RESTRUCTURED.md` | Full architecture documentation |
| `docs/RESTRUCTURING_GUIDE.md` | Detailed restructuring guide |
| `docs/USAGE_EXAMPLES.md` | Practical usage examples |

---

## 🔧 Core Services

### emailFetching.js
```javascript
const emailFetching = require('./services/emailFetching');

// Create Gmail client
const gmail = emailFetching.createGmailClient(accessToken);

// Fetch emails
const result = await emailFetching.fetchGmailMessageList(
  gmail, query, maxResults, userEmail, pageToken
);

// Fetch drafts
const drafts = await emailFetching.fetchDraftEmails(gmail, userEmail);
```

### emailCategorization.js
```javascript
const cat = require('./services/emailCategorization');

// Single email
const categories = cat.categorizeEmail(email);

// Batch
const batch = cat.categorizeBatch(emails);

// Filter
const filtered = cat.filterByCategory(emails, 'promotional');

// Categories: spam, promotional, social, updates
```

### spamDetection.js
```javascript
const spam = require('./services/spamDetection');

// Single prediction
const pred = await spam.predictSpam(emailText);

// Batch predictions
const preds = await spam.predictSpamBatch(emails);

// Warm up model
await spam.warmupMLModel();
```

### emailProcessing.js
```javascript
const proc = require('./services/emailProcessing');

// Full pipeline
const result = await proc.processEmails(
  gmail, query, maxResults, userEmail, db
);
// Returns: { success, emails[], nextPageToken, stats }
```

---

## 🌐 API Endpoints

### Processing
- **POST** `/api/emails/process` - Full pipeline

### Fetching
- **POST** `/api/emails/refresh` - Refresh inbox
- **GET** `/api/emails/:folder` - Get folder emails
- **GET** `/api/emails/:folder/more` - Load next page

### Services
- **POST** `/api/emails/categorize` - Categorize batch
- **POST** `/api/emails/spam-detect` - Detect spam batch

---

## 📊 Data Structures

### Email Object
```javascript
{
  id: 'email-id',
  from: 'sender@example.com',
  to: 'user@gmail.com',
  subject: 'Email Subject',
  body: 'Email body text',
  bodyHtml: '<html>...</html>',
  preview: 'Email preview...',
  date: Date,
  read: boolean,
  starred: boolean,
  labels: 'INBOX,UNREAD',
  categories: ['promotional', 'spam'],
  spam: {
    isSpam: boolean,
    probability: 0-1,
    rawPrediction: {...}
  }
}
```

### Processing Result
```javascript
{
  success: true,
  emails: [...],
  nextPageToken: 'token',
  stats: {
    total: 50,
    spam: 5,
    categorized: 40
  }
}
```

---

## 🎯 Common Tasks

### Process All Inbox Emails
```javascript
const result = await emailProcessing.processEmails(
  gmail, 'in:inbox', 50, 'user@gmail.com', db
);
```

### Get Only Spam Emails
```javascript
const result = await emailFetching.fetchGmailMessageList(
  gmail, 'in:spam', 50, 'user@gmail.com'
);
```

### Categorize Promotional Emails
```javascript
const email = { subject: '50% OFF', body: '...', from: '...' };
const cats = emailCategorization.categorizeEmail(email);
// ['promotional']
```

### Check If Email Is Spam
```javascript
const pred = await spamDetection.predictSpam('Subject and body text');
if (pred.isSpam) console.log('Spam detected!');
```

---

## ⚙️ Configuration

Environment variables:
```bash
ML_API_HOST=localhost      # ML API hostname
ML_API_PORT=5001           # ML API port
JWT_SECRET=your_secret     # JWT signing key
GMAIL_CLIENT_ID=...        # Gmail OAuth client ID
GMAIL_CLIENT_SECRET=...    # Gmail OAuth client secret
```

---

## 🚀 Performance

| Operation | Time |
|-----------|------|
| Fetch 50 emails | 5-8s |
| Categorize 50 emails | 100ms |
| Spam detect 50 emails | 8-12s |
| Full pipeline | 15-25s |
| Database save | 200-500ms |

---

## 📚 Documentation Files

| File | Content |
|------|---------|
| `ARCHITECTURE_RESTRUCTURED.md` | Complete architecture details |
| `RESTRUCTURING_GUIDE.md` | Migration guide & benefits |
| `USAGE_EXAMPLES.md` | 8+ practical code examples |
| `QUICK_PERF_GUIDE.md` | Performance tips |

---

## ✅ Benefits

✓ **Separation of Concerns** - Each service has single responsibility  
✓ **Testability** - Services can be tested independently  
✓ **Reusability** - Use services in different contexts  
✓ **Maintainability** - Clear, organized code  
✓ **Scalability** - Easy to add new services  
✓ **Error Handling** - Service-level error management  
✓ **Logging** - Better debugging capabilities  

---

## 🔍 File Locations

```
backend/
├── services/
│   ├── emailFetching.js           ← Gmail fetching
│   ├── emailCategorization.js     ← Categorization rules
│   ├── spamDetection.js           ← ML integration
│   ├── emailProcessing.js         ← Pipeline orchestration
│   └── gmail.js                   (legacy)
├── routes/
│   ├── emailsRestructured.js      ← NEW routes
│   ├── emails.js                  (legacy)
│   └── auth.js
├── server.js
└── config.js

docs/
├── ARCHITECTURE_RESTRUCTURED.md   ← Architecture details
├── RESTRUCTURING_GUIDE.md         ← Migration guide
├── USAGE_EXAMPLES.md              ← Code examples
└── QUICK_REFERENCE.md             ← This file
```

---

## 🔄 Next Steps

1. Test new services with your frontend
2. Update frontend API calls to new endpoints
3. Monitor ML API performance
4. Add unit tests for services
5. Deprecate legacy routes
6. Add logging/monitoring

---

## 💡 Tips

- **Use full pipeline** for complete processing
- **Use individual services** for custom workflows
- **Error handling** at service level (graceful degradation)
- **Batch operations** for performance
- **Cache results** if possible
- **Monitor ML API** for latency issues

---

Generated: March 26, 2026
