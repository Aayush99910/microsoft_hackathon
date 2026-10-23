"""Match Brain API.

Run from backend/:  uvicorn app.main:app --reload --port 8000
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# backend/.env, regardless of the directory uvicorn is started from
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="Match Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "model": os.getenv("FOUNDRY_MODEL_DEPLOYMENT")}
