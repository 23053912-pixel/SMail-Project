# ML Engine Configuration Guide

## Directory Structure & Purpose

### `/core/heuristic/`
**Real-time pattern-based email analysis**
- **File**: `scamDetector.js`
- **Type**: Node.js module
- **Function**: `analyzeEmail(email) → result`
- **Performance**: 10-80ms per email
- **Accuracy**: ~82%
- **Best for**: Quick filtering, frontend display

**Detection Methods**:
- Phrase matching (10,000+ keywords across 9 categories)
- Regex pattern analysis (sender, URLs, formatting)
- Domain reputation checking
- Brand spoofing detection

### `/core/predictive/`
**Machine learning-based prediction API**
- **Main Server**: `predict_api.py` (Flask)
- **Port**: 5001 (default)
- **Endpoints**: `/predict`, `/predict_batch`, `/train`, `/health`
- **Performance**: 100-200ms per email
- **Accuracy**: ~94%
- **Best for**: Final verdict, complex emails, retraining

**Components**:
- `predict_api.py` - REST API server
- `model/train_spam_detector.py` - Training script
- `model/artifacts/spam_pipeline.pkl` - Trained model
- `requirements.txt` - Python dependencies

**Performance Optimizations**:
- NLTK resources cached globally at startup
- Batch prediction endpoint for bulk processing
- 1-hour prediction result caching
- Early timeout (10s) on slow predictions

### `/data/`
**Training and test datasets**
- `spam.csv` - Label email dataset
- Columns: text, label (spam/ham)
- Size: ~6000 samples

### `/analysis/`
**Data exploration and metrics**
- Jupyter notebooks for analysis
- Detection metrics and visualizations
- Performance reports

## Environment Setup

### Backend Configuration
```javascript
// backend/.env
ML_API_HOST=localhost
ML_API_PORT=5001
ML_INTERNAL_TOKEN=secure-token-here
JWT_SECRET=jwt-secret-here
```

### Python Requirements
```bash
cd core/predictive
pip install -r requirements.txt
```

### Running ML Server
```bash
python core/predictive/predict_api.py
# OR with custom port:
ML_PORT=5002 python core/predictive/predict_api.py
```

## Integration Points

### 1. Backend Usage (Node.js)
```javascript
const { analyzeEmail } = require('../ml-engine/core/heuristic/scamDetector.js');
const result = analyzeEmail(emailObject);
```

### 2. API Calls
```javascript
// In routes/emails.js
async function callMLPredict(text) {
  // Makes HTTP POST to http://localhost:5001/predict
  // With timeout and caching
}
```

### 3. Email Analysis Flow
1. Request received at `POST /email/:id/scan`
2. Heuristic analysis (~20ms)
3. If score is borderline, call ML API (~150ms)
4. Combine scores using weighted formula
5. Return combined result

## Performance Tuning

### Heuristic Engine
- Early exit after 3 phrase matches
- Skip checks for irrelevant content
- Limit body to 3000 characters
- Pre-compiled regex patterns
- ~3-5x faster than generating patterns on-fly

### ML Server
- Cached NLTK resources (stopwords, stemmer)
- Batch endpoint for 50+ emails
- 1-hour result caching (up to 1000 entries)
- 10-second timeout per prediction
- One-time model load at startup

### Database
- SQLite with sparse indexing
- Async query handling in email routes
- Connection pooling (Node.js)

## Monitoring & Debugging

### Health Check
```bash
curl http://localhost:5001/health
# { "status": "ok", "models_loaded": true, "mode": "pipeline" }
```

### Test Email
```bash
curl -X POST http://localhost:5001/predict \
  -H "Content-Type: application/json" \
  -d '{"text":"Click here to verify your account NOW"}'
```

### Heuristic Test
```javascript
node -e "
const {analyzeEmail} = require('./core/heuristic/scamDetector.js');
const test = {from:'spoof@fake.tk', subject:'YOU HAVE WON!!', body:'Act now!'};
console.log(JSON.stringify(analyzeEmail(test), null, 2));
"
```

## Common Issues & Solutions

### ML Server Not Responding
```bash
# Check if running
lsof -i :5001

# Restart
pkill -f "python predict_api.py"
python core/predictive/predict_api.py
```

### Models Not Loading
```bash
# Check artifact exists
ls -la core/predictive/model/artifacts/spam_pipeline.pkl

# Retrain if missing
python core/predictive/model/train_spam_detector.py
```

### Slow Predictions
**Solution**: Increase timeout and add batch endpoint
- Already implemented with 10s timeout
- Use `/predict_batch` for 50+ emails

### False Positives
**Solution**: Adjust scoring in heuristic or retrain ML model
- Heuristic: Modify phrase thresholds in `scamDetector.js`
- ML: Add more training data and run `train_spam_detector.py`

## API Reference

### Heuristic Endpoint (Node.js)
```javascript
analyzeEmail(email) → {
  score: 0-100,
  level: 'safe'|'low'|'medium'|'high'|'critical',
  summary: string,
  indicators: [{category, severity, icon, detail}],
  recommendations: [string],
  scannedAt: ISO8601
}
```

### ML Endpoints (Python/Flask)

**Single Prediction**
```
POST /predict
Body: { "text": "email text" }
Response: { "prediction": "spam"|"ham", "spam_probability": 0-1, ... }
```

**Batch Prediction**
```
POST /predict_batch
Body: { "texts": ["text1", "text2", ...] }
Response: { "results": [{ "index": 0, "prediction": "spam", ... }] }
```

**Health Check**
```
GET /health
Response: { "status": "ok", "models_loaded": true, "mode": "pipeline" }
```

**Retrain**
```
POST /train
Response: { "success": true, "message": "Models retrained..." }
```

## Maintenance Schedule

- **Weekly**: Monitor false positive rate
- **Monthly**: Review new scam patterns, update phrases
- **Quarterly**: Retrain ML model with new data
- **Annually**: Audit overall detection accuracy

---

**Last Updated**: March 23, 2026  
**Maintained by**: SMail Security Team
