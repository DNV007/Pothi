#!/bin/sh
# Serve Pothi over HTTP at http://127.0.0.1:8765 — needed because
# browsers refuse ES module imports from file://.
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Pothi → http://127.0.0.1:$PORT/"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
