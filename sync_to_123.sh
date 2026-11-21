#!/bin/bash
# Sync script - pushes from 155 to 123
# Run: bash sync_to_123.sh

SOURCE_DIR="/c/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system"
DEST_DIR="/home/wy/smt-factory-system"
DEST_HOST="192.168.6.123"
DEST_USER="wy"

# Using tar + SSH as rsync alternative
cd "$SOURCE_DIR" || exit 1
tar cf - --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='*.log' --exclude='.vite' --exclude='__pycache__' --exclude='.codex-logs' --exclude='.codex-runtime' --exclude='.codex-temp' --exclude='.omo' --exclude='.skills' --exclude='.runtime' --exclude='backups' --exclude='test-results' --exclude='runtime-logs' --exclude='milestones' --exclude='operations' --exclude='references' --exclude='docs' --exclude='deploy-aoi' --exclude='qa-station-agent' --exclude='integrations' --exclude='smt-factory-system' --exclude='.codex-artifact-runtime' --exclude='services/memory/memory_config.json' . 2>/dev/null | ssh -o StrictHostKeyChecking=no "$DEST_USER@$DEST_HOST" "cd '$DEST_DIR' && tar xf - --strip-components=1"

echo "Sync completed at $(date)"