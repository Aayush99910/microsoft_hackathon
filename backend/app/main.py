"""Match Brain API.

Run from backend/:  uvicorn app.main:app --reload --port 8000
"""

import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# backend/.env, regardless of the directory uvicorn is started from
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.llm import make_client  # noqa: E402  (needs the .env values above)
from agents.personalizer import LANGUAGES, MODES, Profile  # noqa: E402
from agents.pipeline import Agents  # noqa: E402
from generator.match_sim import MatchSimulator, ScriptedGoal  # noqa: E402

from .stream import PROFILES, match_stream  # noqa: E402

app = FastAPI(title="Match Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

client = make_client()
agents = Agents.from_client(client)


class ProfileIn(BaseModel):
    mode: str = "casual"
    language: str = "en"


def check_profile(mode: str, language: str) -> Profile:
    if mode not in MODES or language not in LANGUAGES:
        raise HTTPException(400, f"mode must be one of {list(MODES)}, language one of {list(LANGUAGES)}")
    return Profile(mode, language)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model": os.getenv("FOUNDRY_MODEL_DEPLOYMENT"),
        "agents": "foundry" if client else "fallback (no model configured)",
    }


@app.get("/api/options")
def options():
    """Viewer modes and languages the Personalizer supports."""
    return {"modes": list(MODES), "languages": LANGUAGES}


@app.get("/api/match/info")
def match_info(seed: int = 7):
    """Teams and squads, so the page can show the line-ups before kick-off."""
    return MatchSimulator(seed).info.model_dump()


@app.get("/api/match/stream")
async def stream(
    seed: int = 7,
    speed: float = Query(20, ge=1, le=600, description="playback speed, x real time"),
    goal: list[str] = Query(default=[], description="scripted goals, e.g. 23:home or 78:away:30"),
    session: str = Query(default_factory=lambda: uuid.uuid4().hex, max_length=64),
    mode: str = "casual",
    language: str = "en",
):
    try:
        script = []
        for spec in goal:
            minute, side, *scorer = spec.split(":")
            if side not in ("home", "away"):
                raise ValueError(side)
            script.append(ScriptedGoal(int(minute), side, int(scorer[0]) if scorer else None))
    except ValueError:
        raise HTTPException(400, "goal must look like 23:home or 78:away:30") from None

    return StreamingResponse(
        match_stream(seed, speed, script, agents, session, check_profile(mode, language)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.put("/api/session/{session}/profile")
def set_profile(session: str, body: ProfileIn):
    """Switch viewer mode or language mid-match; applies from the next key moment."""
    if session not in PROFILES:
        raise HTTPException(404, "no live match for this session")
    PROFILES[session] = check_profile(body.mode, body.language)
    return {"session": session, "profile": PROFILES[session].label()}
