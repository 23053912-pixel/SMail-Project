#!/usr/bin/env python3
"""
Train a spam detection model from a CSV dataset (e.g., Kaggle SMS Spam Collection).

Requirements covered:
1) Load CSV dataset
2) Data cleaning (nulls, duplicates, unnecessary columns)
3) Text preprocessing (lowercase, punctuation removal, stopwords, stemming/lemmatization)
4) TF-IDF vectorization
5) Train/test split
6) ML model training (Naive Bayes / Logistic Regression / SVM)
7) Evaluation (accuracy, precision, recall, F1)
8) Confusion matrix visualization
9) Error handling for file loading/preprocessing
10) Modular functions for each step
"""

from __future__ import annotations

import argparse
import importlib
import os
import pickle
import re
import string
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple

import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend for server environments
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
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


def download_dataset_from_kaggle(dataset_ref: str, csv_name: Optional[str] = None) -> str:
    """Download a Kaggle dataset with kagglehub and return a CSV path."""
    try:
        kagglehub = importlib.import_module("kagglehub")
    except ImportError as exc:
        raise RuntimeError(
            "kagglehub is not installed. Install it with: pip install kagglehub"
        ) from exc

    try:
        dataset_dir = kagglehub.dataset_download(dataset_ref)
    except Exception as exc:
        raise RuntimeError(
            "Kaggle dataset download failed. Ensure Kaggle credentials are configured. "
            f"Underlying error: {exc}"
        ) from exc

    if not os.path.isdir(dataset_dir):
        raise RuntimeError(f"Downloaded dataset path is not a directory: {dataset_dir}")

    if csv_name:
        expected_path = os.path.join(dataset_dir, csv_name)
        if not os.path.exists(expected_path):
            raise FileNotFoundError(
                f"Specified CSV file was not found in downloaded dataset: {expected_path}"
            )
        return expected_path

    # Auto-discover CSV files and pick the first one by name for deterministic behavior.
    csv_files = [
        os.path.join(dataset_dir, name)
        for name in os.listdir(dataset_dir)
        if name.lower().endswith(".csv")
    ]
    csv_files.sort()

    if not csv_files:
        raise FileNotFoundError(
            "No CSV file found in downloaded dataset folder. "
            "Use --kaggle-csv-name to select a file explicitly."
        )

    return csv_files[0]


def ensure_nltk_resources() -> None:
    """Download required NLTK resources if missing."""
    try:
        import nltk

        resources = {
            "stopwords": "corpora/stopwords",
            "wordnet": "corpora/wordnet",
            "omw-1.4": "corpora/omw-1.4",
        }
        for package_name, resource_path in resources.items():
            try:
                nltk.data.find(resource_path)
            except LookupError:
                nltk.download(package_name, quiet=True)
    except Exception as exc:
        raise RuntimeError(f"Failed to initialize NLTK resources: {exc}") from exc


def load_dataset(csv_path: str) -> pd.DataFrame:
    """Load dataset from CSV with fallback encodings and clear errors."""
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Dataset not found: {csv_path}")

    load_errors = []
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            return pd.read_csv(csv_path, encoding=enc)
        except Exception as exc:
            load_errors.append(f"encoding={enc}: {exc}")

    raise ValueError(
        "Could not load CSV file with supported encodings. Errors:\n"
        + "\n".join(load_errors)
    )


def infer_columns(df: pd.DataFrame, text_col: Optional[str], label_col: Optional[str]) -> Tuple[str, str]:
    """Infer text and label columns for common spam datasets."""
    def is_text_like(series: pd.Series) -> bool:
        if pd.api.types.is_numeric_dtype(series):
            return False
        sample = series.dropna().astype(str).head(50)
        if sample.empty:
            return False
        avg_len = sample.str.len().mean()
        return avg_len >= 10

    if text_col and label_col:
        if text_col not in df.columns or label_col not in df.columns:
            raise KeyError(
                f"Provided columns not found. Available columns: {list(df.columns)}"
            )
        if not is_text_like(df[text_col]):
            raise KeyError(
                f"Provided text column '{text_col}' does not look like raw text data."
            )
        return text_col, label_col

    # Common Kaggle SMS Spam Collection format: v1=label, v2=text
    if {"v1", "v2"}.issubset(df.columns) and is_text_like(df["v2"]):
        return "v2", "v1"

    # Common explicit naming
    candidates = [
        ("email_text", "label"),  # Our custom email spam dataset format
        ("text", "label"),
        ("message", "label"),
        ("message", "target"),
        ("sms", "label"),
        ("content", "label"),
    ]
    for txt, lbl in candidates:
        if {txt, lbl}.issubset(df.columns) and is_text_like(df[txt]):
            return txt, lbl

    raise KeyError(
        "Could not infer text and label columns. Use --text-col and --label-col. "
        f"Available columns: {list(df.columns)}"
    )


def detect_binary_label_column(df: pd.DataFrame, preferred: Optional[str] = None) -> str:
    """Detect a binary label column for non-text, wide feature datasets."""
    if preferred:
        if preferred not in df.columns:
            raise KeyError(
                f"Provided label column '{preferred}' not found. Available: {list(df.columns)}"
            )
        return preferred

    preferred_order = ["prediction", "label", "target", "spam", "class", "v1"]
    lower_to_original = {str(c).lower(): c for c in df.columns}

    for name in preferred_order:
        col = lower_to_original.get(name)
        if col is None:
            continue
        unique_values = set(df[col].dropna().astype(str).str.strip().unique())
        if unique_values.issubset({"0", "1", "ham", "spam"}):
            return col

    for col in df.columns:
        unique_values = set(df[col].dropna().astype(str).str.strip().unique())
        if unique_values and unique_values.issubset({"0", "1", "ham", "spam"}):
            return col

    raise KeyError(
        "Could not detect a binary label column for this dataset. "
        "Pass --label-col explicitly."
    )


def build_text_from_wide_features(df: pd.DataFrame, label_col: str) -> pd.DataFrame:
    """Convert wide word-count rows into synthetic text so TF-IDF can be applied."""
    ignored_cols = {label_col.lower(), "email no.", "email_no", "id", "index"}
    feature_cols = [c for c in df.columns if str(c).lower() not in ignored_cols]

    if not feature_cols:
        raise ValueError("No feature columns available to build synthetic text.")

    if not pd.api.types.is_numeric_dtype(df[feature_cols].dtypes):
        # Mixed dtypes are okay; coerce safely.
        feature_matrix = df[feature_cols].apply(pd.to_numeric, errors="coerce").fillna(0)
    else:
        feature_matrix = df[feature_cols]

    feature_names = np.array([str(c) for c in feature_cols], dtype=object)
    values = feature_matrix.to_numpy(dtype=float, copy=False)

    texts = []
    for row in values:
        idxs = np.where(row > 0)[0]
        tokens = []
        for idx in idxs:
            token = feature_names[idx]
            repeat = int(min(max(row[idx], 1), 3))
            tokens.extend([token] * repeat)
        texts.append(" ".join(tokens))

    return pd.DataFrame({"text": texts, "label": df[label_col].astype(str)})


def clean_dataset(df: pd.DataFrame, text_col: str, label_col: str) -> pd.DataFrame:
    """Remove unnecessary columns, nulls, and duplicates."""
    # Drop common unnecessary columns (often named Unnamed: X in CSV exports)
    df = df.drop(
        columns=[c for c in df.columns if str(c).startswith("Unnamed")],
        errors="ignore",
    )

    # Keep only required columns and standardize names
    cleaned = df[[text_col, label_col]].copy()
    cleaned.columns = ["text", "label"]

    # Drop rows with missing values
    cleaned = cleaned.dropna(subset=["text", "label"])

    # Normalize to string and remove empty entries
    cleaned["text"] = cleaned["text"].astype(str).str.strip()
    cleaned["label"] = cleaned["label"].astype(str).str.strip()
    cleaned = cleaned[(cleaned["text"] != "") & (cleaned["label"] != "")]

    # Remove exact duplicates
    cleaned = cleaned.drop_duplicates().reset_index(drop=True)

    return cleaned


def get_stopwords() -> set:
    from nltk.corpus import stopwords

    return set(stopwords.words("english"))


def normalize_label(label: str) -> int:
    """Convert label to binary integer: ham=0, spam=1."""
    normalized = str(label).strip().lower()
    spam_aliases = {"spam", "1", "true", "yes", "junk"}
    ham_aliases = {"ham", "0", "false", "no", "legit", "not spam"}

    # Handle numeric label schemes (e.g., 0..N where non-zero indicates spam-like class).
    try:
        numeric_value = float(normalized)
        return 0 if numeric_value == 0 else 1
    except ValueError:
        pass

    if normalized in spam_aliases:
        return 1
    if normalized in ham_aliases:
        return 0

    raise ValueError(
        f"Unknown label value: {label!r}. Expected ham/spam style labels or 0/1."
    )


def preprocess_text(
    text: str,
    stop_words: Iterable[str],
    use_lemmatization: bool = True,
) -> str:
    """Lowercase, remove punctuation, remove stopwords, and stem/lemmatize."""
    try:
        from nltk.stem import PorterStemmer, WordNetLemmatizer
    except Exception as exc:
        raise RuntimeError(f"Failed to import NLTK stemmers: {exc}") from exc

    if not isinstance(text, str):
        text = str(text)

    text = text.lower()
    text = re.sub(rf"[{re.escape(string.punctuation)}]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    tokens = [tok for tok in text.split() if tok not in stop_words and tok.isalpha()]

    if use_lemmatization:
        lemmatizer = WordNetLemmatizer()
        tokens = [lemmatizer.lemmatize(tok) for tok in tokens]
    else:
        stemmer = PorterStemmer()
        tokens = [stemmer.stem(tok) for tok in tokens]

    return " ".join(tokens)


def preprocess_dataset(df: pd.DataFrame, use_lemmatization: bool = True) -> pd.DataFrame:
    """Apply label normalization and text preprocessing with robust error handling."""
    if df.empty:
        raise ValueError("Dataset is empty after cleaning.")

    stop_words = get_stopwords()

    # Convert labels first to fail early if labels are unexpected.
    try:
        df = df.copy()
        df["target"] = df["label"].apply(normalize_label)
    except Exception as exc:
        raise ValueError(f"Label preprocessing failed: {exc}") from exc

    try:
        df["processed_text"] = df["text"].apply(
            lambda t: preprocess_text(
                t, stop_words=stop_words, use_lemmatization=use_lemmatization
            )
        )
    except Exception as exc:
        raise ValueError(f"Text preprocessing failed: {exc}") from exc

    # Remove rows where preprocessing produced empty text
    df = df[df["processed_text"].str.len() > 0].copy()
    if df.empty:
        raise ValueError("All rows became empty after text preprocessing.")

    # Remove duplicates after normalization
    df = df.drop_duplicates(subset=["processed_text", "target"]).reset_index(drop=True)
    return df


def preprocess_wide_feature_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """Preprocess synthetic text built from wide feature tables.

    For wide feature datasets, tokens are already engineered feature names.
    Aggressive NLP cleanup (stopword removal/stemming) can remove signal, so we keep
    preprocessing minimal.
    """
    if df.empty:
        raise ValueError("Dataset is empty after cleaning.")

    try:
        out = df.copy()
        out["target"] = out["label"].apply(normalize_label)
    except Exception as exc:
        raise ValueError(f"Label preprocessing failed: {exc}") from exc

    out["processed_text"] = (
        out["text"].astype(str).str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
    )
    out = out[out["processed_text"].str.len() > 0].copy()
    if out.empty:
        raise ValueError("All rows became empty after wide-dataset preprocessing.")

    out = out.drop_duplicates(subset=["processed_text", "target"]).reset_index(drop=True)
    return out


def build_model(model_name: str):
    """Build supported classifier by name."""
    name = model_name.lower().strip()
    if name in {"nb", "naive_bayes", "multinomialnb"}:
        return MultinomialNB()
    if name in {"logreg", "logistic", "logistic_regression"}:
        return LogisticRegression(max_iter=1000)
    if name in {"svm", "linearsvm", "linear_svc"}:
        return LinearSVC()

    raise ValueError(
        "Unsupported model_name. Use one of: nb, logistic_regression, svm"
    )


def train_pipeline(
    X_train: pd.Series,
    y_train: pd.Series,
    model_name: str,
    max_features: int,
) -> Pipeline:
    """Train TF-IDF + selected classifier pipeline."""
    classifier = build_model(model_name)
    pipeline = Pipeline(
        [
            ("tfidf", TfidfVectorizer(max_features=max_features)),
            ("model", classifier),
        ]
    )
    pipeline.fit(X_train, y_train)
    return pipeline


def evaluate_model(
    pipeline: Pipeline,
    X_test: pd.Series,
    y_test: pd.Series,
) -> Dict[str, Any]:
    """Evaluate with accuracy, precision, recall, F1 and confusion matrix."""
    preds = pipeline.predict(X_test)

    metrics = {
        "accuracy": accuracy_score(y_test, preds),
        "precision": precision_score(y_test, preds, zero_division=0),
        "recall": recall_score(y_test, preds, zero_division=0),
        "f1_score": f1_score(y_test, preds, zero_division=0),
    }
    cm = confusion_matrix(y_test, preds)
    return {**metrics, "confusion_matrix": cm}


def plot_confusion_matrix(cm: np.ndarray, output_path: str, show_plot: bool = False) -> None:
    """Save confusion matrix plot to disk and optionally display it."""
    plt.figure(figsize=(6, 5))
    sns.heatmap(
        cm,
        annot=True,
        fmt="d",
        cmap="Blues",
        xticklabels=["Ham", "Spam"],
        yticklabels=["Ham", "Spam"],
    )
    plt.title("Confusion Matrix")
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)

    if show_plot:
        plt.show()
    else:
        plt.close()


def save_artifacts(pipeline: Pipeline, output_dir: str) -> Tuple[str, str]:
    """Save full pipeline and just the vectorizer separately."""
    os.makedirs(output_dir, exist_ok=True)
    pipeline_path = os.path.join(output_dir, "spam_pipeline.pkl")
    vectorizer_path = os.path.join(output_dir, "tfidf_vectorizer.pkl")

    with open(pipeline_path, "wb") as f:
        pickle.dump(pipeline, f)

    with open(vectorizer_path, "wb") as f:
        pickle.dump(pipeline.named_steps["tfidf"], f)

    return pipeline_path, vectorizer_path


def run_training(config: Config) -> None:
    """Main orchestration function for training flow."""
    ensure_nltk_resources()

    csv_path = config.csv_path
    if config.kaggle_dataset:
        csv_path = download_dataset_from_kaggle(
            config.kaggle_dataset,
            csv_name=config.kaggle_csv_name,
        )
        print(f"Kaggle dataset downloaded. Using CSV: {csv_path}")

    df = load_dataset(csv_path)

    is_wide_dataset = False

    try:
        text_col, label_col = infer_columns(df, config.text_col, config.label_col)
        cleaned = clean_dataset(df, text_col=text_col, label_col=label_col)
    except KeyError:
        # Some Kaggle email datasets are already wide word-count tables.
        # Convert those rows back to synthetic text so the TF-IDF requirement is preserved.
        detected_label_col = detect_binary_label_column(df, preferred=config.label_col)
        wide_text_df = build_text_from_wide_features(df, label_col=detected_label_col)
        cleaned = clean_dataset(wide_text_df, text_col="text", label_col="label")
        is_wide_dataset = True
        print(
            "Detected wide feature dataset format; "
            f"using '{detected_label_col}' as label and auto-building text from features."
        )

    if is_wide_dataset:
        processed = preprocess_wide_feature_dataset(cleaned)
    else:
        processed = preprocess_dataset(cleaned, use_lemmatization=config.use_lemmatization)

    X = processed["processed_text"]
    y = processed["target"]

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=config.test_size,
        random_state=config.random_state,
        stratify=y,
    )

    pipeline = train_pipeline(
        X_train,
        y_train,
        model_name=config.model_name,
        max_features=config.max_features,
    )

    results = evaluate_model(pipeline, X_test, y_test)

    os.makedirs(config.output_dir, exist_ok=True)
    cm_path = os.path.join(config.output_dir, "confusion_matrix.png")
    plot_confusion_matrix(
        results["confusion_matrix"],
        output_path=cm_path,
        show_plot=config.show_plot,
    )

    pipeline_path, vectorizer_path = save_artifacts(pipeline, config.output_dir)

    print("=" * 60)
    print("Spam Detection Training Complete")
    print("=" * 60)
    print(f"Dataset: {csv_path}")
    print(f"Rows after preprocessing: {len(processed)}")
    print(f"Model: {config.model_name}")
    print(f"Accuracy : {results['accuracy']:.4f}")
    print(f"Precision: {results['precision']:.4f}")
    print(f"Recall   : {results['recall']:.4f}")
    print(f"F1-score : {results['f1_score']:.4f}")
    print(f"Confusion matrix image: {cm_path}")
    print(f"Saved pipeline: {pipeline_path}")
    print(f"Saved vectorizer: {vectorizer_path}")


def parse_args() -> Config:
    parser = argparse.ArgumentParser(
        description="Train a spam detection model from CSV data."
    )
    parser.add_argument(
        "--csv-path",
        default=os.path.join(os.path.dirname(__file__), "..", "..", "data", "email_spam.csv"),
        help="Path to dataset CSV file (defaults to email_spam.csv).",
    )
    parser.add_argument(
        "--kaggle-dataset",
        default=None,
        help=(
            "Optional Kaggle dataset reference for auto download, e.g. "
            "balaka18/email-spam-classification-dataset-csv"
        ),
    )
    parser.add_argument(
        "--kaggle-csv-name",
        default=None,
        help="Optional CSV filename inside downloaded Kaggle dataset.",
    )
    parser.add_argument(
        "--model",
        default="nb",
        choices=["nb", "logistic_regression", "svm"],
        help="Classifier to train.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test split fraction.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for train/test split.",
    )
    parser.add_argument(
        "--max-features",
        type=int,
        default=5000,
        help="Max TF-IDF features.",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(__file__), "artifacts"),
        help="Directory to save model artifacts and plots.",
    )
    parser.add_argument(
        "--text-col",
        default=None,
        help="Optional dataset text column name.",
    )
    parser.add_argument(
        "--label-col",
        default=None,
        help="Optional dataset label column name.",
    )
    parser.add_argument(
        "--use-stemming",
        action="store_true",
        help="Use stemming instead of lemmatization.",
    )
    parser.add_argument(
        "--show-plot",
        action="store_true",
        help="Display confusion matrix plot window.",
    )

    args = parser.parse_args()
    return Config(
        csv_path=os.path.abspath(args.csv_path),
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
    )


def main() -> None:
    try:
        config = parse_args()
        run_training(config)
    except FileNotFoundError as exc:
        print(f"[ERROR] File loading failed: {exc}")
    except (ValueError, KeyError, RuntimeError) as exc:
        print(f"[ERROR] Preprocessing/training failed: {exc}")
    except Exception as exc:
        print(f"[ERROR] Unexpected failure: {exc}")


if __name__ == "__main__":
    main()
