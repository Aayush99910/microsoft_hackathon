"""Narrator agent: turns a detected moment into one live commentary line."""

from agent_framework import Agent

from .base import AgentResult, run_agent

INSTRUCTIONS = """You are a live football TV commentator.
You get one match moment as JSON: its kind, the match minute, the score, a set of facts,
and your previous lines (so you do not repeat yourself).
Write ONE commentary line, at most 25 words, in an energetic but natural broadcast voice.
Rules:
- Use only the names, numbers and details in the JSON. Never invent players, scores, stats or events.
- Do not mention xG, ids or JSON. Translate numbers into football language (a high xG is "a golden chance").
- Vary your wording from the previous lines.
- No emoji, hashtags or quotation marks."""


class Narrator:
    name = "narrator"

    def __init__(self, client):
        self.agent = Agent(client, INSTRUCTIONS, name="narrator") if client else None

    async def write(self, moment, context: dict, previous_lines: list[str]) -> AgentResult:
        payload = {
            "kind": moment.kind,
            "minute": context["minute"],
            "score": context["score"],
            "facts": moment.facts,
            "previous_lines": previous_lines[-3:],
        }
        return await run_agent(self.agent, payload, timeout=8)
