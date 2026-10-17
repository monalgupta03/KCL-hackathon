import json
import os
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from PIL import Image, UnidentifiedImageError

load_dotenv(Path(__file__).with_name(".env"))

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500"],
    allow_methods=["GET", "POST"],
    allow_headers=[],
)

MAX_IMAGE_BYTES = 5 * 1024 * 1024
UNKNOWN_RESULT = {
    "name": "unknown",
    "quantity": None,
    "unit": None,
    "needs_confirmation": True,
}
RECOGNITION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "quantity": {"type": "INTEGER", "nullable": True},
                    "unit": {"type": "STRING", "nullable": True},
                    "needs_confirmation": {"type": "BOOLEAN"},
                },
                "required": ["name", "quantity", "unit", "needs_confirmation"],
            },
        },
    },
    "required": ["items"],
}


def normalise_detected_items(result):
    if not isinstance(result, dict):
        return []

    items = result.get("items")
    if isinstance(items, list):
        detected = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            name = name.strip()
            if name.lower() == "unknown":
                continue
            quantity = item.get("quantity")
            if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
                quantity = None
            unit = item.get("unit")
            if not isinstance(unit, str) or not unit.strip():
                unit = None
            else:
                unit = unit.strip()
            detected.append({
                "name": name,
                "quantity": quantity,
                "unit": unit,
                "needs_confirmation": True,
            })
        return detected

    name = result.get("name")
    if not isinstance(name, str) or not name.strip():
        return []
    name = name.strip()
    if name.lower() == "unknown":
        return []
    quantity = result.get("quantity")
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        quantity = None
    unit = result.get("unit")
    if not isinstance(unit, str) or not unit.strip():
        unit = None
    else:
        unit = unit.strip()
    return [{
        "name": name,
        "quantity": quantity,
        "unit": unit,
        "needs_confirmation": True,
    }]


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/scan")
def scan_grocery(image: UploadFile = File(...)):
    if image.content_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=415, detail="Upload a JPEG or PNG image.")

    image_bytes = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller.")

    if image.content_type == "image/jpeg":
        valid_image = image_bytes.startswith(b"\xff\xd8\xff")
    else:
        valid_image = image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    if not valid_image:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid JPEG or PNG image.")

    expected_format = "JPEG" if image.content_type == "image/jpeg" else "PNG"
    try:
        with Image.open(BytesIO(image_bytes)) as uploaded_image:
            if uploaded_image.format != expected_format:
                raise HTTPException(status_code=400, detail="The image content does not match its file type.")
            uploaded_image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise HTTPException(status_code=400, detail="The uploaded image is invalid or corrupted.") from error

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured. Add GEMINI_API_KEY to backend/.env and restart FastAPI.",
        )

    prompt = (
        "Identify each distinct grocery item clearly visible in this image. "
        "Return one object per item in an 'items' array. "
        "If there are multiple food items, list each one separately. "
        "Only count clearly visible individual items where the count is obvious. "
        "Do not invent quantities when the count is uncertain; set quantity to null. "
        "Use count units like 'piece', 'pieces', or 'pack' only when reasonably clear. "
        "Do not estimate weight, volume, freshness, or expiry. "
        "Do not count multiple views of the same object as multiple items. "
        "If no food item is clearly identifiable, return an empty items array. "
        "Always set needs_confirmation to true."
    )

    try:
        with genai.Client(api_key=api_key) as client:
            response = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=image.content_type),
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_json_schema=RECOGNITION_SCHEMA,
                    temperature=0,
                ),
            )
    except genai_errors.APIError as error:
        if error.code == 429:
            raise HTTPException(
                status_code=429,
                detail="Gemini quota exceeded. Check your API quota and try again later.",
            ) from error
        raise HTTPException(
            status_code=502,
            detail="Gemini could not process the image. Try again later.",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="Gemini recognition is temporarily unavailable. Try again later.",
        ) from error

    try:
        result = json.loads(response.text)
    except (TypeError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an unusable result. Try another image.",
        ) from error

    items = normalise_detected_items(result)
    if not items:
        return {"items": []}

    return {"items": items}