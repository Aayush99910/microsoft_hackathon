"""Explainer agent: says WHY a moment matters, not just that it happened.

It gets the moment, the recent state of the game (who is pressing, who is in control)
and a summary of the evidence events, and must ground its reasoning in those numbers.
"""

from agent_framework import Agent

from .base import AgentResult, run_agent

# Moments worth an explanation; the rest are self-explanatory
EXPLAIN_KINDS = {"goal", "big_chance", "momentum_shift", "pressing", "chaos", "milestone"}

INSTRUCTIONS = """You are a football analyst on a live broadcast. Explain WHY this moment matters.
You get JSON with the moment (kind, facts), the score and minute, the recent state of the game
(last 5 minutes: possession share, pass accuracy, pressing rate, turnovers, which team created the threat)
and a summary of the events the moment is based on.
Write 1 or 2 sentences, at most 35 words, for a general audience, explaining the significance using ideas such as:
control vs chaos, pressing and pressure, rhythm and tempo, game state (leading, chasing, level), momentum.
Rules:
- Ground every claim in the numbers given, but quote at most 2 numbers, rounded (say "nine in ten", not "92%",
  only when it helps). Never invent stats, players or events.
- Say what it changes or reveals about the match, not just what happened.
- Plain words, no jargon like xG; no emoji."""


class Explainer:
    name = "explainer"

    def __init__(self, client):
        self.agent = Agent(client, INSTRUCTIONS, name="explainer") if client else None

    async def explain(self, moment, context: dict, evidence: dict) -> AgentResult:
        payload = {
            "kind": moment.kind,
            "minute": context["minute"],
            "score": context["score"],
            "facts": moment.facts,
            "recent_state": context["recent"],
            "evidence": evidence,
        }
        return await run_agent(self.agent, payload, timeout=10)


def fallback_why(moment, context: dict) -> str | None:
    """Rule-based explanation when the agent is unavailable."""
    f = moment.facts
    if moment.kind == "goal":
        return f"{f.get('team')} make it {f.get('score')}; the other side now has to chase the game."
    if moment.kind == "big_chance":
        return f"A chance like this usually goes in about {round(f.get('xg', 0) * 100)}% of the time; a big let-off."
    if moment.kind == "momentum_shift":
        return f"{f.get('team_on_top')} created {f.get('share_of_recent_threat_pct')}% of the threat in the last five minutes."
    if moment.kind == "pressing":
        return f"{f.get('team')} are pressing {f.get('pressures_per_min')} times a minute, rushing {f.get('opponent')} on the ball."
    if moment.kind == "chaos":
        return f"The ball is changing hands {f.get('turnovers_per_min')} times a minute: nobody is in control."
    return None
