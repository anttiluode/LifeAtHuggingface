---
title: Life² Bloodlines
emoji: 🌿
colorFrom: yellow
colorTo: green
sdk: gradio
sdk_version: 6.32.0
app_file: app.py
pinned: false
license: mit
short_description: A family through history, narrated and painted by AI
suggested_hardware: zero-a10g
models:
  - Qwen/Qwen2.5-7B-Instruct
  - Qwen/Qwen2.5-1.5B-Instruct
  - stabilityai/sdxl-turbo
  - stabilityai/sd-turbo
  - madebyollin/sdxl-vae-fp16-fix
---

# Life² — Bloodlines, on Hugging Face

**A family, through history. Love is still a flux.**

You live one life at a time, from 18 until it ends. Every year you have a few drops of attention to pour into the people around you, your work, yourself, a dream, and whatever you stop feeding withers. Real history arrives on its real dates: plagues, wars, famines, crashes, America-fever. There is a family fortune to invest. When you die, you choose which child carries the line on.

This is the Hugging Face Space version of [Life2](https://github.com/anttiluode/Life2). The game is the same page. What the Space adds is the AI, running on the Space instead of your own computer:

- **A narrator** writes every year from the game's fact sheet, streamed word by word.
- **A painter** makes a picture at each milestone (a birth, a partner, a house, a migration, coming home from war, a funeral), all in one picture-book gouache style. Each person keeps a fixed look card, so they stay recognisable across decades.

Saves, the family book and the pictures stay in the player's own browser.

## What runs where

| Space hardware | narrator | painter | picture |
|---|---|---|---|
| ZeroGPU (suggested) | Qwen2.5-7B-Instruct | SDXL-Turbo + fp16-safe VAE | 768×512, 2 steps |
| other GPU | Qwen2.5-1.5B-Instruct | SDXL-Turbo + fp16-safe VAE | 768×512, 2 steps |
| free CPU | Qwen2.5-1.5B-Instruct | SD-Turbo | 576×384, 1 step |

On the free CPU it works, but slowly: a year's words can take around half a minute and a picture longer. The game never waits for them; the written narration and the vine keep going. Set `NARRATOR_MODEL` or `PAINTER_MODEL` in the Space's variables to swap models.

The AI settings in the game still offer the player's own Ollama, an OpenAI-compatible local server, WebLLM in the browser, the local painter and the browser's voices.

## How it fits together

```
app.py         FastAPI: serves game/ at /, the Space's config at /space-config,
               and a Gradio API at the root (/gradio_api) with two endpoints:
                 narrate(sheet_json, prev_json, seed)  -> streamed text
                 paint(prompt, seed)                   -> JPEG data URL
game/          the game page (index.html, app.js, engine.js, history.js, ai.js, style.css)
```

The page asks `space-config` when it loads. If the answer comes, the page offers "This Space" as narrator and painter and uses them by default. It calls the endpoints through Gradio's plain HTTP API (`/gradio_api/call/...`, server-sent events), so it needs no extra library. On GitHub Pages or a local server, `space-config` doesn't exist and the game behaves exactly like Life2.

**The Space can't be used as a free general-purpose generator.** The page never sends its own prompt to the narrator. The server builds the prompt from the fact sheet, using the same rules as the game: second person, 2–4 sentences, only the facts given. A picture prompt is accepted only if every word in it is a word that appears in the game's own source. Across 1,110 milestone prompts from simulated dynasties, every one passed this check. "A spaceship landing on Mars" is refused.

## Putting it on Hugging Face

1. On huggingface.co create a new Space: SDK **Gradio**, any name (e.g. `LifeAtHuggingface`). Choose ZeroGPU hardware if your account has it, otherwise the free CPU.
2. Get the files there in either of two ways:
   - **Push from git:** `git remote add space https://huggingface.co/spaces/<you>/<space>` then `git push --force space main`. Use a Hugging Face write token as the password.
   - **Automatic, from GitHub:** add a secret `HF_TOKEN` (a write token) and a variable `HF_SPACE` (`<you>/<space>`) in this GitHub repo's Actions settings. `.github/workflows/sync-to-hf.yml` then mirrors every push to main.
3. The first start downloads the models, which takes minutes for 7B plus SDXL-Turbo. After that the Space opens straight into the game.

To run it locally: `pip install -r requirements.txt gradio==6.32.0`, then `python app.py`, then open http://localhost:7860. `LIFE2_MOCK=1 python app.py` uses stand-in models with no downloads.

## Honest notes

- **Tested here:** the whole path in mock mode, end to end in a headless browser. That covers the page finding the Space, streamed narration, pictures, the test buttons, two generations, the endpoints refusing a foreign prompt and a malformed fact sheet, and the vocabulary check on 1,110 real prompts. **Not tested here:** the real models. This machine has no GPU and can't download from Hugging Face. The model code is the standard transformers and diffusers path, but expect to fix small things on the first real start.
- **ZeroGPU quota.** Visitors share the account's ZeroGPU quota. When the quota runs out, the game falls back to the written narration and shows why.
- **Licenses.** The code is MIT. The models have their own licenses: Qwen2.5 7B and 1.5B are Apache-2.0, SDXL-Turbo and SD-Turbo have Stability AI's own licenses; read their model pages before any commercial use. Qwen2.5-3B is deliberately not used, because its license is research-only.
- **History is simplified on purpose.** Genocide and slavery are left out as playable events.
- `game/` is a copy of the Life2 page. Changes to the game go into Life2 first and are copied here.
