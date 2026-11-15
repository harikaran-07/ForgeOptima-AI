import os
from pathlib import Path
import sys
import uvicorn

# Ensure backend directory is in sys.path
_dir = Path(__file__).resolve().parent
if str(_dir) not in sys.path:
    sys.path.insert(0, str(_dir))

from app.main import app  # noqa: E402, F401

if __name__ == "__main__":
    port = int(os.getenv("PORT", 10000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
