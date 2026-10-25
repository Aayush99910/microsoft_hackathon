"""Connection to the Foundry-hosted model, shared by all agents.

Two ways to authenticate, picked from environment variables:
- FOUNDRY_API_KEY set: key auth against the resource's OpenAI endpoint (local development)
- FOUNDRY_AUTH=identity: Microsoft Entra ID (managed identity on Azure, no key at all)
With neither, agents return None and callers fall back to template text.
"""

import os

from agent_framework.foundry import FoundryChatClient
from agent_framework.openai import OpenAIChatClient

# Fast, cheap replies for live use: little hidden reasoning, short answers
FAST_OPTIONS = {"reasoning": {"effort": "minimal"}, "verbosity": "low"}


def make_client() -> OpenAIChatClient | FoundryChatClient | None:
    model = os.getenv("FOUNDRY_MODEL_DEPLOYMENT", "gpt-5-mini")
    if os.getenv("FOUNDRY_API_KEY"):
        return OpenAIChatClient(
            model=model,
            api_key=os.environ["FOUNDRY_API_KEY"],
            base_url=os.environ["FOUNDRY_OPENAI_ENDPOINT"],
        )
    if os.getenv("FOUNDRY_AUTH") == "identity":
        from azure.identity.aio import DefaultAzureCredential

        return FoundryChatClient(
            project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
            model=model,
            credential=DefaultAzureCredential(),
        )
    return None
