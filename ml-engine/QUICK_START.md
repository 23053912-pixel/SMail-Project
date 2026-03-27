# 📊 ML-Engine Quick Reference

## What's Where?

| Component | Location | Type | Purpose |
|-----------|----------|------|---------|
| **Scam Detector** | `core/heuristic/scamDetector.js` | JavaScript | Fast pattern-based analysis (10-80ms) |
| **ML Predictor** | `core/predictive/predict_api.py` | Python/Flask | ML-based classification (100-200ms) |
| **ML Trainer** | `core/predictive/model/train_spam_detector.py` | Python | Model training script |
| **Data** | `data/spam.csv` | CSV | Training dataset |
| **Analysis** | `analysis/*.ipynb` | Jupyter | Notebooks & reports |
| **Config** | `config/index.md` | Markdown | Configuration guide |

## Quick Start Commands

### Run Heuristic Analysis
```javascript
const { analyzeEmail } = require('./core/heuristic/scamDetector.js');
analyzeEmail({ from, subject, body, bodyHtml });
```

### Start ML Server
```bash
python core/predictive/predict_api.py
```

### Test ML Server
```bash
curl -X POST http://localhost:5001/predict \
  -H "Content-Type: application/json" \
  -d '{"text":"Test message"}'
```

### Retrain Model
```bash
python core/predictive/model/train_spam_detector.py
```

## Performance Summary

| Method | Time | Accuracy | Use Case |
|--------|------|----------|----------|
| Heuristic | 10-80ms | 82% | Real-time filtering |
| ML Prediction | 100-200ms | 94% | Complex analysis |
| Combined | 120-280ms | 96% | Final verdict |
| Batch (50 emails) | 12-15s | 96% | Bulk scanning |

## Key Features

✅ **Dual-approach** analysis (heuristic + ML)  
✅ **5-10x faster** than naive implementations  
✅ **96% accuracy** on combined score  
✅ **Cached NLTK** reduces ML latency  
✅ **Batch processing** for bulk emails  
✅ **Early-exit optimization** for heuristic  
✅ **Result caching** (1-hour TTL)  
✅ **Timeout protection** (10-second max)  

## Detection Categories (10 total)

1. 🎯 Urgency Tactics
2. 💰 Financial Scams
3. 🎣 Phishing Attempts
4. ⚠️ Threats/Blackmail
5. 👤 Suspicious Senders
6. 🎭 Brand Impersonation
7. 🔗 Risky Links
8. 🔤 Formatting Issues
9. 📝 Language Patterns
10. ⚙️ Dangerous Attachments

## Score Interpretation

- **0-9**: Safe ✅
- **10-24**: Low risk ⚠️
- **25-44**: Medium risk ⚠️⚠️
- **45-69**: High risk 🔴
- **70-100**: Critical 🚫

---

**Last Updated**: March 23, 2026

For detailed info, see:
- 📖 [README.md](./README.md) - Full documentation
- ⚙️ [config/index.md](./config/index.md) - Configuration guide
