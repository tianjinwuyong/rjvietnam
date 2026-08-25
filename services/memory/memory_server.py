#!/usr/bin/env python3
"""
memory_server.py — Persistent mem0 memory server for SMT Factory AI agents.

Exposes a lightweight JSON-over-HTTP API so the Node.js agents can
store, search, and recall memories without reloading the embedding
model on every call.

Usage:
    python memory_server.py                  # start server (port from config or 9876)
    python memory_server.py --port 9877      # override port
    python memory_server.py --config path    # custom config path

Endpoints:
    POST /store        { "messages": ..., "agent_id": ..., "metadata": {} }
    POST /search       { "query": ..., "agent_id": ..., "top_k": 10 }
    POST /search_all   { "query": ..., "agent_ids": [...], "top_k": 10 }
                       (agent_ids optional — omit to search ALL agents)
    POST /get_all      { "agent_id": ..., "top_k": 20 }
    GET  /health       → { "ok": true, "memories": N }
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from mem0 import Memory

# ── Config ─────────────────────────────────────────────────────────────
DEFAULT_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "memory_config.json")
DEFAULT_PORT = 9876


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    # Flatten server config out
    host = cfg.get("server", {}).get("host", "127.0.0.1")
    port = cfg.get("server", {}).get("port", DEFAULT_PORT)
    return cfg, host, port


def init_memory(cfg):
    """Create a mem0 Memory instance from config dict."""
    try:
        m = Memory.from_config(cfg)
        return m
    except Exception as e:
        print(f"[memory_server] Failed to init Memory: {e}", file=sys.stderr)
        raise


# ── HTTP Handler ───────────────────────────────────────────────────────


class MemoryHandler(BaseHTTPRequestHandler):
    """Single-instance handler — the memory object is set on the class."""

    memory: Memory = None  # set by server

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            try:
                results = self.memory.get_all(filters={"agent_id": "__probe__"})
                count = results.get("count", 0)
            except Exception:
                count = -1
            self._send_json({"ok": True, "status": "running", "memories_total": count})
        else:
            self._send_json({"error": "not_found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            body = self._read_body()
        except json.JSONDecodeError as e:
            self._send_json({"error": f"invalid_json: {e}"}, 400)
            return

        try:
            if parsed.path == "/store":
                result = self._handle_store(body)
            elif parsed.path == "/search":
                result = self._handle_search(body)
            elif parsed.path == "/search_all":
                result = self._handle_search_all(body)
            elif parsed.path == "/get_all":
                result = self._handle_get_all(body)
            elif parsed.path == "/delete":
                result = self._handle_delete(body)
            else:
                self._send_json({"error": f"unknown_endpoint: {parsed.path}"}, 404)
                return
            self._send_json(result)
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    def _handle_store(self, body):
        messages = body.get("messages")
        agent_id = body.get("agent_id")
        metadata = body.get("metadata", {})
        infer = body.get("infer", True)

        if not messages:
            return {"error": "messages is required"}
        if not agent_id:
            return {"error": "agent_id is required"}

        result = self.memory.add(
            messages,
            agent_id=agent_id,
            metadata=metadata,
            infer=infer,
        )
        return result

    def _handle_search(self, body):
        query = body.get("query")
        agent_id = body.get("agent_id")
        top_k = body.get("top_k", 20)
        threshold = body.get("threshold", 0.1)

        if not query:
            return {"error": "query is required"}
        if not agent_id:
            return {"error": "agent_id is required"}

        result = self.memory.search(
            query,
            filters={"agent_id": agent_id},
            top_k=top_k,
            threshold=threshold,
        )
        return result

    # Default agent_id used when none specified (browser UI uses this)
    DEFAULT_AGENT_ID = "factory_ui"

    def _handle_search_all(self, body):
        """Search across one, multiple, or all agents."""
        query = body.get("query")
        agent_ids = body.get("agent_ids")  # optional list, None = use default
        top_k = body.get("top_k", 20)
        threshold = body.get("threshold", 0.1)

        if not query:
            return {"error": "query is required"}

        if agent_ids:
            # Specific agents requested — mem0 accepts list for OR filter
            filters = {"agent_id": agent_ids}
        else:
            # Default: search the factory_ui agent (browser UI memories)
            filters = {"agent_id": self.DEFAULT_AGENT_ID}

        result = self.memory.search(
            query,
            filters=filters,
            top_k=top_k,
            threshold=threshold,
        )
        return result

    def _handle_get_all(self, body):
        agent_id = body.get("agent_id")
        top_k = body.get("top_k", 20)

        if not agent_id:
            return {"error": "agent_id is required"}

        result = self.memory.get_all(
            filters={"agent_id": agent_id},
            top_k=top_k,
        )
        return result

    def _handle_delete(self, body):
        memory_id = body.get("memory_id")
        if memory_id:
            self.memory.delete(memory_id)
            return {"ok": True, "deleted": memory_id}
        # Delete all for agent
        agent_id = body.get("agent_id")
        if agent_id:
            self.memory.delete_all(agent_id=agent_id)
            return {"ok": True, "deleted_all_for": agent_id}
        return {"error": "memory_id or agent_id required"}

    def log_message(self, format, *args):
        """Silence default HTTP server logs; use our own."""
        if args and "memory_server" in str(args[0]):
            print(f"[memory_server] {args[0]}")


def main():
    config_path = DEFAULT_CONFIG_PATH
    port = DEFAULT_PORT

    # Parse CLI args
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--config" and i + 1 < len(args):
            config_path = args[i + 1]
            i += 2
        elif args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        else:
            i += 1

    # Load config
    cfg, host, cfg_port = load_config(config_path)
    if port == DEFAULT_PORT:
        port = cfg_port  # use config file port unless overridden

    # Init memory
    print(f"[memory_server] Initialising mem0 Memory...")
    memory = init_memory(cfg)
    print(f"[memory_server] mem0 ready (v{getattr(memory, 'version', '?')})")

    # Start server
    MemoryHandler.memory = memory
    server = HTTPServer((host, port), MemoryHandler)
    print(f"[memory_server] Listening on http://{host}:{port}")
    print(f"[memory_server] Endpoints: POST /store, /search, /get_all, /delete  GET /health")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[memory_server] Shutting down...")
        server.shutdown()
        memory.close()
        print("[memory_server] Done.")


if __name__ == "__main__":
    main()
