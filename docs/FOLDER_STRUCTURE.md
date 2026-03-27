# SMail – Folder Structure

```
ml portion spam/
├── backend/                    # Node.js backend service
│   ├── server.js              # Main Express server
│   ├── config.js              # Configuration file
│   ├── package.json           # Backend dependencies
│   ├── middleware/            # Express middleware
│   │   └── auth.js            # Authentication middleware
│   ├── routes/                # API route handlers
│   │   ├── auth.js            # OAuth/Auth routes
│   │   └── emails.js          # Email management routes
│   ├── services/              # Business logic
│   │   └── gmail.js           # Gmail API service
│   ├── data/                  # Runtime storage
│   │   ├── database.sqlite    # SQLite database file
│   │   ├── database.sqlite-shm
│   │   └── database.sqlite-wal
│   └── utils/                 # Utility functions
│       └── session.js         # Session management
│
├── frontend/                  # React/Vanilla JS frontend
│   ├── index.html            # HTML entry point
│   ├── app.js                # Main JavaScript app
│   └── styles.css            # Styling
│
├── ml-engine/                # Python ML service
│   ├── core/                 # Core ML functionality
│   │   └── predictive/       # Spam prediction API
│   │       ├── predict_api.py    # Flask API server
│   │       └── model/        # Trained model
│   │           ├── train_spam_detector.py  # Training script
│   │           └── artifacts/     # Serialized models
│   ├── analysis/             # Data analysis & notebooks
│   │   ├── data_analysis_demo.ipynb
│   │   └── spam_detection_report.ipynb
│   ├── data/                 # Dataset files
│   │   ├── spam.csv          # Training data
│   │   └── database_schema.sql   # Database schema
│   └── config/               # ML configuration
│
├── docs/                     # Documentation
│   ├── CHANGELOG.md
│   ├── PERFORMANCE_OPTIMIZATIONS.md
│   ├── PERFORMANCE_FIX_SUMMARY.md
│   ├── PERFORMANCE_OPTIMIZATION_v2.md
│   ├── QUICK_PERF_GUIDE.md
│   └── FOLDER_STRUCTURE.md
│
├── .vscode/                  # VS Code settings
├── .git/                     # Git repository
├── .gitignore               # Git ignore rules
├── package.json             # Root package.json
├── package-lock.json        # Lock file
├── README.md                # Main documentation
└── .env.example             # Environment template
```

## Structure Explanation

| Folder | Purpose |
|--------|---------|
| `backend/` | Node.js server, routes, middleware, Gmail integration, email management |
| `frontend/` | Browser UI for email viewing and spam detection |
| `ml-engine/` | Python-based spam detection ML model and training pipeline |
| `docs/` | All documentation, guides, and performance notes |

## Organization Principles

- **Separation of Concerns**: Backend, frontend, and ML services are independent
- **Logical Grouping**: Related files grouped by functionality
- **Clean Root**: Only essential files (package.json, README.md, .env.example) at root
- **Scalability**: Each service can grow independently without cluttering other areas

## Configuration

1. Copy `.env.example` to `.env` and fill in credentials
2. Backend config: `backend/config.js`
3. ML config: `ml-engine/config/`

## Running Services

```bash
# Backend
cd backend && npm start

# ML Service
cd ml-engine/core/predictive && python predict_api.py

# Frontend (from root)
cd frontend && open index.html
```
