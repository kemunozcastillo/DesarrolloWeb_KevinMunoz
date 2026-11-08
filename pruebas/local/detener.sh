#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f logs/pids ] && xargs kill < logs/pids 2>/dev/null; rm -f logs/pids; echo detenido
