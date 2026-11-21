#!/bin/bash
# SMT Factory System - Start All Services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/4] Starting PostgreSQL..."
docker start smt-postgres 2>/dev/null || docker run -d --name smt-postgres -p 5432:5432 \
  -e POSTGRES_DB=smt_factory -e POSTGRES_USER=smt_factory -e POSTGRES_PASSWORD=smt_factory \
  -v smt_factory_postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine --restart unless-stopped

echo "[2/4] Starting API..."
docker start smt-api 2>/dev/null

echo "[3/4] Starting Web..."
docker start smt-web 2>/dev/null

echo "[4/4] Starting monitoring..."
docker start smt-metabase smt-grafana smt-prometheus smt-nodered 2>/dev/null

sleep 3
echo ""
echo "=== Service Status ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep smt-
echo ""
echo "URLs:"
echo "  Web:      http://$(hostname -I | awk '{print $1}'):5178"
echo "  API:      http://$(hostname -I | awk '{print $1}'):8080"
echo "  Metabase: http://$(hostname -I | awk '{print $1}'):3000"
echo "  Grafana:  http://$(hostname -I | awk '{print $1}'):3001"
echo "  Node-RED: http://$(hostname -I | awk '{print $1}'):1880"
echo "  Prometheus: http://$(hostname -I | awk '{print $1}'):9090"
