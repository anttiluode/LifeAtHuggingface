/*
 * Life2 — the narrator and the painter.
 *
 * Rule one: the AI tells the life, it never decides it. The engine produces a small
 * fact sheet for each year; the narrator may only use what is on it. Every narration is
 * checked: if it names a person who isn't on the sheet, it is thrown away and re-rolled,
 * and after two failures the written template is used instead.
 *
 * Backends, all local, no paid API:
 *   narrator: templates | ollama (http://localhost:11434) | openai-compatible local server
 *             (llama.cpp, LM Studio...) | webllm (in the browser, WebGPU, experimental)
 *   painter:  none | local (local/painter_server.py, SDXL-Turbo on your GPU)
 *
 * Results are cached in the browser (IndexedDB) by save, year and variant, so a re-roll
 * makes a new variant and going back shows the old one.
 */
(function (root) {
  "use strict";
  const H = root.History, E = root.Engine;

  // ---------------------------------------------------------------- settings
  const DEFAULTS = {
    narrator: "templates", ollamaUrl: "http://localhost:11434", ollamaModel: "qwen2.5:7b",
    openaiUrl: "http://localhost:8080", openaiModel: "local", webllmModel: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    painter: "none", painterUrl: "http://localhost:7861", paintEvery: "milestones",
    voice: "off", voiceName: "", voiceRate: 0.95, makeRoom: true,
  };
  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("life2.ai") || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  let S = loadSettings();
  function saveSettings(s) { S = Object.assign({}, S, s); try { localStorage.setItem("life2.ai", JSON.stringify(S)); } catch (e) {} }

  // ---------------------------------------------------------------- cache (IndexedDB)
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const r = indexedDB.open("life2", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("media");
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function cacheGet(key) {
    const d = await db(); if (!d) return null;
    return new Promise((res) => { try { const q = d.transaction("media").objectStore("media").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } });
  }
  async function cachePut(key, val) {
    const d = await db(); if (!d) return;
    return new Promise((res) => { try { const t = d.transaction("media", "readwrite"); t.objectStore("media").put(val, key); t.oncomplete = res; t.onerror = res; } catch (e) { res(); } });
  }
  async function cacheDropPrefix(prefix, fromYear) {
    const d = await db(); if (!d) return;
    return new Promise((res) => {
      try {
        const t = d.transaction("media", "readwrite"), st = t.objectStore("media");
        const q = st.openCursor();
        q.onsuccess = () => {
          const c = q.result; if (!c) return;
          const k = String(c.key);
          if (k.startsWith(prefix)) { const y = +k.split(":")[2]; if (fromYear == null || y >= fromYear) c.delete(); }
          c.continue();
        };
        t.oncomplete = res; t.onerror = res;
      } catch (e) { res(); }
    });
  }

  // ---------------------------------------------------------------- the written narrator (always available)
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function templateNarration(f, variant) {
    const R = E.rng(hash(f.year + f.name + (variant || 0)));
    const pick = (a) => a[Math.floor(R() * a.length)];
    const out = [];
    if (f.history.length) out.push(`${f.year}. ${f.history[0]}.`);
    const lines = f.happened.filter((l) => !/^You are 18/.test(l));
    for (const l of lines.slice(0, 2)) out.push(l);
    const mood = {
      loved: ["The house is loud in the evenings.", "Someone always saves you a seat.", "There is a hand on your shoulder more often than not."],
      "getting by": ["The days are full and mostly the same.", "Work, supper, sleep.", "Nothing is wrong, exactly."],
      lonely: ["The evenings are long.", "You eat standing up, most days.", "No one asks how the day went."],
    }[f.warmth];
    if (out.length < 3) out.push(pick(mood));
    if (f.health === "failing" && out.length < 4) out.push(pick(["Your body is slower than it was.", "The stairs are harder this year."]));
    if (!out.length) out.push(`${f.year}. You are ${f.age}. ${pick(mood)}`);
    return out.join(" ");
  }

  // ---------------------------------------------------------------- the language-model narrator
  const SYSTEM = [
    "You are the narrator of a life-simulation game. You write the year that just passed, for the player, in second person, present tense.",
    "Write 2 to 4 short sentences, at most 70 words. One concrete, physical detail from the era and place. Plain and unsentimental; let the facts carry the feeling.",
    "Use ONLY the facts given. Never invent a named person, a birth, a death, an illness, money, or an event that is not in the facts. You may leave facts out.",
    "No anachronisms: objects, food, clothing and work must fit the year and place.",
    "Output only the narration: no title, no quotes, no lists, no notes.",
  ].join(" ");

  function sheetOf(f) {
    return {
      year: f.year, place: f.place, you: `${f.name}, a ${f.age}-year-old ${f.gender}, ${f.profession}, ${f.class}, ${f.wealth}`,
      health: f.health, heart: f.warmth, world: f.history, what_happened: f.happened,
      people: f.people.map((p) => `${p.name} (${p.relation}; bond ${p.bond}${p.far ? "; far away" : ""})`),
    };
  }
  function userPrompt(f, prev) {
    const sheet = sheetOf(f);
    return (prev && prev.length ? "The two previous years, for continuity:\n" + prev.join("\n") + "\n\n" : "") +
      "Facts for this year:\n" + JSON.stringify(sheet, null, 1) + "\n\nWrite the year.";
  }

  // names the narrator is not allowed to bring in from nowhere
  const ALLNAMES = new Set([].concat(...Object.values(H.NAMES).map((b) => b.m.concat(b.f))));
  function guard(text, f) {
    if (!text || text.length < 20) return false;
    if (text.split(/\s+/).length > 110) return false;
    const allowed = new Set([f.name.split(" ")[0], f.name.split(" ").slice(-1)[0]].concat(f.people.map((p) => p.name)));
    const caps = text.match(/\b[A-ZÄÖÅÜ][a-zäöåüé]+\b/g) || [];
    for (const w of caps) if (ALLNAMES.has(w) && !allowed.has(w)) return false;
    return true;
  }
  function clean(t) {
    return String(t || "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/^(Narration|Year)\s*:\s*/i, "").replace(/\n+/g, " ").trim();
  }

  // Ollama, streamed: words arrive as they are written, so a slow first load shows progress instead of
  // hanging. Gives up if nothing arrives for a while (model still loading, GPU busy, server stuck).
  async function callOllama(sys, user, seed, onProgress, opts) {
    opts = opts || {};
    const ctl = new AbortController();
    let timer = null, got = false;
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), ms); };
    arm(opts.firstWait || 150000);                       // the first word may wait for the model to load
    const t0 = Date.now();
    const tick = setInterval(() => { if (!got && onProgress) onProgress(`the narrator is loading the model… ${Math.round((Date.now() - t0) / 1000)} s`); }, 1000);
    try {
      const r = await fetch(S.ollamaUrl.replace(/\/$/, "") + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ model: S.ollamaModel, stream: true, messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          options: { temperature: 0.85, seed, num_predict: opts.maxTokens || 180 } }),
      });
      if (!r.ok) { let m = ""; try { m = (await r.json()).error || ""; } catch (e) {} throw new Error("Ollama " + r.status + (m ? ": " + m : "")); }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "", text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error("Ollama: " + j.error);
          if (j.message && j.message.content) {
            text += j.message.content; got = true;
            arm(30000);                                  // after the first word, 30 s of silence is a stall
            if (onProgress) onProgress(`the narrator is writing… ${text.split(/\s+/).filter(Boolean).length} words`);
          }
          if (j.done) return text;
        }
      }
      return text;
    } catch (e) {
      if (e.name === "AbortError") throw new Error(got ? "Ollama stopped mid-sentence" : "no answer from Ollama in " + Math.round((Date.now() - t0) / 1000) + " s (is the GPU busy?)");
      throw e;
    } finally { clearTimeout(timer); clearInterval(tick); }
  }
  async function callOpenAI(sys, user, seed) {
    const r = await fetch(S.openaiUrl.replace(/\/$/, "") + "/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(150000),
      body: JSON.stringify({ model: S.openaiModel, messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.85, seed, max_tokens: 180 }),
    });
    if (!r.ok) throw new Error("llm " + r.status);
    const j = await r.json();
    return j.choices && j.choices[0] && j.choices[0].message.content;
  }
  // ---- this Hugging Face Space: the page asks the server it came from (Gradio's HTTP API, streamed)
  let SPACE = null;
  async function detectSpace() {
    try {
      const r = await fetch("space-config", { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.space) return null;
      SPACE = j;
      // on the Space, its own narrator and painter are the default until the player saves other settings
      let saved = null; try { saved = localStorage.getItem("life2.ai"); } catch (e) {}
      if (!saved) S = Object.assign({}, S, { narrator: "space", painter: "space" });
    } catch (e) {}
    return SPACE;
  }
  async function callSpace(api, data, onPartial, maxMs) {
    const url = new URL("gradio/gradio_api/call/" + api, location.href).href;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), maxMs || 240000);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }), signal: ctl.signal });
      if (!r.ok) throw new Error("the Space answered " + r.status);
      const { event_id } = await r.json();
      const st = await fetch(url + "/" + event_id, { signal: ctl.signal });
      const reader = st.body.getReader(), dec = new TextDecoder();
      let buf = "", last = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (block.match(/^event: *(.*)$/m) || [])[1], dl = (block.match(/^data: *(.*)$/m) || [])[1];
          if (ev === "generating" || ev === "complete") {
            const d = dl ? JSON.parse(dl) : null;
            if (d && d.length && d[0] != null) { last = d[0]; if (onPartial) onPartial(last); }
            if (ev === "complete") return last;
          } else if (ev === "error") {
            let m = "the Space could not do it"; try { m = JSON.parse(dl).error || m; } catch (e) {}
            throw new Error(m);
          }
        }
      }
      return last;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("the Space did not answer in " + Math.round((maxMs || 240000) / 1000) + " s (busy?)");
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function spaceNarrate(f, prev, seed, onProgress) {
    if (onProgress) onProgress("waiting for the Space's narrator…");
    return callSpace("narrate", [JSON.stringify(sheetOf(f)), JSON.stringify((prev || []).slice(-2)), seed >>> 0],
      (t) => onProgress && onProgress(`the narrator is writing… ${String(t).split(/\s+/).filter(Boolean).length} words`));
  }

  let webllm = null, webllmLoading = null;
  async function callWebLLM(sys, user, seed, onProgress) {
    if (!webllm) {
      if (!navigator.gpu) throw new Error("This browser has no WebGPU.");
      webllmLoading = webllmLoading || (async () => {
        const mod = await import("https://esm.run/@mlc-ai/web-llm");
        webllm = await mod.CreateMLCEngine(S.webllmModel, { initProgressCallback: (p) => onProgress && onProgress(p.text) });
      })();
      await webllmLoading;
    }
    const r = await webllm.chat.completions.create({ messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.85, seed, max_tokens: 180 });
    return r.choices[0].message.content;
  }

  // the one entry point: text for a year (cached), never blocks the game
  async function narrate(key, f, prev, variant, onProgress) {
    const ck = key + ":" + (variant || 0) + ":text";
    const hit = await cacheGet(ck);
    if (hit) return hit;
    let text = null, source = "template", error = null;
    if (S.narrator !== "templates") {
      const call = S.narrator === "ollama" ? callOllama : S.narrator === "openai" ? callOpenAI : callWebLLM;
      for (let k = 0; k < 2 && !text; k++) {
        try {
          const seed = hash(key) + 7919 * ((variant || 0) * 3 + k);
          const t = clean(S.narrator === "space" ? await spaceNarrate(f, prev, seed, onProgress) : await call(SYSTEM, userPrompt(f, prev), seed, onProgress));
          if (guard(t, f)) { text = t; source = S.narrator; }
        } catch (e) { error = e.message; break; }
      }
      if (!text && !error) error = "the narrator's two tries strayed from the facts";
    }
    if (!text) text = templateNarration(f, variant);
    const val = { text, source };
    if (!error) await cachePut(ck, val);     // a failed call is not cached, so it is tried again later
    else val.error = error;
    return val;
  }

  // ---------------------------------------------------------------- the painter
  // The image models read only the first 77 CLIP tokens and drop the rest, so the prompt goes in order of
  // importance: style first (so it is never lost), then the people and the scene, then the place, then the light.
  const STYLE = "gouache picture-book painting, soft brush texture, muted earthy colours";
  const NEG = "text, letters, watermark, signature, photo, 3d render, deformed hands, extra fingers, gore, nudity";

  function personDesc(look, age, gender, short) {
    const who = age < 3 ? "a baby" : age < 13 ? `a ${age}-year-old ${gender === "m" ? "boy" : "girl"}` : `a ${age}-year-old ${gender === "m" ? "man" : "woman"}`;
    if (!look || age < 3) return who;
    const hair = age > 65 ? "grey " + look.hair.replace(/ hair$/, "") + " hair" : look.hair;
    return short ? `${who}, ${hair}, ${look.detail}` : `${who}, ${hair}, ${look.build}, ${look.detail}`;
  }

  // what to paint for a milestone, in words
  function scene(G, m) {
    const life = G.life;
    const look = H.REGIONS[m.place || G.region].look(m.year);
    const me = personDesc(life.look, m.year - life.born, life.gender, m.kind === "partner");
    const other = (name) => {
      const c = life.channels.find((x) => x.name === name);
      if (!c) return name ? "another person" : "";
      const a = c.kind === "child" ? m.year - c.birthYear : c.theirAge != null ? c.theirAge - (G.year - m.year) : 30;
      return personDesc(c.look, Math.max(0, a), c.gender, true);
    };
    const warm = life.warmth > 55 ? "warm golden lamplight" : life.warmth > 30 ? "plain daylight" : "cold blue-grey light, long shadows";
    const s = {
      begin: `${me} standing at the door of the family home at dawn, about to leave`,
      partner: `${me} and ${other(m.who[1])} together, close, early in their life together`,
      birth: `${me} holding a newborn baby, tired and amazed`,
      house: `${me} in front of their own house for the first time`,
      migration: `${me} with a bundle and a trunk, leaving home on a long journey, looking back`,
      war: `${me} come home from war, thin, in a worn uniform of the period, at the kitchen door`,
      quiet: `${me} alone at a kitchen table, the house empty around them`,
      rise: `${me} and family in fine clothes of the period, in a well-furnished room`,
      fall: `${me} and family loading their few belongings onto a cart, leaving a better house`,
      widowed: `${me} alone beside an empty chair`,
      heir: `${me}, the new head of the family, standing where their parent used to stand`,
      death: m.funeral ? `a funeral of the period, ${Math.min(30, m.funeral)} mourners at a grave` : "a single fresh grave in a nearly empty graveyard, no mourners",
      history: { plague: "a town street during an epidemic, shutters closed, a cart for the dead in the distance",
        war: "soldiers of the period marching through a village, women and children watching from doorways",
        famine: "a nearly empty table, thin bread, a family looking at it",
        econ: "a worried family counting coins and papers at a table by lamplight",
        boom: "a busy street full of new things and people in work clothes",
        displacement: "families with carts and bundles on a long road",
        disaster: "smoke over the rooftops of a town, people with buckets",
        migration: "a crowded harbour, a ship, people with trunks",
        flavor: "people gathered in a town square talking about the news" }[m.type] || "a town square",
    }[m.kind];
    if (!s) return null;
    const place = look.split(", ").slice(0, 3).join(", ");
    return { prompt: `${STYLE}. ${s}. ${place}${m.kind === "death" || m.kind === "history" ? "" : ", " + warm}`,
      negative: NEG, seed: ((life.look && life.look.seed) || 1) ^ hash(m.kind + m.year) };
  }

  async function paint(key, sc, variant) {
    if (S.painter === "none" || !sc) return null;
    const ck = key + ":" + (variant || 0) + ":img";
    const hit = await cacheGet(ck);
    if (hit) return hit;
    const seed = (sc.seed + 104729 * (variant || 0)) >>> 0;
    let img;
    if (S.painter === "space") img = await callSpace("paint", [sc.prompt, seed], null, 180000);
    else {
      const r = await fetch(S.painterUrl.replace(/\/$/, "") + "/paint", { signal: AbortSignal.timeout(120000),
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: sc.prompt, negative: sc.negative, seed, width: 768, height: 512 }),
      });
      if (!r.ok) throw new Error("painter " + r.status);
      img = (await r.json()).image;
    }
    if (!img) throw new Error("no picture came back");
    const val = { img, prompt: sc.prompt, sc };
    await cachePut(ck, val);
    return val;
  }

  // Ollama keeps a model in graphics memory for minutes after use. On one card that crowds the
  // painter out, so before a picture the narrator can be unloaded; it reloads for the next year.
  async function unloadNarrator() {
    if (S.narrator !== "ollama") return;
    try {
      await fetch(S.ollamaUrl.replace(/\/$/, "") + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: S.ollamaModel, keep_alive: 0 }), signal: AbortSignal.timeout(10000) });
    } catch (e) {}
  }

  // the narrator test writes one real sentence, so it proves generation works, not only that the server is up
  async function testNarrator(onProgress) {
    if (S.narrator === "ollama") {
      try {
        const r = await fetch(S.ollamaUrl.replace(/\/$/, "") + "/api/tags", { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const names = ((await r.json()).models || []).map((m) => m.name);
        const want = S.ollamaModel.includes(":") ? S.ollamaModel : S.ollamaModel + ":latest";
        if (!names.includes(want)) return `Ollama is running but has no model "${S.ollamaModel}". Installed: ${names.join(", ") || "none"}.`;
        const t0 = Date.now();
        const t = await callOllama("You write one short sentence.", "Write one sentence about rain on a roof.", 1, onProgress, { maxTokens: 40 });
        return `Ollama wrote a line in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${clean(t).slice(0, 90)}"`;
      } catch (e) { return /fetch|timed? ?out/i.test(e.message) ? "Can't reach Ollama at " + S.ollamaUrl + ". Is it running?" : e.message; }
    }
    if (S.narrator === "space") {
      try {
        const t0 = Date.now();
        const f = { year: 1850, place: "the Grand Duchy of Finland", name: "Aino Laine", age: 30, gender: "woman", profession: "farmer", class: "working", wealth: "a little saved",
          health: "good", warmth: "getting by", history: [], happened: ["The rye came in late."], people: [] };
        const t = await spaceNarrate(f, [], 1, onProgress);
        return `The Space (${SPACE ? SPACE.narrator : "?"}) wrote a year in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${clean(t).slice(0, 90)}"`;
      } catch (e) { return "The Space's narrator: " + e.message; }
    }
    if (S.narrator === "openai") {
      try { const t0 = Date.now(); const t = await callOpenAI("You write one short sentence.", "Write one sentence about rain on a roof.", 1); return `The server wrote a line in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${clean(t).slice(0, 90)}"`; }
      catch (e) { return "Can't get a line from " + S.openaiUrl + ": " + e.message; }
    }
    if (S.narrator === "webllm") return navigator.gpu ? "WebGPU available. The model downloads on first use (about 1 GB)." : "This browser has no WebGPU.";
    return "Written narration, no AI. Choose a narrator above first.";
  }

  // the painter test paints one real picture
  async function testPainter(onProgress) {
    if (S.painter === "space") {
      const t0 = Date.now();
      const tick = setInterval(() => onProgress && onProgress(`the Space is painting… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
      try {
        const img = await callSpace("paint", [STYLE + ". a quiet courtyard with a fig tree and a sleeping dog, an old woman shelling peas on a bench, late afternoon light", 7], null, 180000);
        return { msg: `The Space (${SPACE ? SPACE.painter : "?"}) painted this in ${((Date.now() - t0) / 1000).toFixed(1)} s.`, img };
      } catch (e) { return { msg: "The Space's painter: " + e.message }; }
      finally { clearInterval(tick); }
    }
    if (S.painter !== "local") return { msg: "Choose a painter above first." };
    const base = S.painterUrl.replace(/\/$/, "");
    let model = "", mem = "";
    const memText = (h) => (h.gpu_total_gb ? ` GPU memory: ${h.gpu_used_gb} of ${h.gpu_total_gb} GB in use (painter, Ollama and everything else).` : "");
    try { const r = await fetch(base + "/health", { signal: AbortSignal.timeout(5000) }); model = (await r.json()).model || ""; }
    catch (e) { return { msg: `Can't reach the painter at ${S.painterUrl}. Still loading? Wait for "painter ready" in its window.` }; }
    if (S.makeRoom) { onProgress && onProgress("making room: unloading the narrator…"); await unloadNarrator(); }
    const t0 = Date.now();
    const tick = setInterval(() => onProgress && onProgress(`${model} is painting… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
    try {
      const r = await fetch(base + "/paint", { signal: AbortSignal.timeout(120000), method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: STYLE + ". a quiet courtyard with a fig tree and a sleeping dog, an old woman shelling peas on a bench, late afternoon light", negative: NEG, seed: 7, width: 768, height: 512 }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const secs = (Date.now() - t0) / 1000;
      try { mem = memText(await (await fetch(base + "/health", { signal: AbortSignal.timeout(5000) })).json()); } catch (e) {}
      const slow = secs > 8 ? " That is slow: the card is probably full and borrowing system RAM. Tick ‘make room for the painter’, try qwen2.5:3b as the narrator, or start the painter with --vae tiny." : "";
      return { msg: `${model} painted this in ${secs.toFixed(1)} s.${mem}${slow}`, img: j.image };
    } catch (e) { return { msg: "The painter answered but could not paint: " + (e.name === "TimeoutError" ? "no picture in 120 s (GPU busy?)" : e.message) }; }
    finally { clearInterval(tick); }
  }

  // ---------------------------------------------------------------- the voice
  // the browser's own speech: free, offline for the system's local voices
  const canSpeak = typeof speechSynthesis !== "undefined";
  function voices() { return canSpeak ? speechSynthesis.getVoices() : []; }
  function pickVoice() {
    const vs = voices();
    return vs.find((v) => v.name === S.voiceName) || vs.find((v) => v.localService && /^en/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || vs[0] || null;
  }
  function speak(text, force) {
    if (!canSpeak || !text || (!force && S.voice !== "on")) return;
    speechSynthesis.cancel();                       // a new year interrupts the old one, so speech never lags behind
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = +S.voiceRate || 0.95;
    speechSynthesis.speak(u);
  }
  function stopSpeaking() { if (canSpeak) speechSynthesis.cancel(); }

  const api = { get settings() { return S; }, saveSettings, narrate, paint, scene, templateNarration, guard, cacheGet, cachePut, cacheDropPrefix, unloadNarrator, detectSpace, get space() { return SPACE; }, testNarrator, testPainter, canSpeak, voices, pickVoice, speak, stopSpeaking, DEFAULTS };
  root.AI = api;
})(typeof window !== "undefined" ? window : globalThis);
