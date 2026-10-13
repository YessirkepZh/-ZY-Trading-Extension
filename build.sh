#!/bin/bash
set -e
echo "Building ZY Trading Extension..."

npx tsc

echo "Copying static assets..."
cp manifest.json dist/manifest.json
cp popup.html dist/popup.html
mkdir -p dist/styles dist/icons
cp styles/popup.css dist/styles/popup.css
cp icons/*.png dist/icons/

if [ -n "$API_URL" ]; then
  echo "Using API_URL=$API_URL"
  sed -i "s#https://zy-trading-backend-production.up.railway.app#$API_URL#" dist/config.js
fi

echo "Done! Load /dist folder in Chrome."
