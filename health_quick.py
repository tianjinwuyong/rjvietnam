import json, shutil, sys, urllib.request
from pathlib import Path

CONFIG_PATH = Path(r"C:\Users\tianj\AppData\Local\hermes\config.yaml")
OLLAMA_BASE = "http://localhost:11434"

# Disk
try:
    usage = shutil.disk_usage("C:/")
    print(f"DISK free: {usage.free/(1024**3):.1f} GB / {usage.total/(1024**3):.1f} GB")
except Exception as e:
    print(f"DISK ERROR: {e}")

# Ollama
try:
    req = urllib.request.Request(f"{OLLAMA_BASE}/api/tags", method="GET")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    models = data.get("models") or []
    print(f"OLLAMA models: {len(models)}")
    for m in models:
        print(f"  - {m.get('name','?')}")
except Exception as e:
    print(f"OLLAMA ERROR: {e}")

# Config
print(f"CONFIG exists: {CONFIG_PATH.exists()}")
if CONFIG_PATH.exists():
    text = CONFIG_PATH.read_text(encoding="utf-8")
    print(f"ollama-local in config: {'ollama-local' in text}")
