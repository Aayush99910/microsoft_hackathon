"""Personalizer agent: the same intelligence, rewritten for each viewer.

Stage (e) of the brief: an analyst and a casual fan get genuinely different
experiences, in their own language, from the same facts.
"""

from dataclasses import dataclass

from agent_framework import Agent

from .base import AgentResult, run_agent

MODES = {
    "casual": ("A casual fan watching with friends. Story first, warm and lively, like a mate on the sofa. "
               "No statistics at all except the score."),
    "analyst": ("A data analyst. Lead with 2 or 3 precise numbers from the facts (chance quality as a %, "
                "pass accuracy, pressing rate, threat share) and say what they mean. Compact, like a stats caption."),
    "tactics": ("A coach on the touchline. Talk only about shape, space, pressing, build-up and decisions: "
                "what the team did, what worked, what the other side must change. Avoid listing numbers."),
    "kids": ("A child of about 8. Very short sentences (at most 12 words each), excited and friendly, "
             "no numbers except the score. The explanation must be ONE short sentence a child understands."),
    "accessible": ("A blind or low-vision fan listening through a screen reader. In order: which team has the ball, "
                   "who, where on the pitch (use the shot area and angle if given), what happened, then the score. "
                   "Plain sentences that sound natural read aloud; no symbols, abbreviations or decimals."),
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
You get JSON with: the viewer (who they are, which language), the commentary line, its spoken on-air
version, an optional "why it matters" explanation, and the facts behind them.
Rewrite them for this viewer, keeping every fact correct. Write them entirely in the viewer's language
(only names and numbers stay as they are), even when the input is in another language.
Rules:
- Never add facts, names or numbers that are not in the input (no locations, techniques or stats you were not given).
- Only mention players and teams named in the input.
- Translate every word except names into the viewer's language, including football terms
  (no English words like "right foot" or "open play" inside Hindi, Nepali or Spanish text).
- Match the numbers to the viewer: analysts and coaches get precise figures; casual fans, kids and
  audio viewers get at most one simple number per sentence, rounded and in words where possible.
  This applies to the explanation too.
- Never translate player or team names: keep them exactly as written, in the Latin alphabet, even in Hindi or Nepali.
- Keep it short: the line at most 30 words, the explanation at most 40 words.
- "spoken" is what this viewer's commentator says on air, at most "spoken_max_words" words: the action
  first in short bursts, then (if there is room) why it matters, in the viewer's language and style
  (an analyst may hear one or two numbers; kids hear simple excited words; described says who, where, what).
- "short" is the line in at most 12 words, in the viewer's language and style.
- Reply with JSON only: {"text": "...", "short": "...", "why": "...", "spoken": "..."}
  (null for "why" if none was given)."""


class Personalizer:
    name = "personalizer"

    def __init__(self, client):
        self.agent = Agent(client, INSTRUCTIONS, name="personalizer") if client else None

    async def adapt(self, text: str, why: str | None, facts: dict, profile: Profile,
                    spoken: str | None = None, spoken_max_words: int = 18, short: str | None = None) -> AgentResult:
        payload = {
            "spoken_max_words": spoken_max_words,
            "viewer": MODES.get(profile.mode, MODES["casual"]),
            "language": LANGUAGES.get(profile.language, "English"),
            "line": text,
            "spoken": spoken or text,
            "short": short or text,
            "why": why,
            "facts": facts,
        }
        return await run_agent(self.agent, payload, timeout=10)
