"""Match Brain API.

Run from backend/:  uvicorn app.main:app --reload --port 8000
"""

import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# backend/.env, regardless of the directory uvicorn is started from
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agents.base import parse_json  # noqa: E402
from agents.llm import make_client  # noqa: E402  (needs the .env values above)
from agents.personalizer import LANGUAGES, MODES, Profile  # noqa: E402
from agents.pipeline import Agents  # noqa: E402
from generator.match_sim import MatchSimulator, ScriptedGoal  # noqa: E402
from generator.teams import CLUBS, matchday  # noqa: E402

from .speech import INTENSITIES, VOICES, Speech  # noqa: E402
from .stream import PROFILES, match_stream, matchday_stream  # noqa: E402

app = FastAPI(title="Match Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

client = make_client()
agents = Agents.from_client(client)
speech = Speech()


class ProfileIn(BaseModel):
    mode: str = "casual"
    language: str = "en"


class RetellIn(ProfileIn):
    text: str = Field(min_length=1, max_length=600)  # the Narrator's original line
    why: str | None = Field(default=None, max_length=800)  # the Explainer's original explanation
    spoken: str | None = Field(default=None, max_length=600)  # the Narrator's original on-air version
    spoken_max_words: int = Field(default=18, ge=5, le=40)
    short: str | None = Field(default=None, max_length=300)  # the Narrator's original brief version
    home_team: str | None = Field(default=None, max_length=60)  # for the Home fan mode
    facts: dict = {}


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
        "speech": speech.available,
    }


@app.get("/api/options")
def options():
    """Viewer modes and languages the Personalizer supports."""
    return {"modes": list(MODES), "languages": LANGUAGES}


def check_clubs(home: str, away: str) -> None:
    if home not in CLUBS or away not in CLUBS or home == away:
        raise HTTPException(400, f"home and away must be two different clubs of {list(CLUBS)}")


def fixture_seed(day: int, game: int) -> int:
    return day * 10 + game


@app.get("/api/match/info")
def match_info(seed: int = 7, home: str = "arsenal", away: str = "chelsea"):
    """Teams and squads, so the page can show the line-ups before kick-off."""
    check_clubs(home, away)
    return MatchSimulator(seed, home=home, away=away).info.model_dump()


@app.get("/api/matchday")
def get_matchday(day: int = Query(1, ge=0, le=100_000)):
    """A matchday's fixtures (all kick off together): the seed and clubs that identify each game."""
    return {"day": day, "fixtures": [
        {"game": i, "seed": fixture_seed(day, i), "info": MatchSimulator(fixture_seed(day, i), home=h, away=a).info.model_dump()}
        for i, (h, a) in enumerate(matchday(day))
    ]}


@app.get("/api/matchday/stream")
async def stream_matchday(day: int = Query(1, ge=0, le=100_000), speed: float = Query(20, ge=1, le=600),
                         from_t: float = Query(0, ge=0, le=7000, description="resume this many seconds of play in")):
    """Live scores of every game on the matchday (rule-based, no agents)."""
    fixtures = [(fixture_seed(day, i), h, a) for i, (h, a) in enumerate(matchday(day))]
    return StreamingResponse(matchday_stream(fixtures, speed, from_t), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/match/stream")
async def stream(
    seed: int = 7,
    speed: float = Query(20, ge=1, le=600, description="playback speed, x real time"),
    goal: list[str] = Query(default=[], description="scripted goals, e.g. 23:home or 78:away:30"),
    session: str = Query(default_factory=lambda: uuid.uuid4().hex, max_length=64),
    mode: str = "casual",
    language: str = "en",
    home: str = "arsenal",
    away: str = "chelsea",
    from_t: float = Query(0, ge=0, le=7000, description="join a match this many seconds of play in"),
):
    check_clubs(home, away)
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
        match_stream(seed, speed, script, agents, session, check_profile(mode, language), home, away, from_t),
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


@app.post("/api/personalize")
async def retell(body: RetellIn):
    """Re-tell one moment for a viewer mode and language (instant mode switches and Compare)."""
    profile = check_profile(body.mode, body.language)
    spoken, short = body.spoken or body.text, body.short or body.text
    if profile.is_default():
        return {"text": body.text, "why": body.why, "spoken": spoken, "short": short, "source": "original", "ms": 0}
    result = await agents.personalizer.adapt(body.text, body.why, body.facts, profile, spoken,
                                             body.spoken_max_words, short, body.home_team)
    adapted = parse_json(result.text)
    if not adapted or not adapted.get("text"):
        return {"text": body.text, "why": body.why, "spoken": spoken, "short": short, "source": "fallback", "ms": result.ms}
    return {"text": adapted["text"], "why": adapted.get("why") or body.why,
            "spoken": adapted.get("spoken") or adapted["text"], "short": adapted.get("short") or short,
            "source": "agent", "ms": result.ms}


@app.get("/api/speech")
async def speak(text: str = Query(min_length=1, max_length=600), language: str = "en", intensity: str = "calm",
                mode: str = "casual"):
    """A commentary line read aloud by an Azure AI Speech neural voice (MP3): the mode picks the
    commentator, the intensity (calm / lively / excited) how excited they sound."""
    if language not in VOICES or intensity not in INTENSITIES or mode not in MODES:
        raise HTTPException(400, f"language one of {list(VOICES)}, intensity one of {list(INTENSITIES)}, "
                                 f"mode one of {list(MODES)}")
    if not speech.available:
        raise HTTPException(503, "speech is not configured")
    try:
        audio = await speech.synthesize(text, language, intensity, mode)
    except Exception:
        raise HTTPException(502, "speech service unavailable") from None
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=3600"})


# In the container, the built React app is served from here too (one URL, no CORS).
# Mounted last so the /api routes above take priority.
if (static_dir := os.getenv("STATIC_DIR")) and Path(static_dir).is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")
