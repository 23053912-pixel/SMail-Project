#!/usr/bin/env python3
"""
Enhanced Spam Prediction API
============================
Improvements:
1. Email-specific feature extraction (URLs, urgency, special chars)
2. Domain reputation checking (known phishing/spam domains)
3. Prediction logging for monitoring
4. Multi-tier detection (ML + rules + domain reputation)
"""

import os
import sys
import string
import pickle
import logging
import re
import json
from datetime import datetime
from typing import Dict, List, Any, Optional
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='%(levelname)s  %(message)s')
log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.abspath(__file__))
PIPELINE_PATH = os.path.join(ROOT, 'model', 'artifacts', 'spam_pipeline.pkl')
METADATA_PATH = os.path.join(ROOT, 'model', 'artifacts', 'model_metadata.pkl')
TRAINER_PATH = os.path.join(ROOT, 'model', 'train_spam_detector.py')
LOG_DIR = os.path.join(ROOT, 'logs', 'predictions')
ML_PORT = int(os.environ.get('ML_PORT', 5001))
ML_INTERNAL_TOKEN = os.environ.get('ML_INTERNAL_TOKEN', '')

# ── Global state ──────────────────────────────────────────────────────────────
pipeline = None
model_metadata = None
prediction_log = []
_log_buffer = []
LOG_BUFFER_SIZE = 100

# ── Known spam/phishing domains (expandable) ─────────────────────────────────
KNOWN_SPAM_DOMAINS = {
    'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd',
    't.co', 'buff.ly', 'adf.ly', 'bc.vc',
    # Phishing domains
    'secure-bankofamerica.com', 'paypal-verify.com', 'apple-id.com',
    'microsoft-support.com', 'amazon-security.com', 'netflix-billing.com',
    'google-security.com', 'facebook-security.com', 'instagram-verify.com',
    # Known spam senders
    'spam.com', 'spammy.com', 'junk.com', 'bulk.com',
}

# ── Suspicious TLDs ──────────────────────────────────────────────────────────
SUSPICIOUS_TLDS = {'.xyz', '.top', '.work', '.click', '.link', '.info', '.buzz', '.loan'}

# ── NLTK cache ────────────────────────────────────────────────────────────────
_nltk_lemmatizer = None
_nltk_stopwords = None


def _sigmoid(x: float) -> float:
    import math
    return 1.0 / (1.0 + math.exp(-x))


# ── Feature Extraction ────────────────────────────────────────────────────────

def extract_email_features(text: str) -> Dict[str, float]:
    """Extract email-specific numerical features."""
    text_str = str(text) if not isinstance(text, str) else text
    text_lower = text_str.lower()
    
    features = {}
    
    # URL features
    urls = re.findall(r'https?://\S+|www\.\S+', text_str)
    features['url_count'] = len(urls)
    features['has_ip_url'] = 1.0 if re.search(r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', text_str) else 0.0
    features['has_shortened_url'] = 1.0 if any(s in text_lower for s in KNOWN_SPAM_DOMAINS) else 0.0
    
    # Special character patterns
    features['exclamation_count'] = text_str.count('!')
    features['question_count'] = text_str.count('?')
    features['dollar_count'] = text_str.count('$')
    features['uppercase_ratio'] = sum(1 for c in text_str if c.isupper()) / max(len(text_str), 1)
    features['special_char_ratio'] = sum(1 for c in text_str if not c.isalnum() and not c.isspace()) / max(len(text_str), 1)
    
    # Urgency indicators
    urgency_words = ['urgent', 'immediate', 'act now', 'limited time', 'expires', 'deadline', 'hurry', 'warning', 'alert']
    features['urgency_score'] = sum(1 for w in urgency_words if w in text_lower)
    
    # Financial indicators
    financial_words = ['free', 'winner', 'congratulations', 'prize', 'reward', 'cash', 'bonus', 'offer', 'guarantee', 'no risk']
    features['financial_score'] = sum(1 for w in financial_words if w in text_lower)
    
    # Text statistics
    features['text_length'] = len(text_str)
    features['word_count'] = len(text_str.split())
    features['avg_word_length'] = sum(len(w) for w in text_str.split()) / max(len(text_str.split()), 1)
    
    # HTML indicators
    features['has_html'] = 1.0 if '<html' in text_lower or '<body' in text_lower else 0.0
    features['html_tag_count'] = len(re.findall(r'<[^>]+>', text_str))
    
    return features


def check_domain_reputation(sender_email: str) -> Dict[str, Any]:
    """Check sender domain against known reputation databases."""
    if not sender_email:
        return {'is_suspicious': False, 'reasons': []}
    
    # Extract domain from email
    domain_match = re.search(r'@([\w.-]+)', sender_email)
    if not domain_match:
        return {'is_suspicious': True, 'reasons': ['invalid_email_format']}
    
    domain = domain_match.group(1).lower()
    reasons = []
    
    # Check against known spam domains
    if domain in KNOWN_SPAM_DOMAINS:
        reasons.append('known_spam_domain')
    
    # Check for suspicious TLDs
    for tld in SUSPICIOUS_TLDS:
        if domain.endswith(tld):
            reasons.append(f'suspicious_tld:{tld}')
            break
    
    # Check for typosquatting (e.g., gmai1.com vs gmail.com)
    typosquat_patterns = [
        ('gmail', ['gmai1', 'gmial', 'gmal', 'gmaill', 'gmil']),
        ('yahoo', ['yaho0', 'yahho', 'yhaoo']),
        ('outlook', ['outlok', 'outloo', 'outlooook']),
        ('hotmail', ['hotmal', 'hotmai1', 'hotmial']),
    ]
    for legit, fakes in typosquat_patterns:
        if any(fake in domain for fake in fakes):
            reasons.append(f'typosquatting:{legit}')
    
    # Check for numeric-only domains (often throwaway)
    if re.match(r'^[\d.]+$', domain):
        reasons.append('numeric_only_domain')
    
    return {
        'is_suspicious': len(reasons) > 0,
        'reasons': reasons,
        'domain': domain
    }


def classify_with_rules(text: str, sender_email: str = None) -> Dict[str, Any]:
    """Rule-based classification for known patterns."""
    text_lower = text.lower()
    score = 0
    reasons = []
    
    # Urgency patterns
    if re.search(r'urgent.*action.*required|act.*now|limited.*time', text_lower):
        score += 30
        reasons.append('urgency_language')
    
    # Financial scam patterns
    if re.search(r'you.*won|congratulations|claim.*prize|free.*gift', text_lower):
        score += 40
        reasons.append('prize_scam')
    
    # Phishing patterns
    if re.search(r'verify.*account|confirm.*identity|update.*payment|account.*suspended', text_lower):
        score += 35
        reasons.append('phishing_language')
    
    # Crypto/investment scam
    if re.search(r'bitcoin|crypto|investment.*guaranteed|double.*money|500.*return', text_lower):
        score += 45
        reasons.append('crypto_scam')
    
    # Pharmacy spam
    if re.search(r'pharmacy|viagra|cialis|prescription.*free|buy.*drugs', text_lower):
        score += 50
        reasons.append('pharmacy_spam')
    
    # Check sender reputation
    if sender_email:
        domain_result = check_domain_reputation(sender_email)
        if domain_result['is_suspicious']:
            score += 25
            reasons.extend(domain_result['reasons'])
    
    # Normalize score to 0-1
    normalized_score = min(score / 100.0, 1.0)
    
    return {
        'is_spam': score >= 50,
        'spam_score': normalized_score,
        'reasons': reasons,
        'method': 'rules'
    }


# ── Text Preprocessing ────────────────────────────────────────────────────────

def _ensure_nltk():
    global _nltk_lemmatizer, _nltk_stopwords
    import nltk
    resources = {
        'punkt': 'tokenizers/punkt',
        'punkt_tab': 'tokenizers/punkt_tab',
        'stopwords': 'corpora/stopwords',
        'wordnet': 'corpora/wordnet',
        'omw-1.4': 'corpora/omw-1.4',
    }
    for pack, path in resources.items():
        try:
            nltk.data.find(path)
        except LookupError:
            log.info(f'Downloading NLTK resource: {pack}')
            nltk.download(pack, quiet=True)

    from nltk.corpus import stopwords
    from nltk.stem import WordNetLemmatizer
    _nltk_lemmatizer = WordNetLemmatizer()
    _nltk_stopwords = set(stopwords.words('english'))


def transform_text(text):
    """Enhanced preprocessing with email-aware tokenization."""
    global _nltk_lemmatizer, _nltk_stopwords
    try:
        import nltk
        
        lemmatizer = _nltk_lemmatizer
        stop_words = _nltk_stopwords
        
        text = str(text).lower()
        
        # Extract and preserve URL domains as features
        text = re.sub(r'https?://([^/\s]+)', r' URLDOMAIN \1 ', text)
        text = re.sub(r'https?://\S+', ' URLTOKEN ', text)
        
        # Preserve email domains
        text = re.sub(r'\S+@(\S+)', r' EMAILDOMAIN \1 ', text)
        
        # Normalize repeated characters
        text = re.sub(r'(.)\1{2,}', r'\1\1', text)
        
        # Tokenize
        tokens = nltk.word_tokenize(text)
        tokens = [t for t in tokens if t.isalnum()]
        tokens = [t for t in tokens if t not in stop_words and t not in string.punctuation]
        tokens = [lemmatizer.lemmatize(t) for t in tokens]
        
        return ' '.join(tokens)
    except Exception:
        return ' '.join(str(text).lower().split())


# ── Model Loading ─────────────────────────────────────────────────────────────

def load_models() -> bool:
    """Load the trained pipeline."""
    global pipeline, model_metadata
    
    if os.path.exists(PIPELINE_PATH):
        try:
            with open(PIPELINE_PATH, 'rb') as f:
                pipeline = pickle.load(f)
            classifier = pipeline.named_steps.get('model')
            log.info(f'Loaded pipeline: {type(classifier).__name__}')
            
            # Load metadata if available
            if os.path.exists(METADATA_PATH):
                with open(METADATA_PATH, 'rb') as f:
                    model_metadata = pickle.load(f)
            
            return True
        except Exception as exc:
            log.warning(f'Failed to load pipeline: {exc}')
            pipeline = None
    
    return False


# ── Prediction Logging ────────────────────────────────────────────────────────

def log_prediction(text: str, prediction: str, confidence: float, 
                   spam_prob: float, sender_email: str = None,
                   rule_score: float = None, domain_flags: List[str] = None):
    """Log prediction for monitoring and analysis."""
    global _log_buffer
    
    entry = {
        'timestamp': datetime.utcnow().isoformat(),
        'text_preview': text[:100] if text else '',
        'prediction': prediction,
        'confidence': confidence,
        'spam_probability': spam_prob,
        'sender_email': sender_email,
        'rule_score': rule_score,
        'domain_flags': domain_flags or [],
        'text_length': len(text) if text else 0
    }
    
    _log_buffer.append(entry)
    
    # Flush to disk periodically
    if len(_log_buffer) >= LOG_BUFFER_SIZE:
        flush_logs()


def flush_logs():
    """Flush prediction log buffer to disk."""
    global _log_buffer
    
    if not _log_buffer:
        return
    
    os.makedirs(LOG_DIR, exist_ok=True)
    log_file = os.path.join(LOG_DIR, f'predictions_{datetime.utcnow().strftime("%Y%m%d")}.jsonl')
    
    try:
        with open(log_file, 'a') as f:
            for entry in _log_buffer:
                f.write(json.dumps(entry) + '\n')
        _log_buffer.clear()
    except Exception as e:
        log.error(f'Failed to flush logs: {e}')


# ── Ensemble Prediction ───────────────────────────────────────────────────────

def ensemble_predict(text: str, sender_email: str = None) -> Dict[str, Any]:
    """Combine ML, rules, and domain reputation for final prediction."""
    results = {
        'ml_prediction': None,
        'rule_prediction': None,
        'domain_reputation': None,
        'final_prediction': None,
        'confidence': 0.0
    }
    
    # 1. ML Prediction (if model available)
    if pipeline is not None:
        transformed = transform_text(text[:600])
        pred_raw = pipeline.predict([transformed])[0]
        classifier = pipeline.named_steps.get('model')
        
        if hasattr(classifier, 'predict_proba'):
            proba = pipeline.predict_proba([transformed])[0]
            ml_spam_prob = float(proba[1])
        elif hasattr(classifier, 'decision_function'):
            vec_step = pipeline.named_steps.get('tfidf')
            X_vec = vec_step.transform([transformed])
            score = float(classifier.decision_function(X_vec)[0])
            ml_spam_prob = _sigmoid(score)
        else:
            ml_spam_prob = 1.0 if pred_raw == 1 else 0.0
        
        results['ml_prediction'] = {
            'is_spam': int(pred_raw) == 1,
            'spam_probability': ml_spam_prob,
            'confidence': max(ml_spam_prob, 1.0 - ml_spam_prob)
        }
    
    # 2. Rule-based Prediction
    rule_result = classify_with_rules(text, sender_email)
    results['rule_prediction'] = rule_result
    
    # 3. Domain Reputation
    if sender_email:
        domain_result = check_domain_reputation(sender_email)
        results['domain_reputation'] = domain_result
    
    # 4. Ensemble Decision
    ml_weight = 0.6 if pipeline else 0.0
    rule_weight = 0.3
    domain_weight = 0.1
    
    ml_score = results['ml_prediction']['spam_probability'] if results['ml_prediction'] else 0.5
    rule_score = rule_result['spam_score']
    domain_score = 1.0 if results['domain_reputation'] and results['domain_reputation']['is_suspicious'] else 0.0
    
    # Weighted average
    final_score = (ml_weight * ml_score) + (rule_weight * rule_score) + (domain_weight * domain_score)
    
    # High-confidence overrides
    if rule_result['is_spam'] and rule_result['spam_score'] > 0.7:
        final_score = max(final_score, 0.9)  # Force high score
    
    if results['domain_reputation'] and results['domain_reputation']['is_suspicious']:
        if any('known_spam_domain' in r for r in results['domain_reputation']['reasons']):
            final_score = max(final_score, 0.85)
    
    results['final_prediction'] = {
        'is_spam': final_score >= 0.5,
        'spam_probability': round(final_score, 4),
        'ham_probability': round(1.0 - final_score, 4),
        'confidence': round(max(final_score, 1.0 - final_score), 4),
        'method': 'ensemble'
    }
    
    return results


# ── Flask App ─────────────────────────────────────────────────────────────────

try:
    from flask import Flask, request, jsonify
except ImportError:
    print('Flask not installed. Run: pip install flask')
    sys.exit(1)

app = Flask(__name__)


@app.route('/health', methods=['GET'])
def health():
    loaded = pipeline is not None
    mode = 'pipeline+rules+domain' if loaded else 'rules+domain'
    return jsonify({
        'status': 'ok',
        'models_loaded': loaded,
        'mode': mode,
        'known_spam_domains': len(KNOWN_SPAM_DOMAINS),
        'predictions_today': len(_log_buffer)
    })


@app.route('/predict', methods=['POST'])
def predict():
    if ML_INTERNAL_TOKEN:
        provided = request.headers.get('X-Internal-Token', '')
        if provided != ML_INTERNAL_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json(silent=True) or {}
    text = str(data.get('text', '')).strip()
    sender_email = data.get('sender_email', None)
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # Run ensemble prediction
    results = ensemble_predict(text, sender_email)
    
    # Log prediction
    log_prediction(
        text=text,
        prediction='spam' if results['final_prediction']['is_spam'] else 'ham',
        confidence=results['final_prediction']['confidence'],
        spam_prob=results['final_prediction']['spam_probability'],
        sender_email=sender_email,
        rule_score=results['rule_prediction']['spam_score'],
        domain_flags=results['domain_reputation']['reasons'] if results['domain_reputation'] else []
    )
    
    return jsonify({
        'prediction': 'spam' if results['final_prediction']['is_spam'] else 'ham',
        'spam_probability': results['final_prediction']['spam_probability'],
        'ham_probability': results['final_prediction']['ham_probability'],
        'confidence': results['final_prediction']['confidence'],
        'details': {
            'ml': results['ml_prediction'],
            'rules': {
                'is_spam': results['rule_prediction']['is_spam'],
                'score': results['rule_prediction']['spam_score'],
                'reasons': results['rule_prediction']['reasons']
            },
            'domain': results['domain_reputation']
        }
    })


@app.route('/predict_batch', methods=['POST'])
def predict_batch():
    MAX_BATCH_SIZE = 50

    if ML_INTERNAL_TOKEN:
        provided = request.headers.get('X-Internal-Token', '')
        if provided != ML_INTERNAL_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json(silent=True) or {}
    texts = data.get('texts', [])
    sender_emails = data.get('sender_emails', [])
    
    if not isinstance(texts, list) or len(texts) == 0:
        return jsonify({'error': 'No texts provided'}), 400
    if len(texts) > MAX_BATCH_SIZE:
        return jsonify({'error': f'Batch too large. Max {MAX_BATCH_SIZE}'}), 400

    results = []
    for i, text in enumerate(texts):
        sender = sender_emails[i] if i < len(sender_emails) else None
        result = ensemble_predict(text, sender)
        results.append({
            'index': i,
            'prediction': 'spam' if result['final_prediction']['is_spam'] else 'ham',
            'spam_probability': result['final_prediction']['spam_probability'],
            'confidence': result['final_prediction']['confidence'],
            'ml_used': result['ml_prediction'] is not None,
            'rule_flags': result['rule_prediction']['reasons']
        })

    return jsonify({'results': results})


@app.route('/train', methods=['POST'])
def retrain():
    if ML_INTERNAL_TOKEN:
        provided = request.headers.get('X-Internal-Token', '')
        if provided != ML_INTERNAL_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401

    import subprocess
    if os.path.exists(TRAINER_PATH):
        try:
            result = subprocess.run(
                [sys.executable, TRAINER_PATH],
                capture_output=True, text=True, timeout=300
            )
            if result.returncode != 0:
                log.error(f'Trainer stderr: {result.stderr}')
                return jsonify({'error': 'Training failed'}), 500
            load_models()
            return jsonify({'success': True, 'message': 'Models retrained'})
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Training timed out'}), 500

    return jsonify({'error': 'Trainer not found'}), 500


@app.route('/stats', methods=['GET'])
def stats():
    """Return prediction statistics."""
    flush_logs()  # Ensure logs are flushed
    
    today = datetime.utcnow().strftime('%Y%m%d')
    log_file = os.path.join(LOG_DIR, f'predictions_{today}.jsonl')
    
    stats = {
        'total_predictions': 0,
        'spam_count': 0,
        'ham_count': 0,
        'avg_confidence': 0.0,
        'low_confidence_count': 0  # confidence < 0.7
    }
    
    if os.path.exists(log_file):
        try:
            with open(log_file, 'r') as f:
                entries = [json.loads(line) for line in f]
                stats['total_predictions'] = len(entries)
                stats['spam_count'] = sum(1 for e in entries if e.get('prediction') == 'spam')
                stats['ham_count'] = sum(1 for e in entries if e.get('prediction') == 'ham')
                if entries:
                    stats['avg_confidence'] = sum(e.get('confidence', 0) for e in entries) / len(entries)
                    stats['low_confidence_count'] = sum(1 for e in entries if e.get('confidence', 1) < 0.7)
        except Exception as e:
            log.error(f'Failed to read log file: {e}')
    
    return jsonify(stats)


# ── Startup ───────────────────────────────────────────────────────────────────

@app.teardown_appcontext
def shutdown_logging(exception=None):
    """Flush logs on shutdown."""
    flush_logs()


if __name__ == '__main__':
    _ensure_nltk()
    if not load_models():
        log.info('No pipeline artifact found.')
        if os.path.exists(TRAINER_PATH):
            log.info('Auto-training...')
            import subprocess
            result = subprocess.run(
                [sys.executable, TRAINER_PATH],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                load_models()
            else:
                log.warning(f'Auto-training failed:\n{result.stderr}')

    log.info(f'Starting Enhanced Spam API on port {ML_PORT}')
    log.info(f'Mode: pipeline+rules+domain (ML loaded: {pipeline is not None})')
    app.run(host='0.0.0.0', port=ML_PORT, debug=False)
