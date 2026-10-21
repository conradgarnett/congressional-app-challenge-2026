#!/bin/bash
set -e

echo "🌐 Starting the Congressional App Challenge 2026 site..."

# Check if node_modules exists, if not, remind to run install.sh
if [ ! -d "node_modules" ]; then
  echo "❌ Error: node_modules not found. Please run ./install.sh first."
  exit 1
fi

# Run the Next.js development server
echo "🏃 Running 'npm run dev'..."
npm run dev
