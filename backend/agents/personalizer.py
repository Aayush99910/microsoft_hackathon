"""Personalizer agent: the same intelligence, rewritten for each viewer.

Stage (e) of the brief: an analyst and a casual fan get genuinely different
experiences, in their own language, from the same facts.
"""

import re
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
    "homer": ("A one-eyed, passionate fan of the HOME team (named in home_team), like a club's own TV channel. "
              "Celebrate everything the home side does, groan at the opponents' good moments and blame luck or "
              "the referee when it goes wrong; their goals are the best you have ever seen, the other side's are "
              "a smash-and-grab. Biased in tone only: every fact stays exactly true, no insults or abuse."),
    "accessible": ("A blind or low-vision fan listening through a screen reader. In order: which team has the ball, "
                   "who, where on the pitch (use the shot area and angle if given), what happened, then the score. "
                   "Plain sentences that sound natural read aloud; no symbols, abbreviations or decimals."),
}
LANGUAGES = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese (Brazil)",
    "it": "Italian", "nl": "Dutch", "ar": "Arabic", "zh": "Chinese (Mandarin, simplified)", "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "tr": "Turkish", "pl": "Polish", "uk": "Ukrainian", "id": "Indonesian",
    "ms": "Malay", "vi": "Vietnamese", "th": "Thai", "hi": "Hindi", "bn": "Bengali", "ur": "Urdu",
    "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "ne": "Nepali", "sw": "Swahili", "fa": "Persian",
    "el": "Greek", "sv": "Swedish",
}


# Spanish punctuation and accents: the model now and then drifts into Spanish (seen with the Home fan
# mode) even when asked for English. Player names never contain these.
NOT_ENGLISH = re.compile(r"[¡¿áéíóúñ]")


@dataclass
class Profile:
    mode: str = "casual"
    language: str = "en"

    def is_default(self) -> bool:
        return self.mode == "casual" and self.language == "en"

    def label(self) -> str:
        """Which mode and language a line was written for, e.g. "casual · fr" (the browser compares these)."""
        return f"{self.mode} · {self.language}"


INSTRUCTIONS = """You adapt live football commentary for one viewer.
You get JSON with: the viewer (who they are, which language), the commentary line, its spoken on-air
version, an optional "why it matters" explanation, and the facts behind them.
Rewrite them for this viewer, keeping every fact correct. Write them entirely in the language named in
"language" (only names and numbers stay as they are), even when the input is in another language.
Rules:
- "language" is the only language you may write in. If it says English, every word is English.
- Never add facts, names or numbers that are not in the input (no locations, techniques or stats you were not given).
- The clubs are real but every player and every match is made up: never mention real players, managers,
  league positions, history or rivalries; use only what the input says.
- Only mention players and teams named in the input.
- Translate every word except names into the viewer's language, including football terms
  (no English words like "right foot" or "open play" inside text in another language).
- Match the numbers to the viewer: analysts and coaches get precise figures; casual fans, kids and
  audio viewers get at most one simple number per sentence, rounded and in words where possible.
  This applies to the explanation too.
- Never translate player or team names: keep them exactly as written, in the Latin alphabet, even in
  languages with another script (Hindi, Arabic, Chinese, Japanese, ...).
- Keep it short: the line at most 30 words, the explanation at most 40 words.
- "spoken" is what this viewer's commentator says on air, STRICTLY at most "spoken_max_words" words (count
  them; shorter is better, it is read aloud live and a long line makes the next moment wait): the action
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
                    spoken: str | None = None, spoken_max_words: int = 18, short: str | None = None,
                    home_team: str | None = None) -> AgentResult:
        payload = {
            "home_team": home_team,
            "spoken_max_words": spoken_max_words,
            "viewer": MODES.get(profile.mode, MODES["casual"]),
            "language": LANGUAGES.get(profile.language, "English"),
            "line": text,
            "spoken": spoken or text,
            "short": short or text,
            "why": why,
            "facts": facts,
        }
        result = await run_agent(self.agent, payload, timeout=10)
        if profile.language == "en" and result.text and NOT_ENGLISH.search(result.text):
            result = await run_agent(self.agent, payload, timeout=10)  # drifted into another language: once more
        return result
