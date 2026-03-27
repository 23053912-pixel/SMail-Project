#!/bin/bash
# SMail ML-Engine Setup Script

echo "========================================"
echo "SMail ML-Engine Setup"
echo "========================================"

# Check directories
echo "✓ Checking directory structure..."
REQUIRED_DIRS=(
  "core/heuristic"
  "core/predictive"
  "data"
  "analysis"
  "config"
)

for dir in "${REQUIRED_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    echo "  ✓ $dir exists"
  else
    echo "  ✗ $dir missing"
  fi
done

# Python setup
echo ""
echo "✓ Setting up Python environment..."
if command -v python3 &> /dev/null; then
  echo "  ✓ Python 3 found"
  python3 --version
  
  cd core/predictive
  if [ -f requirements.txt ]; then
    echo "  → Installing requirements..."
    pip3 install -r requirements.txt
  fi
  cd ../..
else
  echo "  ✗ Python 3 not found"
fi

# Check Node modules
echo ""
echo "✓ Checking Node.js setup..."
if command -v node &> /dev/null; then
  echo "  ✓ Node.js found"
  node --version
else
  echo "  ✗ Node.js not found"
fi

echo ""
echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Review config/index.md for configuration"
echo "  2. Start ML server: python core/predictive/predict_api.py"
echo "  3. Test with QUICK_START.md commands"
echo ""
echo "Documentation:"
echo "  • README.md - Full documentation"
echo "  • QUICK_START.md - Quick reference"
echo "  • config/index.md - Configuration guide"
