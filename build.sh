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

echo "Done! Load /dist folder in Chrome."
