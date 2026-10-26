"""Spoken commentary with Azure AI Speech (neural text-to-speech), through the Foundry resource.

Same authentication as the agents: the API key locally, Microsoft Entra ID (managed identity) on Azure.
Results are cached, so replaying a moment or several viewers hearing the same line costs nothing extra.
"""

import os
from collections import OrderedDict
from xml.sax.saxutils import escape

import httpx

# One commentator voice per language
VOICES = {
    "en": ("en-GB", "en-GB-RyanNeural"),
    "es": ("es-ES", "es-ES-AlvaroNeural"),
    "hi": ("hi-IN", "hi-IN-MadhurNeural"),
    "ne": ("ne-NP", "ne-NP-SagarNeural"),
}
MAX_CHARS = 600
CACHE_SIZE = 200


class Speech:
    def __init__(self):
        endpoint = os.getenv("FOUNDRY_RESOURCE_ENDPOINT", "").rstrip("/")
        self.url = f"{endpoint}/tts/cognitiveservices/v1" if endpoint else None
        self.key = os.getenv("FOUNDRY_API_KEY")
        self.credential = None
        if not self.key and os.getenv("FOUNDRY_AUTH") == "identity":
            from azure.identity.aio import DefaultAzureCredential

            self.credential = DefaultAzureCredential()
        self.cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()

    @property
    def available(self) -> bool:
        return bool(self.url and (self.key or self.credential))

    async def synthesize(self, text: str, language: str) -> bytes:
        text = text.strip()[:MAX_CHARS]
        cached = self.cache.get((language, text))
        if cached:
            self.cache.move_to_end((language, text))
            return cached

        locale, voice = VOICES.get(language, VOICES["en"])
        ssml = (f"<speak version='1.0' xml:lang='{locale}'><voice name='{voice}'>"
                f"<prosody rate='+8%'>{escape(text)}</prosody></voice></speak>")
        headers = {
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "match-brain",
        }
        if self.key:
            headers["Ocp-Apim-Subscription-Key"] = self.key
        else:
            token = await self.credential.get_token("https://cognitiveservices.azure.com/.default")
            headers["Authorization"] = f"Bearer {token.token}"

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(self.url, content=ssml.encode(), headers=headers)
        response.raise_for_status()

        self.cache[(language, text)] = response.content
        if len(self.cache) > CACHE_SIZE:
            self.cache.popitem(last=False)
        return response.content
