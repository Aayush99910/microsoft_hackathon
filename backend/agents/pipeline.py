"""Multi-agent pipeline for one key moment, built as a Microsoft Agent Framework workflow.

    Dispatcher ─┬─► Writer (Narrator, or Recap at half/full time) ─┐
                └─► Explainer ("why it matters", key moments only)  ─┴─► Personalizer ─► output

- Writer and Explainer run in parallel (fan-out), the Personalizer waits for both (fan-in).
- Shared state travels in the Job: match context, evidence summary, story so far, viewer profile.
- Every agent has a fallback (template headline, rule-based "why", unpersonalized text),
  so a slow or failing model degrades the output instead of stopping the broadcast.
- Each step records which agent ran, how long it took and whether it fell back: the UI shows this trace.
"""

from dataclasses import dataclass

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler
from typing_extensions import Never

from engine.moments import Moment

from .base import parse_json
from .explainer import EXPLAIN_KINDS, Explainer, fallback_why
from .narrator import Narrator
from .personalizer import Personalizer, Profile
from .recap import Recap

RECAP_KINDS = {"half_time", "full_time"}


@dataclass
class Job:
    moment: Moment
    context: dict  # minute, score, recent state in words, team stats
    evidence: dict  # summary of the events the moment is based on
    story: dict  # key moments so far and standout players (for recaps)
    previous_lines: list[str]
    profile: Profile


@dataclass
class Draft:
    role: str  # "writer" or "explainer"
    agent: str
    text: str | None
    ms: int
    source: str  # "agent", "fallback" or "skipped"
    error: str | None = None
    spoken: str | None = None  # the writer's on-air version (short bursts), read by the voice
    short: str | None = None  # the writer's brief version (about 12 words)


@dataclass
class Agents:
    narrator: Narrator
    explainer: Explainer
    recap: Recap
    personalizer: Personalizer

    @classmethod
    def from_client(cls, client) -> "Agents":
        return cls(Narrator(client), Explainer(client), Recap(client), Personalizer(client))


class Dispatcher(Executor):
    @handler
    async def dispatch(self, job: Job, ctx: WorkflowContext[Job]) -> None:
        await ctx.send_message(job)  # fan-out to writer and explainer


class Writer(Executor):
    def __init__(self, agents: Agents):
        super().__init__(id="writer")
        self.agents = agents

    @handler
    async def write(self, job: Job, ctx: WorkflowContext[Draft]) -> None:
        if job.moment.kind in RECAP_KINDS:
            result = await self.agents.recap.write(job.moment, job.context, job.story)
            agent, fallback = "recap", fallback_recap(job)
            text, spoken = result.text, result.text  # a recap is already written to be read aloud
            short = None
        else:
            result = await self.agents.narrator.write(job.moment, job.context, job.previous_lines)
            agent, fallback = "narrator", job.moment.headline
            reply = parse_json(result.text) or {}
            text = reply.get("line") or (result.text if result.text and not result.text.lstrip().startswith("{") else None)
            spoken = reply.get("spoken") or text
            short = reply.get("short")
        source = "agent" if text else "fallback"
        await ctx.send_message(Draft("writer", agent, text or fallback, result.ms, source, result.error,
                                     spoken=spoken or text or fallback, short=short or text or fallback))


class ExplainerStep(Executor):
    def __init__(self, agents: Agents):
        super().__init__(id="explainer")
        self.agents = agents

    @handler
    async def explain(self, job: Job, ctx: WorkflowContext[Draft]) -> None:
        if job.moment.kind not in EXPLAIN_KINDS:
            await ctx.send_message(Draft("explainer", "explainer", None, 0, "skipped"))
            return
        result = await self.agents.explainer.explain(job.moment, job.context, job.evidence)
        if result.text:
            await ctx.send_message(Draft("explainer", "explainer", result.text, result.ms, "agent"))
        else:
            why = fallback_why(job.moment, job.context)
            await ctx.send_message(Draft("explainer", "explainer", why, result.ms, "fallback", result.error))


class PersonalizerStep(Executor):
    def __init__(self, agents: Agents, job: Job):
        super().__init__(id="personalizer")
        self.agents = agents
        self.job = job

    @handler
    async def personalize(self, drafts: list[Draft], ctx: WorkflowContext[Never, dict]) -> None:
        writer = next(d for d in drafts if d.role == "writer")
        explainer = next(d for d in drafts if d.role == "explainer")
        text, why, spoken, short = writer.text, explainer.text, writer.spoken, writer.short
        profile = self.job.profile
        steps = [step(writer), step(explainer)]

        if profile.is_default():
            steps.append({"agent": "personalizer", "ms": 0, "source": "skipped"})
        else:
            result = await self.agents.personalizer.adapt(text, why, self.job.moment.facts, profile, spoken,
                                                          self.job.context.get("spoken_max_words", 18), short,
                                                          self.job.context.get("home_team"))
            adapted = parse_json(result.text)
            if adapted and adapted.get("text"):
                text, why = adapted["text"], adapted.get("why") or why
                spoken = adapted.get("spoken") or text
                if len(spoken.split()) > self.job.context.get("spoken_max_words", 18) + 6 and adapted.get("short"):
                    spoken = adapted["short"]  # too long to read out live: the brief version instead
                short = adapted.get("short") or short
                steps.append({"agent": "personalizer", "ms": result.ms, "source": "agent"})
            else:
                steps.append({"agent": "personalizer", "ms": result.ms, "source": "fallback",
                              "error": result.error or "unreadable reply"})
                profile = Profile()  # it is still the original line: say so, so the browser re-tells it

        await ctx.yield_output({
            "moment_id": self.job.moment.id,
            "kind": self.job.moment.kind,  # lets the browser prepare the right voice before the moment shows
            "importance": self.job.moment.importance,
            "text": text,
            "base_text": writer.text,  # before personalizing; the Narrator's memory of what it said
            "base_why": explainer.text,  # before personalizing; lets the viewer re-tell it in another mode
            "spoken": spoken,  # the on-air version the voice reads
            "base_spoken": writer.spoken,
            "short": short,  # brief version (about 12 words) for viewers who choose Brief
            "base_short": writer.short,
            "why": why,
            "profile": profile.label(),
            "source": writer.source,  # whether the main line came from an agent
            # writer and explainer run in parallel, so the wait is the slower of the two plus personalizing
            "ms": max(writer.ms, explainer.ms) + steps[2]["ms"],
            "steps": steps,
        })


def step(d: Draft) -> dict:
    s = {"agent": d.agent, "ms": d.ms, "source": d.source}
    if d.error:
        s["error"] = d.error
    return s


def fallback_recap(job: Job) -> str:
    c = job.context
    label = "Half-time" if job.moment.kind == "half_time" else "Full-time"
    teams = c["team_stats"]
    home, away = list(teams)
    return (f"{label}: {home} {c['score']} {away}. Possession {teams[home]['possession_pct']}%-"
            f"{teams[away]['possession_pct']}%, shots {teams[home]['shots']}-{teams[away]['shots']}.")


async def run_pipeline(agents: Agents, job: Job) -> dict:
    """Build the workflow for this moment and run it (a fresh graph per run, so runs can overlap)."""
    dispatcher = Dispatcher(id="dispatcher")
    writer, explainer = Writer(agents), ExplainerStep(agents)
    personalizer = PersonalizerStep(agents, job)
    workflow = (
        WorkflowBuilder(start_executor=dispatcher, name="moment-pipeline")
        .add_fan_out_edges(dispatcher, [writer, explainer])
        .add_fan_in_edges([writer, explainer], personalizer)
        .build()
    )
    result = await workflow.run(job)
    return result.get_outputs()[0]
