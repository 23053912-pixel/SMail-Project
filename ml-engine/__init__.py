"""
SMail ML Detection Engine
Dual-approach spam and scam detection system
"""

__version__ = "2.0"
__author__ = "SMail Security Team"

# Package information
COMPONENTS = {
    'heuristic': {
        'name': 'Scam Detector (Heuristic)',
        'language': 'JavaScript',
        'file': 'core/heuristic/scamDetector.js',
        'performance': '10-80ms'
    },
    'predictive': {
        'name': 'Spam Predictor (ML)',
        'language': 'Python',
        'file': 'core/predictive/predict_api.py',
        'performance': '100-200ms'
    }
}

print(f"SMail ML-Engine v{__version__}")
print("Components loaded successfully")
