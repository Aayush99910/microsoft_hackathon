"""Recap agent: half-time and full-time summaries of the story so far."""

from agent_framework import Agent

from .base import AgentResult, run_agent

INSTRUCTIONS = """You write the half-time or full-time recap for a football broadcast.
You get JSON with the score, team stats, the key moments in order and the standout players.
Write 3 sentences, at most 70 words: the result or state of play, how the game was won or is
being decided (control, pressing, chances), and the standout performer.
Use only the facts given; never invent events, players or numbers. No emoji, no lists.
The clubs are real but every player and match is made up: never mention real players, managers,
league positions, history or rivalries."""


class Recap:
    name = "recap"

    def __init__(self, client):
        self.agent = Agent(client, INSTRUCTIONS, name="recap") if client else None

    async def write(self, moment, context: dict, story: dict) -> AgentResult:
        payload = {
            "when": "half-time" if moment.kind == "half_time" else "full-time",
            "score": context["score"],
            "team_stats": context["team_stats"],
            "key_moments": story["key_moments"],
            "standout_players": story["standout_players"],
        }
        return await run_agent(self.agent, payload, timeout=15)
