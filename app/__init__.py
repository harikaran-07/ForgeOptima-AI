from pathlib import Path

# Extend package search path to point directly to backend/app
_backend_app_dir = Path(__file__).resolve().parent.parent / "backend" / "app"
__path__ = [str(_backend_app_dir)] + list(__path__)
