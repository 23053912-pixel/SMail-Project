#!/usr/bin/env python3
"""
Enhanced Spam Detection Training for Email
==========================================
Improvements over base trainer:
1. Email-specific preprocessing (HTML, URLs, headers)
2. Feature engineering (URL count, urgency score, special chars)
3. Ensemble voting (NB + LR + SVM)
4. Cross-validation for robust evaluation
5. Class weight balancing for imbalanced datasets
"""

from __future__ import annotations

import argparse
import os
import pickle
import re
import string
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import VotingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC


@dataclass
class Config:
    csv_path: str
    kaggle_dataset: Optional[str]
    kaggle_csv_name: Optional[str]
    model_name: str
    test_size: float
    random_state: int
    max_features: int
    output_dir: str
    text_col: Optional[str]
    label_col: Optional[str]
    use_lemmatization: bool
    show_plot: bool
    use_ensemble: bool = True
    use_email_features: bool = True
    n_folds: int = 5


# ── Email-Specific Preprocessing ──────────────────────────────────────────────

def extract_email_features(text: str) -> Dict[str, float]:
    """Extract email-specific numerical features from text."""
    text_str = str(text) if not isinstance(text, str) else text
    text_lower = text_str.lower()
    
    features = {}
    
    # URL features
    urls = re.findall(r'https?://\S+|www\.\S+', text_str)
    features['url_count'] = len(urls)
    features['has_ip_url'] = 1.0 if re.search(r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', text_str) else 0.0
    features['has_shortened_url'] = 1.0 if any(s in text_lower for s in ['bit.ly', 'tinyurl', 'goo.gl', 'ow.ly']) else 0.0
    
    # Special character patterns
    features['exclamation_count'] = text_str.count('!')
    features['question_count'] = text_str.count('?')
    features['dollar_count'] = text_str.count('$')
    features['uppercase_ratio'] = sum(1 for c in text_str if c.isupper()) / max(len(text_str), 1)
    features['special_char_ratio'] = sum(1 for c in text_str if not c.isalnum() and not c.isspace()) / max(len(text_str), 1)
    
    # Urgency indicators
    urgency_words = ['urgent', 'immediate', 'act now', 'limited time', 'expires', 'deadline', 'hurry']
    features['urgency_score'] = sum(1 for w in urgency_words if w in text_lower)
    
    # Financial indicators
    financial_words = ['free', 'winner', 'congratulations', 'prize', 'reward', 'cash', 'bonus', 'offer']
    features['financial_score'] = sum(1 for w in financial_words if w in text_lower)
    
    # Text statistics
    features['text_length'] = len(text_str)
    features['word_count'] = len(text_str.split())
    features['avg_word_length'] = np.mean([len(w) for w in text_str.split()]) if text_str.split() else 0
    
    # HTML indicators
    features['has_html'] = 1.0 if '<html' in text_lower or '<body' in text_lower else 0.0
    features['html_tag_count'] = len(re.findall(r'<[^>]+>', text_str))
    
    return features


def preprocess_email_text(text: str, use_lemmatization: bool = True) -> str:
    """Enhanced preprocessing for email content."""
    try:
        import nltk
        from nltk.corpus import stopwords
        from nltk.stem import WordNetLemmatizer
        from nltk.tokenize import word_tokenize
    except ImportError:
        # Fallback to basic preprocessing
        return ' '.join(text.lower().split())
    
    if not isinstance(text, str):
        text = str(text)
    
    # Remove HTML tags but preserve content
    text = re.sub(r'<[^>]+>', ' ', text)
    
    # Extract and normalize URLs (keep domain as token)
    text = re.sub(r'https?://([^/\s]+)', r' URL_DOMAIN \1 ', text)
    text = re.sub(r'https?://\S+', ' URL_TOKEN ', text)
    
    # Remove email addresses but keep domain
    text = re.sub(r'\S+@(\S+)', r' EMAIL_DOMAIN \1 ', text)
    
    # Normalize special characters
    text = re.sub(r'[!]{2,}', ' MULTIPLE_EXCLAMATION ', text)
    text = re.sub(r'[$]{1,}', ' DOLLAR_SIGN ', text)
    text = re.sub(r'[?]{2,}', ' MULTIPLE_QUESTION ', text)
    
    # Lowercase
    text = text.lower()
    
    # Remove remaining punctuation
    text = re.sub(rf'[{re.escape(string.punctuation)}]', ' ', text)
    
    # Remove numbers but keep patterns
    text = re.sub(r'\b\d+\b', ' NUMBER ', text)
    
    # Tokenize
    tokens = word_tokenize(text)
    
    # Remove stopwords and apply lemmatization
    stop_words = set(stopwords.words('english'))
    lemmatizer = WordNetLemmatizer()
    
    tokens = [
        lemmatizer.lemmatize(t) if use_lemmatization else t
        for t in tokens
        if t not in stop_words and len(t) > 1
    ]
    
    return ' '.join(tokens)


def augment_dataset_with_synthetic(df: pd.DataFrame) -> pd.DataFrame:
    """Add synthetic spam patterns to improve model robustness."""
    synthetic_spam = [
        "Congratulations! You've won a $1000 gift card! Click here to claim now!",
        "URGENT: Your account has been compromised. Verify your identity immediately.",
        "Make $5000 per week working from home! No experience needed!",
        "Free iPhone 15! Limited time offer. Act now before it expires!",
        "You've been selected for a special prize! Claim your reward today!",
        "Bitcoin investment: Guaranteed 500% returns in just 7 days!",
        "Your package delivery failed. Click here to reschedule: bit.ly/fake",
        "Account suspended: Verify your password to restore access immediately.",
        "Hot singles in your area want to meet you! Click here now!",
        "Discount pharmacy: Buy now, save 90%! No prescription needed!",
    ]
    
    synthetic_ham = [
        "Hi, the meeting has been rescheduled to 3 PM tomorrow. Please update your calendar.",
        "Thank you for your order. Your confirmation number is #12345.",
        "Please find attached the quarterly report for your review.",
        "Reminder: Your dentist appointment is scheduled for Friday at 2 PM.",
        "Hey, are you available for lunch today? Let me know.",
        "The project deadline has been extended to next Friday.",
        "Your subscription renewal is coming up next month.",
        "Great job on the presentation! The client was impressed.",
        "Can you send me the updated spreadsheet when you get a chance?",
        "Meeting notes from today's standup are in the shared drive.",
    ]
    
    rows = []
    for text in synthetic_spam:
        rows.append({'text': text, 'label': 'spam', 'source': 'synthetic'})
    for text in synthetic_ham:
        rows.append({'text': text, 'label': 'ham', 'source': 'synthetic'})
    
    synthetic_df = pd.DataFrame(rows)
    return pd.concat([df, synthetic_df], ignore_index=True)


def load_and_combine_datasets(config: Config) -> pd.DataFrame:
    """Load and combine multiple datasets for better training."""
    dfs = []
    
    # Load primary dataset
    if config.csv_path and os.path.exists(config.csv_path):
        print(f"Loading primary dataset: {config.csv_path}")
        df = pd.read_csv(config.csv_path, encoding='latin-1')
        dfs.append(df)
    
    # Try to download additional email spam dataset
    if config.kaggle_dataset:
        try:
            import kagglehub
            dataset_dir = kagglehub.dataset_download(config.kaggle_dataset)
            csv_files = [f for f in os.listdir(dataset_dir) if f.endswith('.csv')]
            if csv_files:
                additional_df = pd.read_csv(os.path.join(dataset_dir, csv_files[0]), encoding='latin-1')
                dfs.append(additional_df)
                print(f"Loaded additional dataset: {csv_files[0]}")
        except Exception as e:
            print(f"Could not load additional dataset: {e}")
    
    if not dfs:
        raise ValueError("No datasets could be loaded")
    
    # Combine datasets
    if len(dfs) > 1:
        # Standardize column names
        for i, df in enumerate(dfs):
            cols = df.columns.tolist()
            if 'v1' in cols and 'v2' in cols:
                dfs[i] = df.rename(columns={'v1': 'label', 'v2': 'text'})
            elif 'label' not in cols or 'text' not in cols:
                # Try to infer columns
                text_col = None
                label_col = None
                for c in cols:
                    if df[c].dtype == object and df[c].str.len().mean() > 10:
                        text_col = c
                    elif set(df[c].dropna().unique()).issubset({'ham', 'spam', '0', '1'}):
                        label_col = c
                if text_col and label_col:
                    dfs[i] = df.rename(columns={text_col: 'text', label_col: 'label'})
        
        combined = pd.concat(dfs, ignore_index=True)
    else:
        combined = dfs[0]
    
    return combined


# ── Model Building ────────────────────────────────────────────────────────────

def build_ensemble_model() -> VotingClassifier:
    """Build an ensemble of NB, LR, and SVM for robust predictions."""
    nb = MultinomialNB(alpha=0.1)
    lr = LogisticRegression(max_iter=1000, C=1.0, class_weight='balanced')
    svm = LinearSVC(class_weight='balanced', max_iter=2000)
    
    # Calibrate SVM for probability estimates
    svm_calibrated = CalibratedClassifierCV(svm, cv=3)
    
    ensemble = VotingClassifier(
        estimators=[
            ('nb', nb),
            ('lr', lr),
            ('svm', svm_calibrated)
        ],
        voting='soft',  # Use probability-based voting
        weights=[1, 2, 2]  # Weight LR and SVM higher
    )
    
    return ensemble


def train_enhanced_pipeline(
    X_train: pd.Series,
    y_train: pd.Series,
    model_name: str,
    max_features: int,
    use_ensemble: bool = True,
) -> Pipeline:
    """Train enhanced pipeline with email-aware preprocessing."""
    if use_ensemble:
        classifier = build_ensemble_model()
    else:
        classifier = MultinomialNB(alpha=0.1)
    
    # Enhanced TF-IDF with n-grams
    tfidf = TfidfVectorizer(
        max_features=max_features,
        ngram_range=(1, 2),  # Unigrams and bigrams
        min_df=2,
        max_df=0.95,
        sublinear_tf=True
    )
    
    pipeline = Pipeline([
        ('tfidf', tfidf),
        ('model', classifier)
    ])
    
    pipeline.fit(X_train, y_train)
    return pipeline


def cross_validate_model(
    pipeline: Pipeline,
    X: pd.Series,
    y: pd.Series,
    n_folds: int = 5,
) -> Dict[str, List[float]]:
    """Perform stratified k-fold cross-validation."""
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)
    
    metrics = {
        'accuracy': [],
        'precision': [],
        'recall': [],
        'f1': []
    }
    
    for fold, (train_idx, val_idx) in enumerate(skf.split(X, y)):
        X_fold_train, X_fold_val = X.iloc[train_idx], X.iloc[val_idx]
        y_fold_train, y_fold_val = y.iloc[train_idx], y.iloc[val_idx]
        
        # Clone and train
        from sklearn.base import clone
        fold_pipeline = clone(pipeline)
        fold_pipeline.fit(X_fold_train, y_fold_train)
        
        # Predict
        y_pred = fold_pipeline.predict(X_fold_val)
        
        # Calculate metrics
        metrics['accuracy'].append(accuracy_score(y_fold_val, y_pred))
        metrics['precision'].append(precision_score(y_fold_val, y_pred, zero_division=0))
        metrics['recall'].append(recall_score(y_fold_val, y_pred, zero_division=0))
        metrics['f1'].append(f1_score(y_fold_val, y_pred, zero_division=0))
    
    return metrics


def evaluate_model_enhanced(
    pipeline: Pipeline,
    X_test: pd.Series,
    y_test: pd.Series,
) -> Dict[str, Any]:
    """Enhanced evaluation with additional metrics."""
    y_pred = pipeline.predict(X_test)
    
    # Get probabilities if available
    y_proba = None
    if hasattr(pipeline, 'predict_proba'):
        try:
            y_proba = pipeline.predict_proba(X_test)[:, 1]
        except:
            pass
    
    metrics = {
        'accuracy': accuracy_score(y_test, y_pred),
        'precision': precision_score(y_test, y_pred, zero_division=0),
        'recall': recall_score(y_test, y_pred, zero_division=0),
        'f1_score': f1_score(y_test, y_pred, zero_division=0),
        'classification_report': classification_report(y_test, y_pred, output_dict=True)
    }
    
    if y_proba is not None:
        try:
            metrics['roc_auc'] = roc_auc_score(y_test, y_proba)
        except:
            pass
    
    metrics['confusion_matrix'] = confusion_matrix(y_test, y_pred)
    
    return metrics


def plot_enhanced_confusion_matrix(
    cm: np.ndarray,
    output_path: str,
    show_plot: bool = False,
) -> None:
    """Plot confusion matrix with percentages."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import seaborn as sns
    
    plt.figure(figsize=(8, 6))
    
    # Calculate percentages
    cm_percent = cm.astype('float') / cm.sum() * 100
    
    # Create annotation with both counts and percentages
    annot = np.array([
        [f'{count}\n({percent:.1f}%)' 
         for count, percent in zip(row, percent_row)]
        for row, percent_row in zip(cm, cm_percent)
    ])
    
    sns.heatmap(
        cm,
        annot=annot,
        fmt='',
        cmap='Blues',
        xticklabels=['Ham', 'Spam'],
        yticklabels=['Ham', 'Spam'],
        cbar_kws={'label': 'Count'}
    )
    plt.title('Confusion Matrix (Count + Percentage)')
    plt.xlabel('Predicted')
    plt.ylabel('Actual')
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    
    if show_plot:
        plt.show()
    else:
        plt.close()


def save_enhanced_artifacts(
    pipeline: Pipeline,
    output_dir: str,
    metrics: Dict[str, Any],
) -> Tuple[str, str, str]:
    """Save pipeline, vectorizer, and metadata."""
    os.makedirs(output_dir, exist_ok=True)
    
    pipeline_path = os.path.join(output_dir, 'spam_pipeline.pkl')
    vectorizer_path = os.path.join(output_dir, 'tfidf_vectorizer.pkl')
    metadata_path = os.path.join(output_dir, 'model_metadata.pkl')
    
    with open(pipeline_path, 'wb') as f:
        pickle.dump(pipeline, f)
    
    with open(vectorizer_path, 'wb') as f:
        pickle.dump(pipeline.named_steps['tfidf'], f)
    
    # Save metadata for deployment
    metadata = {
        'model_type': type(pipeline.named_steps['model']).__name__,
        'tfidf_max_features': pipeline.named_steps['tfidf'].max_features,
        'tfidf_ngram_range': pipeline.named_steps['tfidf'].ngram_range,
        'metrics': {k: v for k, v in metrics.items() if k != 'confusion_matrix'}
    }
    with open(metadata_path, 'wb') as f:
        pickle.dump(metadata, f)
    
    return pipeline_path, vectorizer_path, metadata_path


# ── Main Training ─────────────────────────────────────────────────────────────

def run_enhanced_training(config: Config) -> None:
    """Main training orchestration."""
    print("=" * 60)
    print("Enhanced Spam Detection Training")
    print("=" * 60)
    
    # Load and combine datasets
    print("\n[1/7] Loading datasets...")
    df = load_and_combine_datasets(config)
    print(f"  Loaded {len(df)} samples")
    
    # Augment with synthetic data
    print("\n[2/7] Augmenting dataset...")
    df = augment_dataset_with_synthetic(df)
    print(f"  Total samples after augmentation: {len(df)}")
    
    # Clean and preprocess
    print("\n[3/7] Preprocessing text...")
    df = df[['text', 'label']].dropna()
    df = df[df['text'].str.strip() != '']
    df['target'] = df['label'].apply(lambda x: 1 if str(x).lower() in ['spam', '1', 'true'] else 0)
    df['processed_text'] = df['text'].apply(lambda x: preprocess_email_text(x, config.use_lemmatization))
    df = df[df['processed_text'].str.len() > 0]
    print(f"  Samples after preprocessing: {len(df)}")
    
    # Split data
    print("\n[4/7] Splitting dataset...")
    X = df['processed_text']
    y = df['target']
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=config.test_size,
        random_state=config.random_state,
        stratify=y
    )
    print(f"  Train: {len(X_train)}, Test: {len(X_test)}")
    
    # Train model
    print("\n[5/7] Training model...")
    pipeline = train_enhanced_pipeline(
        X_train, y_train,
        model_name=config.model_name,
        max_features=config.max_features,
        use_ensemble=config.use_ensemble
    )
    print(f"  Model type: {type(pipeline.named_steps['model']).__name__}")
    
    # Cross-validate
    print(f"\n[6/7] Cross-validating ({config.n_folds} folds)...")
    cv_metrics = cross_validate_model(pipeline, X, y, config.n_folds)
    for metric, values in cv_metrics.items():
        print(f"  {metric}: {np.mean(values):.4f} (+/- {np.std(values):.4f})")
    
    # Final evaluation
    print("\n[7/7] Final evaluation...")
    metrics = evaluate_model_enhanced(pipeline, X_test, y_test)
    
    # Save artifacts
    pipeline_path, vectorizer_path, metadata_path = save_enhanced_artifacts(
        pipeline, config.output_dir, metrics
    )
    
    # Plot confusion matrix
    cm_path = os.path.join(config.output_dir, 'confusion_matrix.png')
    plot_enhanced_confusion_matrix(metrics['confusion_matrix'], cm_path, config.show_plot)
    
    # Print results
    print("\n" + "=" * 60)
    print("Training Complete!")
    print("=" * 60)
    print(f"Accuracy : {metrics['accuracy']:.4f}")
    print(f"Precision: {metrics['precision']:.4f}")
    print(f"Recall   : {metrics['recall']:.4f}")
    print(f"F1-score : {metrics['f1_score']:.4f}")
    if 'roc_auc' in metrics:
        print(f"ROC AUC  : {metrics['roc_auc']:.4f}")
    print(f"\nSaved pipeline: {pipeline_path}")
    print(f"Saved vectorizer: {vectorizer_path}")
    print(f"Saved metadata: {metadata_path}")
    print(f"Confusion matrix: {cm_path}")


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description="Enhanced spam detection training.")
    
    parser.add_argument('--csv-path', default=os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'email_spam.csv'))
    parser.add_argument('--kaggle-dataset', default='uciml/sms-spam-collection-dataset')
    parser.add_argument('--kaggle-csv-name', default='spam.csv')
    parser.add_argument('--model', default='ensemble', choices=['nb', 'logistic_regression', 'svm', 'ensemble'])
    parser.add_argument('--test-size', type=float, default=0.2)
    parser.add_argument('--random-state', type=int, default=42)
    parser.add_argument('--max-features', type=int, default=10000)
    parser.add_argument('--output-dir', default=os.path.join(os.path.dirname(__file__), 'artifacts'))
    parser.add_argument('--text-col', default=None)
    parser.add_argument('--label-col', default=None)
    parser.add_argument('--use-stemming', action='store_true')
    parser.add_argument('--show-plot', action='store_true')
    parser.add_argument('--no-ensemble', action='store_true')
    parser.add_argument('--n-folds', type=int, default=5)
    
    args = parser.parse_args()
    
    return Config(
        csv_path=os.path.abspath(args.csv_path) if args.csv_path else None,
        kaggle_dataset=args.kaggle_dataset,
        kaggle_csv_name=args.kaggle_csv_name,
        model_name=args.model,
        test_size=args.test_size,
        random_state=args.random_state,
        max_features=args.max_features,
        output_dir=os.path.abspath(args.output_dir),
        text_col=args.text_col,
        label_col=args.label_col,
        use_lemmatization=not args.use_stemming,
        show_plot=args.show_plot,
        use_ensemble=not args.no_ensemble,
        n_folds=args.n_folds
    )


if __name__ == '__main__':
    config = parse_args()
    run_enhanced_training(config)
