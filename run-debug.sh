#!/bin/bash
# run-debug.sh - Run the app with verbose logging to debug.txt

# Exit on any error
set -e

DEBUG_FILE="debug.txt"
echo "--- Debug Session Started: $(date) ---" > "$DEBUG_FILE"

echo "🌐 Starting the Congressional App Challenge 2026 site in DEBUG mode..."
echo "📝 All output will be mirrored to $DEBUG_FILE"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "❌ Error: node_modules not found. Please run ./install.sh first." | tee -a "$DEBUG_FILE"
  exit 1
fi

# We use 'stdbuf' to disable buffering for both stdout and stderr
# so that logs appear in the file in real-time.
# 'tee -a' appends stdout to the file while still printing to terminal.
# '2>&1' redirects stderr to stdout.

echo "🏃 Running 'npm run dev' with verbose logging..." | tee -a "$DEBUG_FILE"

# Run npm run dev and capture all output (stdout and stderr) to debug.txt
# Using a subshell to manage the redirection
(
  npm run dev 2>&1 | tee -a "$DEBUG_FILE"
)

echo "--- Debug Session Ended: $(date) ---" >> "$DEBUG_FILE"
