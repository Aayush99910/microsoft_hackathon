"""Personalizer agent: the same intelligence, rewritten for each viewer.

Stage (e) of the brief: an analyst and a casual fan get genuinely different
experiences, in their own language, from the same facts.
"""

from dataclasses import dataclass

from agent_framework import Agent

from .base import AgentResult, run_agent

MODES = {
    "casual": "A casual fan. Tell the story, no jargon, no stats unless they are striking.",
    "analyst": "A data-hungry analyst. Lead with the numbers and the tactical meaning; precise and compact.",
    "tactics": "A coach. Focus on shape, pressing, space and decisions; what each team is doing and why.",
    "kids": "A child of about 8. Short, simple, fun words; explain any football idea in a friendly way.",
    "accessible": ("A blind or low-vision viewer using a screen reader or audio. Say clearly who has the ball, "
                   "which team, where on the pitch and what happened, in plain sentences. No emoji or symbols."),
}
LANGUAGES = {"en": "English", "es": "Spanish", "ne": "Nepali", "hi": "Hindi"}


@dataclass
class Profile:
    mode: str = "casual"
    language: str = "en"

    def is_default(self) -> bool:
        return self.mode == "casual" and self.language == "en"

    def label(self) -> str:
        return f"{self.mode} · {LANGUAGES.get(self.language, self.language)}"


INSTRUCTIONS = """You adapt live football commentary for one viewer.
You get JSON with: the viewer (who they are, which language), the commentary line, an optional
"why it matters" explanation, and the facts behind them.
Rewrite BOTH for this viewer, keeping every fact correct. Write BOTH entirely in the viewer's language
(only names and numbers stay as they are), even when the input is in another language.
Rules:
- Never add facts, names or numbers that are not in the input.
- Never translate player or team names: keep them exactly as written, in the Latin alphabet, even in Hindi or Nepali.
- Keep it short: the line at most 30 words, the explanation at most 40 words.
- Reply with JSON only: {"text": "...", "why": "..."} (use null for "why" if none was given)."""


class Personalizer:
    name = "personalizer"

    def __init__(self, client):
        self.agent = Agent(client, INSTRUCTIONS, name="personalizer") if client else None

    async def adapt(self, text: str, why: str | None, facts: dict, profile: Profile) -> AgentResult:
        payload = {
            "viewer": MODES.get(profile.mode, MODES["casual"]),
            "language": LANGUAGES.get(profile.language, "English"),
            "line": text,
            "why": why,
            "facts": facts,
        }
        return await run_agent(self.agent, payload, timeout=10)
