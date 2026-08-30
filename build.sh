#!/bin/sh
set -e
cd "$(dirname "$0")"
mkdir -p dist
npx --yes esbuild entry.js --bundle --format=esm --minify --loader:.css=text --outfile=dist/engine.min.js
cat > dist/index.html << 'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Latis engine</title>
    <style>
      body { margin: 2rem; font-family: system-ui, sans-serif; color: #102028; background: #f4f7f8; }
      a { color: #0a5a6a; }
    </style>
  </head>
  <body>
    <h1>Latis engine</h1>
    <p>Public ES module for Latis titles. Not a game.</p>
    <p><a href="./engine.min.js">engine.min.js</a></p>
  </body>
</html>
HTML
cat > dist/_headers << 'HDR'
/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  Access-Control-Allow-Headers: *

/*.js
  Content-Type: application/javascript; charset=utf-8
  Cache-Control: public, max-age=3600

/*.css
  Content-Type: text/css; charset=utf-8
HDR
