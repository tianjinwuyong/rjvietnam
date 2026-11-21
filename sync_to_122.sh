#!/bin/bash
# Sync script - pushes from 155 to 122 every 30 minutes
# Run via cron on 122 with: */30 * * * * ssh wy@192.168.6.155 "bash -s" < /home/wy/sync_to_122.sh

SOURCE_DIR="/c/Users/tianj/Desktop/越南工厂瑞晶/smt-factory-system"
DEST_DIR="/home/wy/smt-factory-system"
DEST_HOST="192.168.6.122"
DEST_USER="wy"

# Using tar + SSH as rsync alternative
cd "$SOURCE_DIR" || exit 1
tar cf - --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='*.log' --exclude='.vite' . 2>/dev/null | ssh -o StrictHostKeyChecking=no "$DEST_USER@$DEST_HOST" "cd '$DEST_DIR' && tar xf - --strip-components=1"

echo "Sync completed at $(date)"
