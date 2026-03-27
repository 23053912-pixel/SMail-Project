#!/usr/bin/env python3
"""
Quick Email Spam Detector Training
Trains a simple Naive Bayes classifier on email spam dataset
"""

import os
import pickle
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Paths
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
CSV_FILE = os.path.join(DATA_DIR, "email_spam.csv")
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
MODEL_FILE = os.path.join(ARTIFACTS_DIR, "spam_pipeline.pkl")

os.makedirs(ARTIFACTS_DIR, exist_ok=True)

print("Loading email spam dataset...")
df = pd.read_csv(CSV_FILE)
print(f"Loaded {len(df)} emails")

# Prepare data
X = df['email_text'].values
y = (df['label'] == 'spam').astype(int).values

print(f"Spam emails: {(y == 1).sum()}")
print(f"Ham emails: {(y == 0).sum()}")

# Split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Build pipeline
print("\nTraining model...")
pipeline = Pipeline([
    ('tfidf', TfidfVectorizer(max_features=2000, stop_words='english', ngram_range=(1, 2))),
    ('clf', MultinomialNB(alpha=0.1))
])

pipeline.fit(X_train, y_train)

# Evaluate
y_pred = pipeline.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
precision = precision_score(y_test, y_pred)
recall = recall_score(y_test, y_pred)
f1 = f1_score(y_test, y_pred)

print(f"\nModel Performance:")
print(f"  Accuracy:  {accuracy:.2%}")
print(f"  Precision: {precision:.2%}")
print(f"  Recall:    {recall:.2%}")
print(f"  F1-Score:  {f1:.2%}")

# Save model
print(f"\nSaving model to {MODEL_FILE}...")
with open(MODEL_FILE, 'wb') as f:
    pickle.dump(pipeline, f)

print("✓ Training complete! Model saved.")
