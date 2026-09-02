import time
import json
from google import genai
from google.genai import types
from django.conf import settings

_client = None


def get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


BASE_ANALYSIS_PROMPT = """
You are a professional safety inspector AI reviewing a photo submitted through an anonymous public hazard-reporting tool. The photo was taken either at a construction worksite or inside/around a building.

Identify every visible safety violation. Each violation belongs to one of two domains:
- "Worksite": exposed electrical wiring, missing harness/fall protection at height, unsafe scaffolding, unguarded machinery, blocked emergency access at a construction site, or similar worker-safety hazards.
- "Building": illegal extra floors beyond sanctioned limits, missing or expired fire extinguishers, blocked or inadequate fire exits, overcrowding, structural cracks or visible damage, or similar occupant-safety hazards.

A single photo may contain violations from either or both domains, or none.

Ground every claim strictly in what is visibly present in the photo. Do not invent details, do not assume violations that are not visually evident, and do not speculate about what might be present out of frame. If the photo is unclear, poorly lit, or ambiguous about a potential hazard, say so explicitly in "why_dangerous" rather than asserting a violation with false confidence.

For each violation:
- "category" should be a short, specific label (e.g. "Exposed live wiring", "Missing fire extinguisher", "Unsanctioned additional floor") — not a generic term like "safety issue".
- "detail" should describe precisely what is visible and where in the frame, in one clear sentence, as if written for someone who has not seen the photo.

For "why_dangerous", write a plain-language paragraph explaining the concrete, real-world risk this creates (injury, fire, structural collapse, etc.), grounded in the specific violation(s) identified, not generic safety language.

For "urgency", apply this standard:
- "Critical": immediate risk of serious injury, death, or fire (e.g. live exposed wiring, no fall protection at height, blocked fire exit).
- "High": significant hazard that should be addressed promptly but is not immediately life-threatening (e.g. missing extinguisher, unsafe scaffolding without workers currently on it).
- "Medium": a violation of code or regulation with lower immediate danger.

For "complaint_draft", write a full, formal, anonymous complaint letter to the relevant municipal or labor authority. It must:
- Open by stating the purpose of the letter and that it is submitted anonymously through a public hazard-reporting channel.
- Describe each identified violation factually and specifically, referencing what is visible in the photo.
- Explain the risk to workers or occupants in concrete terms.
- Explicitly request a site inspection and appropriate remedial or enforcement action, citing the urgency level.
- Close formally, without any name, contact detail, or other identifying information about the reporter.

If no violations are visible, return an empty "violations" list, "urgency": "Medium", a "why_dangerous" that plainly states nothing hazardous was identified in the photo, and an empty string for "complaint_draft".
"""


def build_prompt(description):
    prompt = BASE_ANALYSIS_PROMPT
    if description:
        prompt += (
            "\n\nThe person submitting this photo also provided the following description for additional "
            "context. Use it only to help interpret what is visible in the photo — never treat it as a "
            "substitute for visual evidence, and never report a violation based on the description alone "
            "if it is not also visible in the image.\n\n"
            f'Submitter\'s description: "{description}"'
        )
    return prompt


RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "violations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "enum": ["Worksite", "Building"]},
                    "category": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["domain", "category", "detail"],
            },
        },
        "why_dangerous": {"type": "string"},
        "urgency": {"type": "string", "enum": ["Critical", "High", "Medium"]},
        "complaint_draft": {"type": "string"},
    },
    "required": ["violations", "why_dangerous", "urgency", "complaint_draft"],
}


def analyze_image(image_bytes, mime_type, description=None):
    image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
    prompt = build_prompt(description)

    for attempt in range(3):
        try:
            response = get_client().models.generate_content(
                model="gemini-3.6-flash",
                contents=[prompt, image_part],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=RESPONSE_SCHEMA,
                ),
            )

            return json.loads(response.text)

        except Exception as e:
            error_text = str(e)

            if "503" in error_text or "UNAVAILABLE" in error_text:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue

            raise
