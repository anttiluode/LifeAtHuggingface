"""
Life² — Bloodlines, as a Hugging Face Space.

The game itself is the same static page as github.com/anttiluode/Life2 (in game/). This
server adds two things the page can call when it is opened from the Space:

    narrate  a small instruct model writes the year from the game's fact sheet (streamed)
    paint    a turbo diffusion model paints a milestone in the game's one picture-book style

Hardware is picked up by itself:
    ZeroGPU             Qwen2.5-7B-Instruct   + SDXL-Turbo (fp16-safe VAE), 768x512, 2 steps
    other GPU           Qwen2.5-1.5B-Instruct + SDXL-Turbo (fp16-safe VAE), 768x512, 2 steps
    CPU (free tier)     Qwen2.5-1.5B-Instruct + SD-Turbo, 576x384, 1 step   (slow but works)
Override with the NARRATOR_MODEL / PAINTER_MODEL variables in the Space settings.
LIFE2_MOCK=1 runs with stand-in models (no downloads), for testing.

The page never sends a prompt of its own: the narrator's prompt is built here from the fact
sheet, and a picture prompt is only accepted if every word in it is a word the game itself
uses. So the Space can't be used as a free general-purpose text or image generator.
"""
import os

try:                                    # on Hugging Face; must be imported before torch/gradio touch CUDA
    import spaces
    GPU = spaces.GPU
except ImportError:                     # running elsewhere: the decorator does nothing
    def GPU(fn=None, **kw):
        return fn if fn is not None else (lambda f: f)

import base64
import io
import json
import re
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import gradio as gr
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).parent
GAME = HERE / "game"
MOCK = os.environ.get("LIFE2_MOCK") == "1"
ZERO = bool(os.environ.get("SPACES_ZERO_GPU"))

if MOCK:
    DEVICE = "mock"
else:
    import torch
    DEVICE = "cuda" if (ZERO or torch.cuda.is_available()) else "cpu"
    if DEVICE == "cpu":
        torch.set_num_threads(max(1, os.cpu_count() or 1))

ON_GPU = DEVICE == "cuda"
# Qwen2.5 7B and 1.5B are Apache-2.0 (the 3B is not, so it is skipped). ZeroGPU has room for 7B;
# a small dedicated GPU or the CPU gets 1.5B.
NARRATOR_MODEL = os.environ.get("NARRATOR_MODEL") or ("Qwen/Qwen2.5-7B-Instruct" if ZERO else "Qwen/Qwen2.5-1.5B-Instruct")
PAINTER_MODEL = os.environ.get("PAINTER_MODEL") or ("stabilityai/sdxl-turbo" if ON_GPU else "stabilityai/sd-turbo")
SIZE = (768, 512) if ON_GPU else (576, 384)
STEPS = 2 if ON_GPU else 1

# ------------------------------------------------------------------ the narrator's rules (same as ai.js)
SYSTEM = " ".join([
    "You are the narrator of a life-simulation game. You write the year that just passed, for the player, in second person, present tense.",
    "Write 2 to 4 short sentences, at most 70 words. One concrete, physical detail from the era and place. Plain and unsentimental; let the facts carry the feeling.",
    "Use ONLY the facts given. Never invent a named person, a birth, a death, an illness, money, or an event that is not in the facts. You may leave facts out.",
    "No anachronisms: objects, food, clothing and work must fit the year and place.",
    "Output only the narration: no title, no quotes, no lists, no notes.",
])
SHEET_KEYS = {"year", "place", "you", "health", "heart", "world", "what_happened", "people"}


def user_prompt(sheet, prev):
    head = ("The two previous years, for continuity:\n" + "\n".join(prev) + "\n\n") if prev else ""
    return head + "Facts for this year:\n" + json.dumps(sheet, indent=1, ensure_ascii=False) + "\n\nWrite the year."


def check_sheet(sheet_json, prev_json):
    if len(sheet_json) > 6000 or len(prev_json) > 1400:
        raise gr.Error("fact sheet too long")
    sheet, prev = json.loads(sheet_json), json.loads(prev_json or "[]")
    if not isinstance(sheet, dict) or not set(sheet) <= SHEET_KEYS or "year" not in sheet:
        raise gr.Error("not a fact sheet")
    if not isinstance(prev, list) or len(prev) > 2 or not all(isinstance(p, str) and len(p) < 700 for p in prev):
        raise gr.Error("bad continuity")
    return sheet, prev


# ------------------------------------------------------------------ the painter's vocabulary
# every word the game could ever put in a picture prompt is somewhere in its own source
NEVER = {"nudity", "nude", "naked", "gore", "watermark", "signature", "text", "letters", "photo", "render", "deformed", "extra", "fingers"}
VOCAB = set()
for f in GAME.glob("*.js"):
    VOCAB |= set(re.findall(r"[a-zäöåüé]+", f.read_text(encoding="utf-8").lower()))
VOCAB -= NEVER


def check_prompt(prompt):
    if not isinstance(prompt, str) or not 20 < len(prompt) < 700:
        raise gr.Error("bad prompt")
    words = set(re.findall(r"[a-zäöåüé]+", prompt.lower()))
    stray = sorted(words - VOCAB)
    if stray:
        raise gr.Error("this painter only paints the game's own scenes (unknown words: " + ", ".join(stray[:5]) + ")")


# ------------------------------------------------------------------ models
TOK = LM = PIPE = None
if not MOCK:
    from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    from diffusers import AutoPipelineForText2Image

    print(f"loading narrator {NARRATOR_MODEL} and painter {PAINTER_MODEL} on {DEVICE}", flush=True)
    TOK = AutoTokenizer.from_pretrained(NARRATOR_MODEL)
    lm_dtype = torch.float32 if not ON_GPU else torch.bfloat16 if (ZERO or torch.cuda.is_bf16_supported()) else torch.float16
    LM = AutoModelForCausalLM.from_pretrained(NARRATOR_MODEL, torch_dtype=lm_dtype).to(DEVICE)
    extra = {}
    if ON_GPU and "xl" in PAINTER_MODEL.lower():
        from diffusers import AutoencoderKL
        # the stock SDXL VAE is upcast to fp32 for every picture; this one is stable in fp16
        extra["vae"] = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
    if ON_GPU:
        PIPE = AutoPipelineForText2Image.from_pretrained(PAINTER_MODEL, torch_dtype=torch.float16, variant="fp16", **extra)
    else:
        PIPE = AutoPipelineForText2Image.from_pretrained(PAINTER_MODEL, torch_dtype=torch.float32)
    PIPE.to(DEVICE)
    PIPE.set_progress_bar_config(disable=True)


def mock_text(sheet):
    parts = []
    if sheet.get("world"):
        parts.append(f"{sheet['year']}. {sheet['world'][0]}.")
    happened = [h for h in sheet.get("what_happened", []) if not h.startswith("You are 18")]
    parts.append(happened[0] if happened else "The days repeat, as days do.")
    parts.append("The stove ticks as it cools.")
    return " ".join(parts)


def mock_picture(prompt, seed):
    import hashlib
    from PIL import Image, ImageDraw
    w, h = SIZE
    hs = hashlib.sha256((prompt + str(seed)).encode()).digest()
    base = (196, 160, 104) if "golden" in prompt else (110, 128, 140) if "blue" in prompt else (150, 146, 120)
    img = Image.new("RGB", (w, h), base)
    d = ImageDraw.Draw(img)
    for k in range(12):
        x, y, r = hs[k] / 255 * w, hs[k + 12] / 255 * h, 20 + hs[(k + 5) % 32] / 255 * 100
        d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(max(0, min(255, base[i] + (hs[(k * 3 + i) % 32] - 128) // 3)) for i in range(3)))
    return img


# ------------------------------------------------------------------ the two endpoints
@GPU(duration=40)
def narrate(sheet_json: str, prev_json: str, seed: int) -> Iterator[str]:
    """Write one year of the game from its fact sheet. Streams the text as it is written."""
    sheet, prev = check_sheet(sheet_json, prev_json)
    if MOCK:
        text = ""
        for w in mock_text(sheet).split(" "):
            text += w + " "
            time.sleep(0.03)
            yield text.strip()
        return
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_prompt(sheet, prev)}]
    enc = TOK(TOK.apply_chat_template(messages, tokenize=False, add_generation_prompt=True), return_tensors="pt").to(DEVICE)
    torch.manual_seed(int(seed) % (2 ** 31))
    streamer = TextIteratorStreamer(TOK, skip_prompt=True, skip_special_tokens=True)
    th = threading.Thread(target=LM.generate, kwargs=dict(**enc, streamer=streamer, max_new_tokens=180,
                                                           do_sample=True, temperature=0.85, top_p=0.95))
    th.start()
    text = ""
    for piece in streamer:
        text += piece
        yield text.strip()
    th.join()


@GPU(duration=30)
def paint(prompt: str, seed: int) -> str:
    """Paint one milestone of the game. Returns a JPEG as a data URL."""
    check_prompt(prompt)
    t0 = time.time()
    if MOCK:
        img = mock_picture(prompt, seed)
    else:
        g = torch.Generator(DEVICE).manual_seed(int(seed) % (2 ** 31))
        img = PIPE(prompt=prompt, num_inference_steps=STEPS, guidance_scale=0.0,
                   width=SIZE[0], height=SIZE[1], generator=g).images[0]
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    print(f"painted in {time.time() - t0:.1f} s", flush=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


with gr.Blocks(title="Life² API") as api:
    gr.Markdown("The game is at the root of this Space. These are the two endpoints it calls.")
    gr.api(narrate, api_name="narrate", concurrency_limit=2 if ON_GPU else 1)
    gr.api(paint, api_name="paint", concurrency_limit=1)
api.queue(max_size=64)

app = FastAPI()


@app.get("/space-config")
def space_config():
    """The page asks this first; if it answers, the page offers the Space's own narrator and painter."""
    where = "ZeroGPU" if ZERO else DEVICE
    return JSONResponse({"space": True, "narrator": NARRATOR_MODEL, "painter": PAINTER_MODEL, "device": where,
                         "api": "gradio", "slow": DEVICE == "cpu"})


app = gr.mount_gradio_app(app, api, path="/gradio")
app.mount("/", StaticFiles(directory=GAME, html=True), name="game")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
