#!/bin/bash
cd "$(dirname "$0")"
# Load env from .env
set -a && source .env && set +a
node server.js
