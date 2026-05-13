#!/bin/sh
# Serve Pothi using the same launcher logic as the installed wrappers.
cd "$(dirname "$0")"
exec python3 ./pothi_launcher.py serve --port "${1:-8765}"
