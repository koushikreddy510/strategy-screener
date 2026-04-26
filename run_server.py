#!/usr/bin/env python3
"""
Start the FastAPI app. Run from the repository root (strategy-screener/), not from backend/:

    python run_server.py

Or: uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
(with cwd = repo root, or PYTHONPATH set to repo root).
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
