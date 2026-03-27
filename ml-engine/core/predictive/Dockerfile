# ML API Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy ML code
COPY . .

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import requests; requests.post('http://localhost:5001/predict', json={'text': 'test'})"

# Start with Gunicorn (production WSGI server)
CMD ["gunicorn", "--workers=4", "--worker-class=sync", "--bind=0.0.0.0:5001", "--timeout=30", "predict_api:app"]
