import os
import sys
from pathlib import Path
import uvicorn

# Add backend directory to sys.path so 'app' is importable from root
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402, F401

if __name__ == "__main__":
    port = int(os.getenv("PORT", 10000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)

