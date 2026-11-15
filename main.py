import sys
from pathlib import Path

# Add backend directory to sys.path so 'app' is importable from root
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402, F401
