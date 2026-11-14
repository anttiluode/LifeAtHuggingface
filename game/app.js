/* Life2 — the page: drawing, panels, saving, the book. */
(function () {
  "use strict";
  const E = window.Engine, H = window.History, AI = window.AI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let G = null, saveId = null, shownLog = 0, seenMilestones = 0, busy = false, particles = [];
  let lastTexts = [], currentKey = null, polKey = null, polMilestone = null;
  const variants = loadJSON("life2.variants", {});

  // ------------------------------------------------------------- storage
  function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("storage full", e); } }
  function allSaves() { return loadJSON("life2.saves", {}); }
  function writeSave(id, G) {
    const s = allSaves();
    const life = G.life;
    s[id] = { id, setup: G.setup, actions: G.actions, updated: Date.now(),
      title: `The ${G.surname} family`, summary: `${E.fmtYear(G.year)} · ${H.REGIONS[G.region].name} · generation ${G.gen} · ${life.name}, ${E.age(G)}${G.over ? " · the line ended" : ""}` };
    saveJSON("life2.saves", s);
    localStorage.setItem("life2.current", id);
  }
  function newId() { return "d" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function setVariant(key, n) { variants[key] = n; saveJSON("life2.variants", variants); }

  // ------------------------------------------------------------- canvas
  const canvas = $("world"), ctx = canvas.getContext("2d");
  let W = 0, Hh = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; Hh = r.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(Hh * DPR);
  }
  window.addEventListener("resize", resize);

  const PLACE = {
    parent: (i) => ({ a: -1.18 + 0.24 * i, r: 0.32 }),
    sibling: (i) => ({ a: -0.92 + 0.16 * (i % 4), r: 0.46 + 0.07 * (i % 2) }),
    partner: (i) => ({ a: -0.1 + (i % 2 ? 0.2 : -0.08) * Math.min(i, 3), r: 0.42 + 0.04 * (i % 3) }),
    child: (i) => ({ a: -0.42 + 0.21 * (i % 5), r: 0.70 + 0.09 * Math.floor(i / 5) }),
    friend: (i) => ({ a: 0.4 + 0.15 * (i % 6), r: 0.5 + 0.13 * (i % 2) + 0.06 * Math.floor(i / 6) }),
    work: (i) => ({ a: 1.24, r: 0.48 + 0.05 * (i % 3) }),
    dream: (i) => ({ a: -0.62 - 0.1 * (i % 3), r: 0.84 }),
  };
  function rootPos(w, h) { return { x: w * 0.5, y: h - 46 }; }
  function nodePos(life, c, w, h) {
    if (!c.ui) {
      const i = life.channels.filter((x) => x.kind === c.kind && x.id < c.id).length;
      const p = PLACE[c.kind](i);
      c.ui = { a: p.a + (c.wobble - 0.5) * 0.08, r: p.r + (c.slot - 0.5) * 0.05, dD: c.D };
      if (c.kind === "child") { const pa = E.alive(life, "partner")[0]; c.ui.anchor = pa ? pa.id : null; }
    }
    const R = rootPos(w, h);
    const x = R.x + Math.sin(c.ui.a) * c.ui.r * w * 0.6, y = R.y - Math.cos(c.ui.a) * c.ui.r * (h - 110);
    return { x: Math.max(40, Math.min(w - 40, x)), y: Math.max(70, Math.min(h - 60, y)) };
  }
  function curve(life, c, w, h) {
    let S = rootPos(w, h);
    if (c.kind === "child" && c.ui && c.ui.anchor) { const a = life.channels.find((x) => x.id === c.ui.anchor); if (a && a.alive) S = nodePos(life, a, w, h); }
    const E2 = nodePos(life, c, w, h), dx = E2.x - S.x, len = Math.hypot(dx, E2.y - S.y), wv = (c.wobble - 0.5) * 0.6;
    return { S, E: E2, C1: { x: S.x + dx * 0.15 + len * wv * 0.5, y: S.y - len * 0.42 }, C2: { x: E2.x - dx * 0.25 - len * wv * 0.4, y: E2.y + len * 0.28 } };
  }
  function bez(k, t) {
    const u = 1 - t;
    return { x: u * u * u * k.S.x + 3 * u * u * t * k.C1.x + 3 * u * t * t * k.C2.x + t * t * t * k.E.x,
      y: u * u * u * k.S.y + 3 * u * u * t * k.C1.y + 3 * u * t * t * k.C2.y + t * t * t * k.E.y };
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;

  function drawWorld(g, w, h, still) {
    const life = G.life;
    const warmT = Math.max(0, Math.min(1, life.warmth / 80));
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgb(mix([16, 22, 28], [26, 24, 16], warmT))); bg.addColorStop(1, rgb(mix([10, 13, 16], [14, 20, 14], warmT)));
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const R = rootPos(w, h);
    const glow = g.createRadialGradient(R.x, R.y, 10, R.x, R.y, Math.max(w, h) * 0.7);
    glow.addColorStop(0, rgb(mix([120, 140, 160], [230, 180, 90], warmT), 0.16 + 0.12 * warmT)); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    const vineCol = mix([128, 160, 172], [222, 196, 120], warmT);
    g.font = "11px 'IBM Plex Mono', monospace"; g.textAlign = "center";
    for (const c of life.channels) {
      if (c.alive) continue;
      const since = G.year - c.ended;
      if (since > 25) continue;
      const k = curve(life, c, w, h), fade = Math.max(0, 1 - since / 25);
      g.strokeStyle = c.endReason === "died" ? rgb([200, 204, 210], 0.35 * fade) : rgb([122, 92, 60], 0.75 * fade);
      g.lineWidth = 1 + 1.6 * Math.min(1.5, c.Dpeak);
      g.setLineDash(c.endReason === "died" ? [2, 5] : []);
      g.beginPath(); g.moveTo(k.S.x, k.S.y); g.bezierCurveTo(k.C1.x, k.C1.y, k.C2.x, k.C2.y, k.E.x, k.E.y); g.stroke(); g.setLineDash([]);
      g.fillStyle = rgb(c.endReason === "died" ? [210, 214, 220] : [150, 112, 74], 0.7 * fade);
      g.fillText((c.kind === "dream" ? c.dream : c.kind === "work" ? "old work" : c.name) + (c.endReason === "died" ? " †" : ""), k.E.x, k.E.y - 10);
    }
    for (const c of life.channels) {
      if (!c.alive) continue;
      const k = curve(life, c, w, h);
      const D = still ? c.D : (c.ui.dD += (c.D - c.ui.dD) * 0.08, c.ui.dD);
      const thin = D < 0.3;
      g.strokeStyle = c.kind === "work" ? rgb([170, 190, 200], 0.85) : thin ? rgb([185, 140, 96], 0.85) : rgb(vineCol, c.far ? 0.45 : 0.92);
      g.lineWidth = 1.2 + 7.5 * D / (D + 0.7); g.lineCap = "round";
      g.setLineDash(c.far ? [8, 6] : []);
      g.beginPath(); g.moveTo(k.S.x, k.S.y); g.bezierCurveTo(k.C1.x, k.C1.y, k.C2.x, k.C2.y, k.E.x, k.E.y); g.stroke(); g.setLineDash([]);
      if (!thin && c.kind !== "work") {
        g.fillStyle = rgb(mix([90, 130, 110], [130, 170, 100], warmT), 0.5);
        const n = Math.floor(2 + 5 * D);
        for (let i = 1; i < n; i++) { const p = bez(k, i / n), side = i % 2 ? 1 : -1; g.beginPath(); g.ellipse(p.x + side * (4 + 3 * D), p.y, 2 + 2.5 * D, 1.2 + 1.2 * D, side * 0.6, 0, Math.PI * 2); g.fill(); }
      }
      const r = 4 + 5 * D / (D + 0.6);
      if (c.kind === "work") {
        const lamp = g.createRadialGradient(k.E.x, k.E.y, 2, k.E.x, k.E.y, 40);
        lamp.addColorStop(0, "rgba(200,225,235,0.5)"); lamp.addColorStop(1, "rgba(200,225,235,0)");
        g.fillStyle = lamp; g.beginPath(); g.arc(k.E.x, k.E.y, 40, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(210,228,236,0.95)"; g.fillRect(k.E.x - 6, k.E.y - 6, 12, 12);
      } else {
        g.fillStyle = thin ? rgb([200, 150, 100]) : c.kind === "dream" ? rgb([160, 200, 240]) : rgb(mix([190, 210, 200], [245, 214, 140], warmT));
        g.beginPath(); g.arc(k.E.x, k.E.y, r, 0, Math.PI * 2); g.fill();
      }
      if (c.kind === "child") for (const gk of c.grandkids) {
        const ang = -1.2 + gk.slot * 2.4, bx = k.E.x + Math.sin(ang) * 22, by = k.E.y - Math.cos(ang) * 22;
        g.strokeStyle = rgb(vineCol, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(k.E.x, k.E.y); g.lineTo(bx, by); g.stroke();
        g.fillStyle = rgb([245, 214, 140], 0.9); g.beginPath(); g.arc(bx, by, 3, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = thin ? "rgba(214,170,128,0.95)" : "rgba(231,227,214,0.92)";
      g.fillText(c.kind === "work" ? c.name : c.kind === "dream" ? c.dream : c.name + (c.far ? " (far)" : ""), k.E.x, k.E.y - r - 7);
    }
    if (!still) for (const p of particles) {
      const c = life.channels.find((x) => x.id === p.id);
      if (!c || !c.alive) { p.dead = true; continue; }
      const q = bez(curve(life, c, w, h), p.out ? p.t : 1 - p.t);
      g.fillStyle = p.out ? "rgba(170,230,190,0.85)" : p.money ? "rgba(200,225,235,0.8)" : "rgba(255,206,120,0.95)";
      g.beginPath(); g.arc(q.x, q.y, p.out ? 1.6 : 2.2, 0, Math.PI * 2); g.fill();
    }
    const hr = 9 + 5 * (life.health / 100);
    const yg = g.createRadialGradient(R.x, R.y, 2, R.x, R.y, hr * 3);
    yg.addColorStop(0, rgb(mix([170, 190, 200], [255, 220, 150], warmT), 0.9)); yg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = yg; g.beginPath(); g.arc(R.x, R.y, hr * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = life.alive ? rgb(mix([200, 210, 215], [255, 232, 180], warmT)) : "rgba(150,150,150,0.9)";
    g.beginPath(); g.arc(R.x, R.y, hr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(231,227,214,0.8)";
    g.fillText(life.alive ? life.name : life.name + " †", R.x, R.y + hr + 16);
  }

  function frame() {
    if (G && G.life) {
      if (G.life.alive) for (const c of E.alive(G.life)) {
        if (Math.random() < c.drops * 0.035) particles.push({ id: c.id, t: 0, out: true, v: 0.008 + Math.random() * 0.006 });
        const back = c.kind === "work" ? 0 : Math.max(0, E.warmthFrom(G, c));
        if (Math.random() < back * 0.05) particles.push({ id: c.id, t: 0, out: false, v: 0.006 + Math.random() * 0.005 });
        if (c.kind === "work" && Math.random() < c.D * 0.05) particles.push({ id: c.id, t: 0, out: false, money: true, v: 0.01 });
      }
      for (const p of particles) { p.t += p.v; if (p.t >= 1) p.dead = true; }
      particles = particles.filter((p) => !p.dead).slice(-900);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      drawWorld(ctx, W, Hh, false);
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- panels
  function kindLabel(c) {
    const r = E.relation(G, c);
    if (c.kind === "work") return `≈ ${E.displayMoney(G, E.wage(G))} a year`;
    return r + (c.far ? " · far away" : "");
  }
  const ORDER = { partner: 0, child: 1, parent: 2, sibling: 3, friend: 4, dream: 5, work: 6 };
  const dots = (n) => (n <= 6 ? "●".repeat(n) || "·" : `●×${n}`);

  function render() {
    if (!G) return;
    const life = G.life;
    $("age").textContent = E.age(G);
    $("whoLine").textContent = `${life.name} ${G.surname} · generation ${G.gen}`;
    $("whereYear").textContent = E.fmtYear(G.year);
    $("wherePlace").textContent = `${H.REGIONS[G.region].label(G.year)} · ${H.CLASSES[E.classOf(G)]}`;
    $("hBar").style.width = life.health + "%"; $("hBar").style.background = life.health < 30 ? "#c98a62" : "";
    $("hVal").textContent = Math.round(life.health);
    $("wBar").style.width = life.warmth + "%"; $("wBar").style.background = life.warmth < 25 ? "#8fa9b8" : "";
    $("wVal").textContent = Math.round(life.warmth);
    $("mVal").textContent = E.displayMoney(G);
    const B = E.budget(G), used = E.usedDrops(G), free = Math.max(0, B - used);
    $("left").textContent = "●".repeat(free) + "○".repeat(Math.min(used, B));
    const rows = $("rows"); rows.innerHTML = "";
    const items = [{ id: "self", name: "Yourself", kind: "rest, sleep, being alone", drops: life.selfDrops, D: null }]
      .concat(E.alive(life).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).map((c) => ({ id: c.id, name: c.kind === "dream" ? c.dream[0].toUpperCase() + c.dream.slice(1) : c.kind === "work" ? c.name[0].toUpperCase() + c.name.slice(1) : c.name, kind: kindLabel(c), drops: c.drops, D: c.D })));
    for (const it of items) {
      const li = document.createElement("li");
      if (it.D != null && it.D < 0.3) li.classList.add("fading");
      li.innerHTML = `<div><span class="nm"></span><span class="kd"></span>${it.D != null ? `<div class="bond"><i style="width:${Math.min(100, it.D / 2 * 100)}%"></i></div>` : ""}</div><div class="pour"><button aria-label="less">−</button><span class="drops"></span><button aria-label="more">+</button></div>`;
      li.querySelector(".nm").textContent = it.name;
      li.querySelector(".kd").textContent = it.kind + (it.D != null && it.D < 0.3 ? " · fading" : "");
      li.querySelector(".drops").textContent = dots(it.drops);
      const [mi, pl] = li.querySelectorAll("button");
      mi.onclick = () => { E.setDrops(G, it.id, it.drops - 1); render(); };
      pl.onclick = () => { E.setDrops(G, it.id, it.drops + 1); render(); };
      mi.disabled = it.drops <= 0 || busy || !life.alive; pl.disabled = used >= B || busy || !life.alive;
      rows.appendChild(li);
    }
    const blocked = busy || !life.alive || G.over || G.waitingHeir;
    $("live").disabled = blocked; $("live5").disabled = blocked;
    renderWealth(); renderFamily(); renderLog();
  }

  const WHY = { cash: "Safe from crashes. Not from inflation, thieves or a currency reform.", land: "Slow and steady. Hurt by war and plague.",
    trade: "Ships and caravans. Can double. Can sink.", lending: "Steady interest, until the borrowers can't pay.", stocks: "Grow over decades. Crash in panics." };
  function renderWealth() {
    $("fBig").textContent = E.displayMoney(G);
    $("fClass").textContent = `The ${G.surname} family is ${H.CLASSES[E.classOf(G)]}.`;
    const w = E.alive(G.life, "work")[0];
    $("fWage").textContent = w ? `${G.life.name} earns about ${E.displayMoney(G, E.wage(G))} a year as ${w.name}.` : G.life.flags.retired ? "Retired." : "No work.";
    const box = $("assets"); box.innerHTML = "";
    for (const a of H.assetsAt(G.year, G.region)) {
      const d = document.createElement("div"); d.className = "asset";
      d.innerHTML = `<label>${a.label}</label><b>${G.invest[a.id] || 0}%</b><input type="range" min="0" max="100" step="5" value="${G.invest[a.id] || 0}"><div class="why">${WHY[a.id]}</div>`;
      const inp = d.querySelector("input");
      inp.oninput = () => {
        const m = Object.assign({}, G.invest); m[a.id] = +inp.value;
        // keep the total at 100 by taking from / giving to cash first
        let rest = 100 - m[a.id]; const others = H.assetsAt(G.year, G.region).map((x) => x.id).filter((id) => id !== a.id);
        const sumO = others.reduce((s, id) => s + (m[id] || 0), 0);
        for (const id of others) m[id] = sumO > 0 ? (m[id] || 0) * rest / sumO : id === "cash" ? rest : 0;
        E.setInvest(G, m); renderWealth();
      };
      inp.disabled = !G.life.alive;
      box.appendChild(d);
    }
    $("fNote").textContent = (G.year < 1800 ? "Before 1800, a wealthy family leaves most of its fortune to the eldest son. " : "") +
      "Lifestyle grows with class: the rich spend more just to stay rich. Debt grows by itself.";
    const r = G.lastReturns;
    $("returns").textContent = r ? Object.entries(r).filter(([id]) => (G.invest[id] || 0) > 0).map(([id, v]) => `${id} ${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`).join(" · ") || "everything in cash" : "—";
  }

  function renderFamily() {
    const ol = $("gens"); ol.innerHTML = "";
    for (const l of G.lives) {
      const li = document.createElement("li");
      li.innerHTML = `${esc(l.name)} <span>${E.fmtYear(l.born + 18)}–${E.fmtYear(l.died)}, ${esc(H.REGIONS[l.place].name)} · ${esc(l.epitaph.line)}</span>`;
      ol.appendChild(li);
    }
    if (G.life.alive) { const li = document.createElement("li"); li.innerHTML = `${esc(G.life.name)} <span>living, ${E.age(G)}</span>`; ol.appendChild(li); }
    const hs = E.heirCandidates(G);
    $("heirs").innerHTML = hs.length ? hs.map((h) => `<li>${esc(h.name)}, ${h.age} — bond ${E.bondWord(h.bond)}${h.far ? ", far away" : ""}</li>`).join("") : "<li>No children yet. If you die without one, the line ends.</li>";
  }

  function renderLog() {
    const log = $("log");
    if (shownLog > G.log.length) { log.innerHTML = ""; shownLog = 0; }
    for (; shownLog < G.log.length; shownLog++) {
      const e = G.log[shownLog];
      const li = document.createElement("li"); li.className = e.tone;
      li.innerHTML = `<span>${E.fmtYear(e.year)}</span>`; li.appendChild(document.createTextNode(e.text));
      log.insertBefore(li, log.firstChild);
    }
    while (log.children.length > 60) log.removeChild(log.lastChild);
  }

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    ["life", "wealth", "family"].forEach((t) => $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  }));

  // ------------------------------------------------------------- events
  function showEvent() {
    if (!G.pending.length || !G.life.alive) { $("event").classList.add("hidden"); return false; }
    const e = G.pending[0];
    $("eHead").textContent = e.head || `${E.fmtYear(G.year)} · age ${E.age(G)}`;
    $("eTitle").textContent = e.title; $("eText").textContent = e.text;
    const box = $("eChoices"); box.innerHTML = "";
    e.choices.forEach((ch, i) => {
      const b = document.createElement("button"); b.textContent = ch.label; if (i === 0) b.classList.add("primary");
      b.onclick = () => { E.choose(G, 0, i); afterAction(); if (!showEvent()) $("event").classList.add("hidden"); };
      box.appendChild(b);
    });
    $("event").classList.remove("hidden");
    return true;
  }

  // ------------------------------------------------------------- after every action: save, narrate, paint
  function afterAction() {
    writeSave(saveId, G);
    render();
    paintNewMilestones();
    if (!G.life.alive || G.waitingHeir || G.over) setTimeout(showDeath, 900);
  }

  // One queue for everything that uses the GPU: the narrator and the painter never run at the same
  // time, so on one graphics card they don't fight over memory. Narration goes first.
  let gpu = Promise.resolve(), gpuJob = null;
  function onGpu(fn, job) {
    const p = gpu.then(() => { gpuJob = job; return fn(); }).finally(() => { gpuJob = null; });
    gpu = p.catch(() => {});
    return p;
  }
  function narrateRecord(rec) {
    if (!rec || !rec.facts) return;
    const key = `${saveId}:${rec.gen}:${rec.year}`;
    currentKey = key;
    $("narrSrc").textContent = AI.settings.narrator === "templates" ? "" : gpuJob === "paint" ? "the narrator waits for the painter…" : "the narrator is writing…";
    const prev = lastTexts.slice(-2);
    onGpu(() => { if (currentKey === key && AI.settings.narrator !== "templates") $("narrSrc").textContent = "the narrator is writing…";
      return AI.narrate(key, rec.facts, prev, variants[key] || 0, (msg) => { if (currentKey === key) $("narrSrc").textContent = msg; }); }, "narrate")
      .then((v) => {
        lastTexts.push(v.text); if (lastTexts.length > 4) lastTexts.shift();
        if (currentKey === key) { showNarr(v, key); AI.speak(v.text); }
      }).catch(() => {});
  }
  function showNarr(v, key) {
    $("narrText").textContent = v.text;
    $("narrSrc").textContent = v.source === "template" ? (AI.settings.narrator === "templates" ? "written narration · turn on a narrator under AI" : "written instead: " + (v.error || "the narrator strayed from the facts")) : (v.source === "space" ? "narrated on this Space" : "narrated by " + v.source) + ((variants[key] || 0) ? ` · version ${(variants[key] || 0) + 1}` : "");
  }
  $("narrReroll").onclick = async () => {
    const rec = G.records[G.records.length - 1];
    if (!rec) return;
    const key = `${saveId}:${rec.gen}:${rec.year}`;
    setVariant(key, (variants[key] || 0) + 1);
    currentKey = key; $("narrSrc").textContent = "retelling…";
    const v = await onGpu(() => AI.narrate(key, rec.facts, lastTexts.slice(-3, -1), variants[key], (msg) => { if (currentKey === key) $("narrSrc").textContent = msg; }), "narrate");
    if (currentKey === key) { showNarr(v, key); AI.speak(v.text); }
  };

  const PAINT_PRIORITY = { death: 9, heir: 8, birth: 7, partner: 7, migration: 6, war: 6, widowed: 6, fall: 5, rise: 5, quiet: 5, house: 4, history: 3, begin: 2 };
  function milestoneKey(m) { return `${saveId}:${m.gen}:${m.year}:${m.kind}${m.event ? "-" + m.event : ""}`; }
  function caption(m) {
    const who = m.who && m.who[0];
    const t = { begin: `${who} at eighteen`, partner: `${m.who[0]} and ${m.who[1]}`, birth: `${m.who[1]} is born`, house: "the house", migration: `to ${H.REGIONS[m.place].name}`,
      war: `${who} comes home`, quiet: "the quiet year", rise: "the good years", fall: "everything gone", widowed: "alone", heir: `${who}, head of the family`,
      death: `the funeral of ${who}`, history: m.title }[m.kind] || m.kind;
    return `${E.fmtYear(m.year)} · ${t}`;
  }
  function paintNewMilestones() {
    const fresh = G.milestones.slice(seenMilestones);
    seenMilestones = G.milestones.length;
    if (AI.settings.painter === "none" || !fresh.length) return;
    // one picture per year: the most important thing that happened
    const byYear = {};
    for (const m of fresh) if (PAINT_PRIORITY[m.kind] && (!byYear[m.year] || PAINT_PRIORITY[m.kind] > PAINT_PRIORITY[byYear[m.year].kind])) byYear[m.year] = m;
    // after several years at once, paint only the two that matter most, so pictures don't pile up
    const picks = Object.values(byYear).sort((a, b) => PAINT_PRIORITY[b.kind] - PAINT_PRIORITY[a.kind] || a.year - b.year).slice(0, 2).sort((a, b) => a.year - b.year);
    for (const m of picks) {
      const key = milestoneKey(m), sc = AI.scene(G, m);      // the scene is fixed now, while this life is current
      if (!sc) continue;
      saveJSON("life2.painted." + saveId, Object.assign(loadJSON("life2.painted." + saveId, {}), { [key]: { year: m.year, gen: m.gen, cap: caption(m) } }));
      onGpu(async () => { if (AI.settings.makeRoom) await AI.unloadNarrator(); return AI.paint(key, sc, variants[key] || 0); }, "paint").then((v) => { if (v) showPolaroid(v.img, caption(m), key, m, sc); })
        .catch((e) => { $("narrSrc").textContent = "painter unavailable: " + e.message; });
    }
  }
  let polScene = null, polCap = "";
  function showPolaroid(img, cap, key, m, sc) {
    $("polImg").src = img; $("polCap").textContent = cap; polKey = key; polMilestone = m; polScene = sc || null; polCap = cap;
    $("polaroid").classList.remove("hidden");
  }
  $("polReroll").onclick = async () => {
    if (!polKey || !polScene) return;
    setVariant(polKey, (variants[polKey] || 0) + 1);
    $("polCap").textContent = "painting again…";
    const key = polKey, m = polMilestone, sc = polScene, cap = polCap;
    try { const v = await onGpu(async () => { if (AI.settings.makeRoom) await AI.unloadNarrator(); return AI.paint(key, sc, variants[key]); }, "paint"); if (v) showPolaroid(v.img, cap, key, m, sc); } catch (e) { $("polCap").textContent = "painter unavailable: " + e.message; }
  };

  // ------------------------------------------------------------- years
  function liveYears(n) {
    if (busy || !G.life.alive || G.waitingHeir || G.over) return;
    busy = true;
    let k = 0;
    const tick = () => {
      E.advance(G); k += 1;
      narrateRecord(G.records[G.records.length - 1]);
      writeSave(saveId, G); render(); paintNewMilestones();
      if (!G.life.alive || G.waitingHeir || G.over) { busy = false; render(); setTimeout(showDeath, 1200); return; }
      if (G.pending.length || k >= n) { busy = false; render(); showEvent(); return; }
      setTimeout(tick, 380);
    };
    tick();
  }
  $("live").onclick = () => liveYears(1);
  $("live5").onclick = () => liveYears(5);
  document.addEventListener("keydown", (e) => {
    if (e.key === " " && G && [...document.querySelectorAll(".overlay")].every((o) => o.classList.contains("hidden"))) { e.preventDefault(); liveYears(1); }
  });

  // ------------------------------------------------------------- death and the next generation
  function lastEpitaph() { return G.lives[G.lives.length - 1].epitaph; }
  function showDeath() {
    if (!G || (G.life.alive && !G.waitingHeir && !G.over)) return;
    $("event").classList.add("hidden");
    const ep = lastEpitaph();
    $("dName").textContent = `${ep.name}, ${E.fmtYear(ep.year - ep.age)}–${E.fmtYear(ep.year)}`;
    $("dLine").textContent = ep.line;
    const kids = ep.children ? ` · ${ep.children} ${ep.children === 1 ? "child" : "children"}${ep.grandchildren ? `, ${ep.grandchildren} grandchildren` : ""}` : "";
    $("dStats").textContent = `Died at ${ep.age} of ${ep.diedOf}, in ${ep.place} · ${ep.funeral === 0 ? "No one" : ep.funeral} at the funeral · left ${ep.money} (${ep.cls})${kids}`;
    $("dCame").textContent = ep.funeralNames.length ? ep.funeralNames.join(", ") + (ep.funeral > ep.funeralNames.length ? ", and others" : "") : ep.funeral ? "people from work, and others" : "no one";
    $("dWither").innerHTML = ep.withered.length ? ep.withered.slice(-10).map((x) => `<li>${esc(x.name)} — ${esc(x.reason)} <span class="dim">${E.fmtYear(x.year)}</span></li>`).join("") : "<li>nothing</li>";
    $("lostBox").classList.toggle("hidden", !ep.lost.length);
    $("dLost").innerHTML = ep.lost.map((x) => `<li>${esc(x.name)} — ${esc(x.cause)} <span class="dim">${E.fmtYear(x.year)}</span></li>`).join("");
    const box = $("heirCards"); box.innerHTML = "";
    const hs = E.heirCandidates(G);
    if (G.waitingHeir) {
      $("heirHead").textContent = "Who carries the line on?";
      for (const h of hs) {
        const share = E.inheritanceShare(G, h, hs);
        const b = document.createElement("button"); b.className = "heir";
        b.innerHTML = `<b>${esc(h.name)}</b><span>${h.gender === "m" ? "son" : "daughter"}, ${h.age}${h.age < 16 ? " (you will grow up first)" : ""}</span><span>bond with you: ${E.bondWord(h.bond)}${h.far ? ", far away" : ""}</span><span>inherits ${Math.round(share * 100)}% of the fortune${h.grandkids ? ` · ${h.grandkids} children of their own` : ""}</span>`;
        b.onclick = () => { E.heir(G, h.id); $("death").classList.add("hidden"); lastTexts = []; particles = []; seenMilestones = G.milestones.length - 1; afterAction(); narrateIntro(); showEvent(); };
        box.appendChild(b);
      }
      $("dNew").classList.add("hidden");
    } else {
      $("heirHead").textContent = `The ${G.surname} line ends here, after ${G.lives.length} generation${G.lives.length > 1 ? "s" : ""}.`;
      $("dNew").classList.remove("hidden");
    }
    drawPortrait();
    $("death").classList.remove("hidden");
  }
  function drawPortrait() {
    const pc = $("portrait"), g = pc.getContext("2d"), S = 2, w = pc.width / S, h = pc.height / S, band = 140;
    g.setTransform(S, 0, 0, S, 0, 0);
    drawWorld(g, w, h - band, true);
    const ep = lastEpitaph();
    g.fillStyle = "#0b100d"; g.fillRect(0, h - band, w, band); g.textAlign = "left";
    g.fillStyle = "#e7e3d6"; g.font = "500 21px Fraunces, Georgia, serif"; g.fillText(ep.name, 18, h - band + 32);
    g.fillStyle = "#a9b1a8"; g.font = "12px 'IBM Plex Mono', monospace"; g.fillText(`${E.fmtYear(ep.year - ep.age)}–${E.fmtYear(ep.year)} · ${ep.place}`, 18, h - band + 52);
    g.fillStyle = "#e5b45a"; g.font = "italic 300 15px Fraunces, Georgia, serif"; g.fillText(ep.line, 18, h - band + 78);
    g.fillStyle = "#a9b1a8"; g.font = "11px 'IBM Plex Mono', monospace"; g.fillText(`${ep.funeral === 0 ? "No one" : ep.funeral} at the funeral · ${ep.money}`, 18, h - band + 100);
    g.fillStyle = "#5d675f"; g.font = "10px 'IBM Plex Mono', monospace"; g.fillText(`Life² · generation ${G.lives.length} of the ${G.surname} family`, 18, h - band + 124);
  }
  $("savePic").onclick = () => $("portrait").toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `life2-${G.surname}-gen${G.lives.length}.png`; a.click(); });
  $("copyText").onclick = async () => {
    const ep = lastEpitaph();
    const t = `${ep.name}, ${E.fmtYear(ep.year - ep.age)}–${E.fmtYear(ep.year)}, ${ep.place}. ${ep.funeral === 0 ? "No one" : ep.funeral} came to the funeral. "${ep.line}" — generation ${G.lives.length} of the ${G.surname} family in Life² ${location.origin + location.pathname}`;
    try { await navigator.clipboard.writeText(t); $("copyText").textContent = "Copied"; } catch (e) { prompt("Copy this:", t); }
    setTimeout(() => ($("copyText").textContent = "Copy epitaph"), 1500);
  };
  $("dBook").onclick = () => openBook();
  $("dNew").onclick = () => { $("death").classList.add("hidden"); showStart(); };

  // ------------------------------------------------------------- the book
  async function bookHTML(forFile) {
    const painted = loadJSON("life2.painted." + saveId, {});
    const parts = [];
    const gens = {};
    for (const r of G.records) (gens[r.gen] = gens[r.gen] || []).push(r);
    for (const gen of Object.keys(gens).map(Number).sort((a, b) => a - b)) {
      const lifeSum = G.lives.find((l) => l.gen === gen);
      const first = gens[gen][0];
      parts.push(`<section class="chap"><h3>${esc(first.name)} ${esc(G.surname)}</h3><div class="sub">Generation ${gen} · ${E.fmtYear(first.year)}–${lifeSum ? E.fmtYear(lifeSum.died) : "living"}</div>${lifeSum ? `<div class="epi">${esc(lifeSum.epitaph.line)}</div>` : ""}`);
      for (const r of gens[gen]) {
        const key = `${saveId}:${r.gen}:${r.year}`;
        const hit = await AI.cacheGet(key + ":" + (variants[key] || 0) + ":text");
        const text = hit ? hit.text : AI.templateNarration(r.facts, 0);
        let imgs = "";
        for (const [k, p] of Object.entries(painted)) if (p.year === r.year && p.gen === r.gen) {
          const im = await AI.cacheGet(k + ":" + (variants[k] || 0) + ":img");
          if (im) imgs += `<img src="${im.img}" alt="${esc(p.cap)}" title="${esc(p.cap)}">`;
        }
        parts.push(`<div class="yr"><div class="y">${E.fmtYear(r.year)}<br>age ${r.age}</div><div><p>${esc(text)}</p>${imgs}</div></div>`);
      }
      parts.push("</section>");
    }
    return parts.join("");
  }
  async function openBook() {
    $("bookTitle").textContent = `The book of the ${G.surname} family`;
    $("bookBody").innerHTML = "<p class='dim'>Gathering the years…</p>";
    $("book").classList.remove("hidden");
    $("bookBody").innerHTML = await bookHTML(false);
  }
  $("bookClose").onclick = () => $("book").classList.add("hidden");
  $("bBook").onclick = openBook; $("openBook").onclick = openBook;
  $("bookDl").onclick = async () => {
    const css = `body{background:#0b100d;color:#e7e3d6;font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 16px}h1{font-weight:400}.chap{border-top:1px solid #22302a;margin-top:24px;padding-top:16px}.chap h3{font-size:24px;margin:0}.sub{color:#8f988f;font:12px monospace}.epi{color:#e5b45a;font-style:italic;margin:4px 0 10px}.yr{display:grid;grid-template-columns:80px 1fr;gap:12px;margin:10px 0}.y{color:#8f988f;font:12px monospace}.yr p{margin:0;line-height:1.55}.yr img{width:100%;border-radius:4px;margin:8px 0}`;
    const html = `<!doctype html><meta charset="utf-8"><title>The ${esc(G.surname)} family</title><style>${css}</style><h1>The book of the ${esc(G.surname)} family</h1>${await bookHTML(true)}<p style="color:#5d675f;font:11px monospace;margin-top:40px">Written in Life².</p>`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html" })); a.download = `the-${G.surname.toLowerCase()}-family.html`; a.click();
  };

  // ------------------------------------------------------------- saving, loading, going back
  function loadGame(id) {
    const s = allSaves()[id];
    if (!s) return false;
    G = E.replay(s.setup, s.actions);
    saveId = id; shownLog = 0; seenMilestones = G.milestones.length; lastTexts = []; particles = [];
    $("log").innerHTML = ""; $("polaroid").classList.add("hidden");
    localStorage.setItem("life2.current", id);
    hideAll(); resize(); render();
    const rec = G.records[G.records.length - 1];
    if (rec) narrateRecord(rec); else narrateIntro();
    showLastPicture();
    if (!G.life.alive || G.waitingHeir || G.over) showDeath(); else showEvent();
    return true;
  }
  async function showLastPicture() {
    if (AI.settings.painter === "none") return;
    const painted = Object.entries(loadJSON("life2.painted." + saveId, {})).sort((a, b) => b[1].year - a[1].year);
    for (const [k, p] of painted) { const im = await AI.cacheGet(k + ":" + (variants[k] || 0) + ":img"); if (im) { showPolaroid(im.img, p.cap, k, null, im.sc); return; } }
  }
  function renderSaves() {
    const s = Object.values(allSaves()).sort((a, b) => b.updated - a.updated);
    const ul = $("saveList"); ul.innerHTML = s.length ? "" : "<li>No saved dynasties yet.</li>";
    for (const x of s) {
      const li = document.createElement("li");
      li.innerHTML = `<div><b>${esc(x.title)}</b><br><span class="dim">${esc(x.summary)}</span></div><div class="b"><button>Load</button><button>Copy</button><button>Delete</button></div>`;
      const [lo, co, de] = li.querySelectorAll("button");
      lo.onclick = () => { $("saves").classList.add("hidden"); loadGame(x.id); };
      co.onclick = () => { const all = allSaves(); const id = newId(); all[id] = Object.assign({}, x, { id, title: x.title + " (copy)", updated: Date.now() }); saveJSON("life2.saves", all); renderSaves(); };
      de.onclick = () => { if (!confirm("Delete " + x.title + "?")) return; const all = allSaves(); delete all[x.id]; saveJSON("life2.saves", all); AI.cacheDropPrefix(x.id + ":"); renderSaves(); };
      ul.appendChild(li);
    }
  }
  $("bSave").onclick = () => { writeSave(saveId, G); $("bSave").textContent = "Saved"; setTimeout(() => ($("bSave").textContent = "Save"), 1200); };
  $("bLoad").onclick = $("bLoad2").onclick = () => { renderSaves(); $("saves").classList.remove("hidden"); };
  $("saveNew").onclick = () => { if (!G) return; const id = newId(); const all = allSaves(); all[id] = { id, setup: G.setup, actions: G.actions.slice(), updated: Date.now(), title: `The ${G.surname} family (copy)`, summary: `${E.fmtYear(G.year)} · generation ${G.gen}` }; saveJSON("life2.saves", all); renderSaves(); };
  $("savesClose").onclick = () => $("saves").classList.add("hidden");
  $("bBack").onclick = () => {
    const sel = $("rwYear"); sel.innerHTML = "";
    const years = [...new Set(G.records.map((r) => r.year))].reverse();
    for (const y of years) { const r = G.records.find((x) => x.year === y); const o = document.createElement("option"); o.value = y; o.textContent = `${E.fmtYear(y)} — ${r.name}, ${r.age}`; sel.appendChild(o); }
    $("rewind").classList.remove("hidden");
  };
  $("rwClose").onclick = () => $("rewind").classList.add("hidden");
  $("rwCopy").onclick = () => { $("saveNew").onclick(); $("rwCopy").textContent = "Copy saved"; };
  $("rwGo").onclick = async () => {
    const y = +$("rwYear").value;
    const s = allSaves()[saveId];
    G = E.replay(s.setup, s.actions, y);
    await AI.cacheDropPrefix(saveId + ":", y);
    writeSave(saveId, G);
    $("rewind").classList.add("hidden");
    loadGame(saveId);
  };

  // ------------------------------------------------------------- AI settings
  function fillVoices() {
    const sel = $("vName"), cur = AI.settings.voiceName || (AI.pickVoice() || {}).name || "";
    const vs = AI.voices().slice().sort((a, b) => (/^en/i.test(b.lang) - /^en/i.test(a.lang)) || (b.localService - a.localService) || a.name.localeCompare(b.name));
    sel.innerHTML = vs.length ? vs.map((v) => `<option value="${esc(v.name)}"${v.name === cur ? " selected" : ""}>${esc(v.name)} · ${esc(v.lang)}${v.localService ? "" : " · online"}</option>`).join("")
      : `<option value="">${AI.canSpeak ? "no voices found yet" : "this browser cannot speak"}</option>`;
  }
  if (AI.canSpeak) speechSynthesis.onvoiceschanged = () => { if (!$("settings").classList.contains("hidden")) fillVoices(); };
  function showSpace() {
    const sp = AI.space;
    document.querySelectorAll(".spaceOnly").forEach((el) => el.classList.toggle("hidden", !sp));
    if (!sp) return;
    $("spaceNarr").textContent = `(${sp.narrator.split("/").pop()} · ${sp.device})`;
    $("spacePaint").textContent = `(${sp.painter.split("/").pop()} · ${sp.device})`;
    $("privacyNote").textContent = "“This Space” runs the models on this Hugging Face Space: the year's fact sheet and the picture description are sent to it, nothing else. The other options run on your own machine.";
    $("startNote").textContent = `Every year is narrated by ${sp.narrator.split("/").pop()} and the milestones are painted by ${sp.painter.split("/").pop()}, on this Space` +
      (sp.slow ? ". It runs on a free CPU, so a year's words can take half a minute and a picture longer; the game never waits for them." : ".") +
      " Saves stay in your browser.";
  }
  AI.detectSpace().then(showSpace);
  function openSettings() {
    const s = AI.settings;
    showSpace();
    document.querySelectorAll("input[name=narr]").forEach((r) => (r.checked = r.value === s.narrator));
    document.querySelectorAll("input[name=paint]").forEach((r) => (r.checked = r.value === s.painter));
    $("olUrl").value = s.ollamaUrl; $("olModel").value = s.ollamaModel; $("oaUrl").value = s.openaiUrl; $("oaModel").value = s.openaiModel; $("pUrl").value = s.painterUrl;
    $("makeRoom").checked = !!s.makeRoom; $("vOn").checked = s.voice === "on"; $("vRate").value = s.voiceRate; $("vRateOut").textContent = (+s.voiceRate).toFixed(2) + "×";
    fillVoices();
    ["outNarr", "outPaint", "outVoice"].forEach((id) => ($(id).textContent = ""));
    $("paintTestImg").classList.add("hidden");
    $("settings").classList.remove("hidden");
  }
  function readSettings() {
    return { narrator: (document.querySelector("input[name=narr]:checked") || {}).value || "templates", painter: (document.querySelector("input[name=paint]:checked") || {}).value || "none",
      ollamaUrl: $("olUrl").value.trim(), ollamaModel: $("olModel").value.trim(), openaiUrl: $("oaUrl").value.trim(), openaiModel: $("oaModel").value.trim(), painterUrl: $("pUrl").value.trim(),
      makeRoom: $("makeRoom").checked, voice: $("vOn").checked ? "on" : "off", voiceName: $("vName").value, voiceRate: +$("vRate").value };
  }
  $("bSet").onclick = $("bSet2").onclick = openSettings;
  $("setClose").onclick = () => $("settings").classList.add("hidden");
  $("setSave").onclick = () => {
    AI.saveSettings(readSettings()); $("settings").classList.add("hidden"); voiceButton();
    if (G) { render(); showLastPicture(); $("narrSrc").textContent = `narrator: ${AI.settings.narrator} · painter: ${AI.settings.painter === "none" ? "off" : AI.settings.painter} · voice: ${AI.settings.voice} — takes effect from the next year`; }
  };
  $("vRate").oninput = () => ($("vRateOut").textContent = (+$("vRate").value).toFixed(2) + "×");
  $("testNarr").onclick = async () => {
    AI.saveSettings(readSettings()); const out = $("outNarr");
    out.textContent = "Testing… the first answer loads the model, which can take a minute.";
    out.textContent = await AI.testNarrator((m) => (out.textContent = m));
  };
  $("testPaint").onclick = async () => {
    AI.saveSettings(readSettings()); const out = $("outPaint"), img = $("paintTestImg");
    img.classList.add("hidden"); out.textContent = "Asking the painter…";
    const r = await AI.testPainter((m) => (out.textContent = m));
    out.textContent = r.msg;
    if (r.img) { img.src = r.img; img.classList.remove("hidden"); }
  };
  $("testVoice").onclick = () => {
    AI.saveSettings(readSettings());
    if (!AI.canSpeak) { $("outVoice").textContent = "This browser has no speech."; return; }
    const v = AI.pickVoice();
    $("outVoice").textContent = v ? `${v.name}${v.localService ? " (on this computer)" : " (online)"}` : "No voice found.";
    AI.speak($("narrText").textContent || "The house is quiet tonight. Somewhere a dog barks, and then nothing.", true);
  };

  // the little speaker on the narration: voice on and off without opening the settings
  function voiceButton() {
    const on = AI.settings.voice === "on", b = $("narrVoice");
    b.textContent = on ? "🔊 voice" : "🔈 voice"; b.classList.toggle("on", on);
    b.title = on ? "Stop reading the narration aloud" : "Read the narration aloud";
    b.classList.toggle("hidden", !AI.canSpeak);
  }
  $("narrVoice").onclick = () => {
    const on = AI.settings.voice !== "on";
    AI.saveSettings({ voice: on ? "on" : "off" }); voiceButton();
    if (on) AI.speak($("narrText").textContent); else AI.stopSpeaking();
  };
  voiceButton();

  // ------------------------------------------------------------- start
  let chosenStart = H.STARTS[0].id;
  function showStart() {
    const cur = localStorage.getItem("life2.current"), s = cur && allSaves()[cur];
    $("continueBox").classList.toggle("hidden", !s);
    if (s) $("contInfo").textContent = `${s.title} — ${s.summary}`;
    const box = $("starts"); box.innerHTML = "";
    for (const st of H.STARTS) {
      const d = document.createElement("div"); d.className = "start" + (st.id === chosenStart ? " on" : "");
      d.innerHTML = `<b>${esc(st.title)}</b><span>${esc(st.blurb)}</span>`;
      d.onclick = () => { chosenStart = st.id; showStart(); };
      box.appendChild(d);
    }
    $("start").classList.remove("hidden");
  }
  function hideAll() { document.querySelectorAll(".overlay").forEach((o) => o.classList.add("hidden")); }
  function narrateIntro() {
    $("narrText").textContent = G.log.filter((l) => l.year === G.year).map((l) => l.text).slice(-1)[0] || "";
    $("narrSrc").textContent = "";
    AI.speak($("narrText").textContent);
  }
  $("bContinue").onclick = () => loadGame(localStorage.getItem("life2.current"));
  $("bBegin").onclick = () => {
    const setup = { start: chosenStart, seed: 1 + Math.floor(Math.random() * 2147483000), gender: $("sGender").value,
      name: $("sName").value.trim() || null, surname: $("sSurname").value.trim() || null, wealth: $("sWealth").value };
    G = E.createGame(setup);
    saveId = newId(); shownLog = 0; seenMilestones = 0; lastTexts = []; particles = [];
    $("log").innerHTML = ""; $("polaroid").classList.add("hidden");
    writeSave(saveId, G);
    hideAll(); resize(); render(); narrateIntro(); paintNewMilestones(); showEvent();
  };

  showStart();
  requestAnimationFrame(frame);
  window.__life2 = { get G() { return G; } };   // for testing
})();
