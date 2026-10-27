"""Spoken commentary with Azure AI Speech (neural text-to-speech), through the Foundry resource.

Each language has a commentator voice, and each line is read at an intensity that fits the
moment: calm for build-up, lively for pressure and chances, excited for goals. Big moments are
spoken faster, and use the voice's excited style where it has one.

Same authentication as the agents: the API key locally, Microsoft Entra ID (managed identity) on Azure.
Results are cached, so replays and repeated lines cost nothing extra.
"""

import os
from collections import OrderedDict
from dataclasses import dataclass
from xml.sax.saxutils import escape

import httpx


@dataclass(frozen=True)
class Voice:
    locale: str
    name: str
    styles: dict[str, str]  # intensity -> speaking style ("" = the voice's default delivery)


# Microsoft's MAI voices: natural, expressive, and fast enough for live use (under 1 s per line;
# the HD voices took about 4 s, which made commentary lag behind the match).
VOICES = {
    "en": Voice("en-US", "en-US-Ethan:MAI-Voice-2.1-Flash", {"lively": "happy", "excited": "excited"}),
    "es": Voice("es-MX", "es-MX-Alejo:MAI-Voice-2.1-Flash", {"lively": "happy", "excited": "excited"}),
    "hi": Voice("hi-IN", "hi-IN-Dhruv:MAI-Voice-2.1-Flash", {"lively": "happy", "excited": "excited"}),
    "ne": Voice("ne-NP", "ne-NP-SagarNeural", {}),  # the only Nepali voice; pace does the work
    # Standard neural voices for the rest (no speaking styles; pace does the work)
    **{code: Voice(locale, name, {}) for code, (locale, name) in {
        "fr": ("fr-FR", "fr-FR-HenriNeural"),
        "de": ("de-DE", "de-DE-ConradNeural"),
        "pt": ("pt-BR", "pt-BR-AntonioNeural"),
        "it": ("it-IT", "it-IT-DiegoNeural"),
        "nl": ("nl-NL", "nl-NL-MaartenNeural"),
        "ar": ("ar-SA", "ar-SA-HamedNeural"),
        "zh": ("zh-CN", "zh-CN-YunxiNeural"),
        "ja": ("ja-JP", "ja-JP-KeitaNeural"),
        "ko": ("ko-KR", "ko-KR-InJoonNeural"),
        "ru": ("ru-RU", "ru-RU-DmitryNeural"),
        "tr": ("tr-TR", "tr-TR-AhmetNeural"),
        "pl": ("pl-PL", "pl-PL-MarekNeural"),
        "uk": ("uk-UA", "uk-UA-OstapNeural"),
        "id": ("id-ID", "id-ID-ArdiNeural"),
        "ms": ("ms-MY", "ms-MY-OsmanNeural"),
        "vi": ("vi-VN", "vi-VN-NamMinhNeural"),
        "th": ("th-TH", "th-TH-NiwatNeural"),
        "bn": ("bn-IN", "bn-IN-BashkarNeural"),
        "ur": ("ur-PK", "ur-PK-AsadNeural"),
        "ta": ("ta-IN", "ta-IN-ValluvarNeural"),
        "te": ("te-IN", "te-IN-MohanNeural"),
        "mr": ("mr-IN", "mr-IN-ManoharNeural"),
        "sw": ("sw-KE", "sw-KE-RafikiNeural"),
        "fa": ("fa-IR", "fa-IR-FaridNeural"),
        "el": ("el-GR", "el-GR-NestorasNeural"),
        "sv": ("sv-SE", "sv-SE-MattiasNeural"),
    }.items()},
}
# English has a different commentator for each viewing mode (casual uses the default above)
ENGLISH_BY_MODE = {
    "analyst": Voice("en-US", "en-US-Grant:MAI-Voice-2.1-Flash",  # calm and precise
                     {"calm": "narrator", "lively": "narrator", "excited": "narrator"}),
    "tactics": Voice("en-GB", "en-GB-Harry:MAI-Voice-2.1-Flash",  # the studio pundit
                     {"calm": "narrator", "lively": "narrator", "excited": "joyful"}),
    "kids": Voice("en-GB", "en-GB-Emily:MAI-Voice-2.1-Flash",  # cheerful
                  {"calm": "happy", "lively": "happy", "excited": "excited"}),
    "homer": Voice("en-US", "en-US-Ethan:MAI-Voice-2.1-Flash",  # the club channel's excitable voice
                   {"calm": "happy", "lively": "excited", "excited": "excited"}),
    "accessible": Voice("en-US", "en-US-Sage:MAI-Voice-2.1-Flash",  # clear, steady
                        {"calm": "narrator", "lively": "narrator", "excited": "narrator"}),
}
# Speaking rate: a base pace per mode, plus a boost for big moments. Commentators talk faster than
# a narrator; described commentary stays at a normal, clear pace. (+25% turns a 5.7 s line into 4.5 s.)
MODE_RATE = {"casual": 12, "analyst": 8, "tactics": 8, "kids": 10, "homer": 14, "accessible": 0}
PROSODY = {"calm": 0, "lively": 6, "excited": 14}  # boost per intensity, in %
INTENSITIES = tuple(PROSODY)
MAX_CHARS = 600
CACHE_SIZE = 200


def voice_for(language: str, mode: str) -> Voice:
    if language == "en" and mode in ENGLISH_BY_MODE:
        return ENGLISH_BY_MODE[mode]
    return VOICES.get(language, VOICES["en"])


def build_ssml(text: str, language: str, intensity: str, mode: str = "casual") -> str:
    voice = voice_for(language, mode)
    boost = PROSODY.get(intensity, 0) // (2 if mode == "accessible" else 1)  # keep described speech clear
    rate = MODE_RATE.get(mode, 12) + boost
    body = f"<prosody rate='+{rate}%'>{escape(text)}</prosody>"
    style = voice.styles.get(intensity, "")
    if style:  # the style wraps the prosody (a style inside prosody is silently ignored)
        degree = "2" if intensity == "excited" else "1"
        body = f"<mstts:express-as style='{style}' styledegree='{degree}'>{body}</mstts:express-as>"
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
        f"xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='{voice.locale}'>"
        f"<voice name='{voice.name}'>{body}</voice></speak>"
    )


class Speech:
    def __init__(self):
        endpoint = os.getenv("FOUNDRY_RESOURCE_ENDPOINT", "").rstrip("/")
        self.url = f"{endpoint}/tts/cognitiveservices/v1" if endpoint else None
        self.key = os.getenv("FOUNDRY_API_KEY")
        self.credential = None
        if not self.key and os.getenv("FOUNDRY_AUTH") == "identity":
            from azure.identity.aio import DefaultAzureCredential

            self.credential = DefaultAzureCredential()
        self.cache: OrderedDict[tuple[str, str, str, str], bytes] = OrderedDict()

    @property
    def available(self) -> bool:
        return bool(self.url and (self.key or self.credential))

    async def synthesize(self, text: str, language: str, intensity: str = "calm", mode: str = "casual") -> bytes:
        text = text.strip()[:MAX_CHARS]
        key = (language, intensity, mode, text)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]

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
            response = await client.post(self.url, content=build_ssml(text, language, intensity, mode).encode(), headers=headers)
        response.raise_for_status()

        self.cache[key] = response.content
        if len(self.cache) > CACHE_SIZE:
            self.cache.popitem(last=False)
        return response.content
