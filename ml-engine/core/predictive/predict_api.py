#!/usr/bin/env python3
"""
SMail – Spam/Ham Prediction API
================================
Loads the trained pipeline artifact from train_spam_detector.py and serves predictions over HTTP.

Usage:
    python predict_api.py           # starts on port 5001 (default)
    ML_PORT=5002 python predict_api.py

Endpoints:
    GET  /health        → { status, models_loaded, mode }
    POST /predict       → { prediction, spam_probability, ham_probability, confidence }
                          body: { "text": "<subject + body>" }
    POST /train         → retrains via model/train_spam_detector.py and reloads pipeline

If spam_pipeline.pkl is missing, the server attempts auto-training via
model/train_spam_detector.py.
"""

import os
import sys
import string
import pickle
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s  %(message)s')
log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.abspath(__file__))
# Pipeline artifact produced by train_spam_detector.py
PIPELINE_PATH      = os.path.join(ROOT, 'model', 'artifacts', 'spam_pipeline.pkl')
TRAINER_PATH       = os.path.join(ROOT, 'model', 'train_spam_detector.py')
ML_PORT            = int(os.environ.get('ML_PORT', 5001))
ML_INTERNAL_TOKEN  = os.environ.get('ML_INTERNAL_TOKEN', '')  # shared secret with Node server

# ── Global model holders ──────────────────────────────────────────────────────
pipeline = None   # set when using the trainer pipeline (spam_pipeline.pkl)

# ── Cache NLTK resources globally (loaded once at startup, not per-prediction) ──
_nltk_porter_stemmer = None
_nltk_stopwords = None


def _sigmoid(x: float) -> float:
    """Map a raw decision-function score to a [0, 1] probability-like value."""
    import math
    return 1.0 / (1.0 + math.exp(-x))


# ── Text preprocessing (mirrors the notebook transform_text) ─────────────────
def _ensure_nltk():
    global _nltk_porter_stemmer, _nltk_stopwords
    import nltk
    # Map download name → resource path used by nltk.data.find()
    resources = {
        'punkt':     'tokenizers/punkt',
        'punkt_tab': 'tokenizers/punkt_tab',
        'stopwords': 'corpora/stopwords',
    }
    for pack, path in resources.items():
        try:
            nltk.data.find(path)
        except LookupError:
            log.info(f'Downloading NLTK resource: {pack}')
            nltk.download(pack, quiet=True)
    
    # Cache NLTK resources globally to avoid repeated imports
    from nltk.corpus import stopwords
    from nltk.stem.porter import PorterStemmer
    _nltk_porter_stemmer = PorterStemmer()
    _nltk_stopwords = set(stopwords.words('english'))


def transform_text(text):
    """Tokenize, remove stop-words, stem – same pipeline used for training."""
    global _nltk_porter_stemmer, _nltk_stopwords
    try:
        import nltk
        # Use cached stemmer and stopwords (pre-loaded at startup)
        ps = _nltk_porter_stemmer
        stop_words = _nltk_stopwords
        
        text = str(text).lower()
        tokens = nltk.word_tokenize(text)
        tokens = [t for t in tokens if t.isalnum()]
        tokens = [t for t in tokens if t not in stop_words and t not in string.punctuation]
        tokens = [ps.stem(t) for t in tokens]
        return ' '.join(tokens)
    except Exception:
        # Graceful fallback if NLTK is unavailable
        return ' '.join(str(text).lower().split())


def load_models() -> bool:
    """Load the full sklearn Pipeline from train_spam_detector.py artifact."""
    global pipeline

    if os.path.exists(PIPELINE_PATH):
        try:
            with open(PIPELINE_PATH, 'rb') as f:
                pipeline = pickle.load(f)
            classifier = pipeline.named_steps.get('model')
            log.info(
                f'Loaded pipeline artifact: {PIPELINE_PATH}  '
                f'(classifier={type(classifier).__name__})'
            )
            return True
        except Exception as exc:
            log.warning(f'Failed to load pipeline artifact: {exc}')
            pipeline = None

    return False


# ── Flask app ─────────────────────────────────────────────────────────────────
try:
    from flask import Flask, request, jsonify
except ImportError:
    print('Flask not installed. Run: pip install flask')
    sys.exit(1)

app = Flask(__name__)


@app.route('/health', methods=['GET'])
def health():
    loaded = pipeline is not None
    mode = 'pipeline' if loaded else 'none'
    return jsonify({'status': 'ok', 'models_loaded': loaded, 'mode': mode})


@app.route('/predict', methods=['POST'])
def predict():
    # Validate internal auth token when configured
    if ML_INTERNAL_TOKEN:
        provided = request.headers.get('X-Internal-Token', '')
        if provided != ML_INTERNAL_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401

    if pipeline is None:
        return jsonify({
            'error': 'Models not loaded. Run train_spam_detector.py first, or POST /train.'
        }), 503

    data = request.get_json(silent=True) or {}
    text = str(data.get('text', '')).strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # Truncate – keep first 600 chars to stay within training distribution
    text = text[:600]
    transformed = transform_text(text)

    pred_raw = pipeline.predict([transformed])[0]
    prediction = int(pred_raw)
    classifier = pipeline.named_steps.get('model')
    if hasattr(classifier, 'predict_proba'):
        proba = pipeline.predict_proba([transformed])[0]
        spam_prob = round(float(proba[1]), 4)
        ham_prob  = round(float(proba[0]), 4)
    elif hasattr(classifier, 'decision_function'):
        # LinearSVC — convert raw margin to probability-like score via sigmoid
        vec_step = pipeline.named_steps.get('tfidf')
        X_vec = vec_step.transform([transformed])
        score = float(classifier.decision_function(X_vec)[0])
        spam_prob = round(_sigmoid(score), 4)
        ham_prob  = round(1.0 - spam_prob, 4)
    else:
        spam_prob = 1.0 if prediction == 1 else 0.0
        ham_prob  = 1.0 - spam_prob

    return jsonify({
        'prediction':       'spam' if prediction == 1 else 'ham',
        'spam_probability': spam_prob,
        'ham_probability':  ham_prob,
        'confidence':       round(max(spam_prob, ham_prob), 4)
    })


@app.route('/train', methods=['POST'])
def retrain():
    """Retrain by delegating to train_spam_detector.py and reload pipeline."""
    # Validate internal auth token if configured
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
                return jsonify({'error': 'Training failed. Check server logs.'}), 500
            load_models()
            return jsonify({'success': True, 'message': 'Models retrained via train_spam_detector.py.'})
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'Training timed out (>5 min).'}), 500
        except Exception as exc:
            log.error(f'Trainer invocation failed: {exc}')

    return jsonify({'error': 'Trainer script not found.'}), 500


@app.route('/predict_batch', methods=['POST'])
def predict_batch():
    """Batch predict endpoint for multiple texts."""
    if ML_INTERNAL_TOKEN:
        provided = request.headers.get('X-Internal-Token', '')
        if provided != ML_INTERNAL_TOKEN:
            return jsonify({'error': 'Unauthorized'}), 401

    if pipeline is None:
        return jsonify({
            'error': 'Models not loaded.'
        }), 503

    data = request.get_json(silent=True) or {}
    texts = data.get('texts', [])
    if not isinstance(texts, list) or len(texts) == 0:
        return jsonify({'error': 'No texts provided (expected list)'}), 400

    results = []
    classifier = pipeline.named_steps.get('model')
    
    # Transform all texts at once
    transformed_texts = [transform_text(str(t)[:600]) for t in texts]
    
    # Batch predict
    try:
        predictions = pipeline.predict(transformed_texts)
        
        if hasattr(classifier, 'predict_proba'):
            probas = pipeline.predict_proba(transformed_texts)
            for i, (pred, proba) in enumerate(zip(predictions, probas)):
                results.append({
                    'index': i,
                    'prediction': 'spam' if int(pred) == 1 else 'ham',
                    'spam_probability': round(float(proba[1]), 4),
                    'ham_probability': round(float(proba[0]), 4),
                    'confidence': round(max(float(proba[0]), float(proba[1])), 4)
                })
        else:
            for i, pred in enumerate(predictions):
                results.append({
                    'index': i,
                    'prediction': 'spam' if int(pred) == 1 else 'ham',
                    'spam_probability': 1.0 if int(pred) == 1 else 0.0,
                    'ham_probability': 0.0 if int(pred) == 1 else 1.0,
                    'confidence': 1.0
                })
    except Exception as e:
        log.error(f'Batch predict error: {e}')
        return jsonify({'error': str(e)}), 500

    return jsonify({'results': results})


# ── Startup ───────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    _ensure_nltk()
    if not load_models():
        log.info('No pipeline artifact found.')
        if os.path.exists(TRAINER_PATH):
            log.info(f'Auto-training via train_spam_detector.py…')
            import subprocess
            result = subprocess.run(
                [sys.executable, TRAINER_PATH],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                load_models()
            else:
                log.warning(f'Auto-training failed:\n{result.stderr}')
        else:
            log.warning('Trainer script not found. Server will return 503 on /predict.')

    log.info(f'Starting predict API on http://localhost:{ML_PORT}')
    app.run(host='0.0.0.0', port=ML_PORT, debug=False)
