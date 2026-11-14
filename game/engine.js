/*
 * Life2 — the dynasty engine.
 *
 * One person at a time, one family across generations, inside real history.
 *
 * The heart is the LifeSucks vine economy: every person in your life is a channel with
 * a conductance D, kept open only by what flows through it (your attention drops plus
 * what they give back). Thick old bonds change slowly. Channels that stop carrying
 * anything close by themselves.
 *
 * Around it: history (plague, war, famine, crashes, migration), a profession, a family
 * fortune you can invest, social class, and inheritance. When you die you choose which
 * child to continue as. When no child is left, the line ends.
 *
 * Everything random goes through one seeded generator, and everything the player does
 * goes through act(), which appends to G.actions. Replaying the actions on a fresh game
 * with the same seed reproduces the game exactly. That is how saving, loading and
 * "go back to year X" work.
 */
(function (root) {
  "use strict";
  const H = root.History || (typeof require !== "undefined" ? require("./history.js") : null);

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(R) {
    const u = R() + 1e-12, v = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------------------------------------------------------------- vine constants
  const DMAX = 2.0, QH = 1.5, DWOOD = 0.8, ETA = 0.5, D_CLOSE = 0.08, NEED = 4.5;
  const KIND = {
    partner: { cap: 3.4, recip: 0.55, Dh: 0.6, d0: 0.25, person: true },
    friend: { cap: 1.2, recip: 0.45, Dh: 0.5, d0: 0.22, person: true },
    parent: { cap: 1.2, recip: 0.85, Dh: 0.5, d0: 1.3, person: true },
    sibling: { cap: 1.0, recip: 0.5, Dh: 0.5, d0: 0.6, person: true },
    child: { cap: 2.0, recip: 0.8, Dh: 0.6, d0: 0.6, person: true },
    dream: { cap: 2.6, recip: 0.25, Dh: 0.7, d0: 0.22, person: false },
    work: { cap: 0.0, recip: 0.0, Dh: 0.7, d0: 0.3, person: false },
  };
  const ASSET_IDS = ["cash", "land", "trade", "lending", "stocks"];

  // ---------------------------------------------------------------- creation
  function createGame(setup) {
    const start = H.STARTS.find((s) => s.id === setup.start) || H.STARTS[0];
    const G = {
      setup: Object.assign({}, setup), seed: setup.seed >>> 0 || 1, R: rng(setup.seed || 1),
      year: start.year, region: start.region, surname: setup.surname || null,
      gen: 1, life: null, lives: [], actions: [], pending: [], used: {}, waitingHeir: false, over: false,
      money: 6, invest: { cash: 100, land: 0, trade: 0, lending: 0, stocks: 0 }, boomYears: 0, boomMult: 1,
      records: [], milestones: [], log: [], warActive: null, plagueActive: null, nextPersonId: 1, lastReturns: null,
    };
    if (!G.surname) G.surname = pick(G, H.REGIONS[G.region].surnames(G.year));
    G.money = setup.wealth === "rich" ? 400 : setup.wealth === "poor" ? 1 : 15;
    if (setup.wealth === "rich") G.invest = { cash: 30, land: 70, trade: 0, lending: 0, stocks: 0 };
    const life = newLife(G, setup.name || pickName(G, setup.gender || "f"), setup.gender || "f", G.year - 18);
    G.life = life;
    // the family you are born into
    const mother = add(G, life, "parent", { name: pickName(G, "f"), gender: "f", theirAge: 44 + Math.floor(G.R() * 10), D: 1.2 + G.R() * 0.3 });
    mother.role = "mother";
    if (G.R() < 0.8) { const f = add(G, life, "parent", { name: pickName(G, "m"), gender: "m", theirAge: mother.theirAge + 2, D: 0.8 + G.R() * 0.6 }); f.role = "father"; }
    const nsib = Math.floor(G.R() * 3);
    for (let i = 0; i < nsib; i++) { const g = G.R() < 0.5 ? "f" : "m"; add(G, life, "sibling", { name: pickName(G, g), gender: g, theirAge: 18 + Math.floor(G.R() * 9) - 4, D: 0.5 + G.R() * 0.5 }); }
    add(G, life, "friend", { name: pickName(G), D: 0.6 + G.R() * 0.3 });
    for (const c of life.channels) c.drops = c.kind === "parent" ? 1 : c.kind === "friend" ? 2 : c.kind === "sibling" ? 1 : 0;
    life.selfDrops = 2;
    const prof = startingProfession(G);
    setProfession(G, life, prof, 0.25);
    say(G, `You are 18, in ${H.REGIONS[G.region].label(G.year)}, in the year ${fmtYear(G.year)}. Your name is ${life.name} ${G.surname}.`, "plain");
    G.milestones.push({ kind: "begin", year: G.year, gen: 1, who: [life.name], place: G.region });
    queueEvents(G);
    return G;
  }

  function newLife(G, name, gender, bornYear, look) {
    return {
      look: look || lookFor(G),
      id: G.nextPersonId++, name, gender, born: bornYear, health: 82, warmth: 60, alive: true, channels: [], nextId: 1,
      selfDrops: 2, profession: null, house: false, flags: {}, yearsLonely: 0, peakWealth: G.money, diedAt: null, diedOf: null,
      startYear: G.year, gen: G.gen, events: [],
    };
  }

  function age(G, life) { return G.year - (life || G.life).born; }
  function fmtYear(y) { return y < 1000 ? `${y} AD` : String(y); }
  function pick(G, arr) { return arr[Math.floor(G.R() * arr.length)]; }
  function pickName(G, gender) {
    const pool = H.REGIONS[G.region].names(G.year);
    const want = gender || (G.R() < 0.5 ? "f" : "m");
    const opts = pool[want];
    // avoid the names of the living around you; a dead sibling's name may come back, as it often did
    const living = new Set(G.life ? G.life.channels.filter((c) => c.alive).map((c) => c.name).concat([G.life.name]) : []);
    const everUsed = new Set(G.life ? G.life.channels.map((c) => c.name) : []);
    const fresh = opts.filter((n) => !everUsed.has(n) && !living.has(n));
    const free = fresh.length ? fresh : opts.filter((n) => !living.has(n));
    return pick(G, free.length ? free : opts);
  }

  function add(G, life, kind, o) {
    const k = KIND[kind];
    const c = {
      id: life.nextId++, kind, name: o.name || kind, gender: o.gender || null, D: o.D != null ? o.D : k.d0, Dpeak: 0,
      drops: o.drops || 0, alive: true, born: G.year, ended: null, endReason: null, theirAge: o.theirAge != null ? o.theirAge : null,
      far: false, grandkids: [], dream: o.dream || null, wobble: G.R(), slot: G.R(), role: o.role || null, look: lookFor(G),
    };
    c.Dpeak = c.D;
    if (kind === "child") c.birthYear = G.year;
    life.channels.push(c);
    return c;
  }

  // a visual card so a person looks the same in every picture
  function lookFor(G) {
    const hair = pick(G, ["black hair", "dark brown hair", "light brown hair", "red hair", "blond hair", "auburn hair"]);
    const build = pick(G, ["slight", "sturdy", "tall and thin", "broad-shouldered", "small and quick"]);
    const detail = pick(G, ["a crooked smile", "freckles", "a scar on the chin", "deep-set eyes", "a gap in the teeth", "heavy eyebrows", "a long nose", "laugh lines"]);
    return { hair, build, detail, seed: Math.floor(G.R() * 1e9) };
  }

  function say(G, text, tone) { G.log.push({ year: G.year, age: G.life ? age(G) : null, gen: G.gen, text, tone: tone || "plain" }); }
  function alive(life, kind) { return life.channels.filter((c) => c.alive && (!kind || c.kind === kind)); }

  // ---------------------------------------------------------------- attention
  function budget(G) {
    const a = age(G), h = G.life.health;
    let b = a < 60 ? 12 : a < 70 ? 10 : a < 80 ? 8 : 6;
    if (h < 30) b -= 2;
    return Math.max(3, b);
  }
  function usedDrops(G) { return G.life.selfDrops + alive(G.life).reduce((s, c) => s + c.drops, 0); }
  function setDrops(G, id, n) {
    const life = G.life, B = budget(G);
    if (id === "self") { life.selfDrops = Math.max(0, Math.min(n, B - (usedDrops(G) - life.selfDrops), 8)); return; }
    const c = life.channels.find((x) => x.id === id && x.alive);
    if (!c) return;
    c.drops = Math.max(0, Math.min(n, B - (usedDrops(G) - c.drops), 8));
  }
  function clampDrops(G) {
    let over = usedDrops(G) - budget(G);
    while (over > 0) {
      const top = alive(G.life).filter((c) => c.drops > 0).sort((a, b) => b.drops - a.drops)[0];
      if (top) top.drops -= 1; else if (G.life.selfDrops > 0) G.life.selfDrops -= 1; else break;
      over -= 1;
    }
  }

  // ---------------------------------------------------------------- work and money
  function classOf(G) { return H.classOf(G.money); }
  function availableProfessions(G) {
    const cl = classOf(G);
    return H.PROFESSIONS.filter((p) => G.year >= p.from && G.year <= p.to && cl >= p.minClass);
  }
  function startingProfession(G) {
    const opts = availableProfessions(G).filter((p) => p.id !== "soldier");
    opts.sort((a, b) => a.wage - b.wage);
    return opts[Math.min(opts.length - 1, Math.floor(G.R() * Math.min(3, opts.length)))];
  }
  function setProfession(G, life, prof, D) {
    for (const w of alive(life, "work")) closeChan(G, w, "changed work", true);
    life.profession = prof.id;
    const w = add(G, life, "work", { name: prof.label, D: D != null ? D : 0.3 });
    w.drops = 3;
    w.prof = prof.id;
  }
  function wage(G) {
    const w = alive(G.life, "work")[0];
    if (!w) return G.life.flags.retired ? G.life.flags.pension || 0 : 0;
    const p = H.PROFESSIONS.find((x) => x.id === w.prof);
    return p.wage * (0.55 + 1.3 * w.D / (w.D + 0.7)) * G.boomMult * (G.life.flags.promo || 1) * (G.life.flags.moveMult || 1);
  }
  function displayMoney(G, units) {
    const m = H.REGIONS[G.region].money(G.year);
    const v = Math.round((units == null ? G.money : units) * m.k);
    const a = Math.abs(v);
    const s = a >= 1e9 ? (a / 1e9).toFixed(1) + " billion" : a >= 1e6 ? (a / 1e6).toFixed(1) + " million" : a.toLocaleString("en-US");
    return (v < 0 ? "−" : "") + s + " " + m.cur;
  }
  function setInvest(G, map) {
    const avail = H.assetsAt(G.year, G.region).map((a) => a.id);
    const out = {}; let sum = 0;
    for (const id of ASSET_IDS) { out[id] = avail.includes(id) ? Math.max(0, Math.round(map[id] || 0)) : 0; sum += out[id]; }
    if (sum <= 0) { out.cash = 100; sum = 100; }
    for (const id of ASSET_IDS) out[id] = Math.round(out[id] * 100 / sum);
    G.invest = out;
  }

  // ---------------------------------------------------------------- one year
  function recipOf(G, c) {
    if (c.kind === "child") return (G.year - c.birthYear) < 18 ? 0.8 : 0.35;
    return KIND[c.kind].recip;
  }
  function warmthFrom(G, c) {
    const k = KIND[c.kind];
    if (c.kind === "work") return 0.45 * c.D / (c.D + 0.7) - 0.3 * Math.max(0, c.drops - 3);
    let w = k.cap * c.D / (c.D + k.Dh);
    if (c.kind === "child" && G.year - c.birthYear < 18) w *= 0.75;
    if (c.kind === "child") w += c.grandkids.length * 0.9 * c.D / (c.D + 0.6);
    return w;
  }
  function youngKids(G) { return alive(G.life, "child").filter((c) => G.year - c.birthYear < 16).length; }

  function advanceYear(G) {
    const life = G.life;
    if (!life.alive || G.over || G.waitingHeir) return;
    clampDrops(G);
    const R = G.R;
    const rec = { year: G.year, gen: G.gen, name: life.name, age: age(G), place: G.region, events: [], closed: [], born: [], died: [] };
    const cl = classOf(G);

    // 1. canalization
    for (const c of alive(life)) {
      const dist = c.far ? 0.35 : 1.0;
      const Q = c.drops * dist + recipOf(G, c) * c.D;
      const target = DMAX * Q / (Q + QH);
      let eta = ETA / Math.pow(1 + c.D / DWOOD, 2);
      if (life.house && (c.kind === "partner" || c.kind === "child") && target < c.D) eta *= 0.6;
      c.D += eta * (target - c.D);
      c.Dpeak = Math.max(c.Dpeak, c.D);
    }

    // 2. warmth
    let warm = 0;
    for (const c of alive(life)) warm += warmthFrom(G, c);
    warm += 1.4 * (1 - Math.exp(-life.selfDrops / 2)) + (life.house ? 0.5 : 0);
    life.warmth = Math.max(0, Math.min(100, life.warmth + (warm - NEED) * 2.5));

    // 3. money: wage, partner, costs, then the fortune moves with its investments
    const income = wage(G);
    if (alive(life, "work").length) life.flags.lastWage = income;
    const p = alive(life, "partner")[0];
    const partnerIncome = p ? 8 * p.D / (p.D + 0.6) : 0;
    const lifestyle = [0.2, 0.3, 0.4, 0.5, 0.55][cl];
    const kidCost = G.year < 1900 ? 1.8 : 3.0;              // before 1900 children worked too
    const costs = 5 + lifestyle * (income + partnerIncome) + kidCost * youngKids(G) + (p ? 1.5 : 0) + (life.house ? 1.5 : 0) + (cl >= 3 ? 0.01 * Math.max(0, G.money) : 0);
    G.money += income + partnerIncome - costs;
    const returns = {};
    const avail = H.assetsAt(G.year, G.region);
    const shocks = {};
    for (const e of H.eventsAt(G.region, G.year)) if (e.shock && !G.used["shock:" + e.id]) { G.used["shock:" + e.id] = true; Object.assign(shocks, e.shock); }
    if (G.warActive) shocks.land = (shocks.land || 0) - 0.04 * G.warActive.sev;
    for (const a of avail) returns[a.id] = shocks[a.id] != null ? shocks[a.id] : a.mu + a.sd * gauss(R);
    if (G.money > 0) {
      let next = 0;
      for (const id of ASSET_IDS) next += G.money * (G.invest[id] || 0) / 100 * (1 + (returns[id] || 0));
      G.money = next;
    } else {
      G.money *= 1.06;               // debt grows
    }
    G.lastReturns = returns;
    life.peakWealth = Math.max(life.peakWealth, G.money);
    const newClass = classOf(G);
    if (newClass > cl && newClass >= 3 && !life.flags["rose" + newClass]) {
      life.flags["rose" + newClass] = true;
      say(G, `The ${G.surname} family is ${H.CLASSES[newClass]} now.`, "money");
      G.milestones.push({ kind: "rise", year: G.year, gen: G.gen, who: [life.name], cls: newClass, place: G.region });
    }
    if (newClass === 0 && cl > 0) {
      say(G, "Everything is gone. You are poor.", "loss");
      G.milestones.push({ kind: "fall", year: G.year, gen: G.gen, who: [life.name], place: G.region });
    }

    // 4. health
    const a = age(G);
    const workDrops = alive(life, "work").reduce((s, c) => s + c.drops, 0);
    let dh = 3.0 * (1 - Math.exp(-life.selfDrops / 2));
    dh -= a < 30 ? 0 : (a - 30) * 0.075;
    dh -= Math.max(0, workDrops - 5) * 0.5;
    if (life.warmth < 30) { dh -= (30 - life.warmth) * 0.12; life.yearsLonely += 1; }
    if (life.warmth > 60) dh += 1.0;
    if (G.money < 0) dh -= 1.5;
    if (newClass === 0) dh -= 1.0;
    if (newClass >= 3) dh += 0.5;
    life.health = Math.max(0, Math.min(100, life.health + dh));
    if (life.warmth < 25 && !life.flags.quiet) {
      life.flags.quiet = true;
      G.milestones.push({ kind: "quiet", year: G.year, gen: G.gen, who: [life.name], place: G.region });
    }

    // 5. ongoing history pressure (wars and plagues already announced keep taking people)
    if (G.warActive && G.year <= G.warActive.to) hazard(G, rec, 0.012 * G.warActive.sev, "the war");
    if (G.plagueActive && G.year <= G.plagueActive.to) hazard(G, rec, 0.03 * G.plagueActive.sev, G.plagueActive.cause || "the sickness");

    // 6. channels that carried nothing close by themselves
    for (const c of alive(life)) if (c.D < D_CLOSE) { closeChan(G, c, closeReason(c)); rec.closed.push(c.name); }

    // 7. time passes
    G.year += 1;
    if (G.boomYears > 0) { G.boomYears -= 1; if (!G.boomYears) G.boomMult = 1; }
    const era = H.eraLife(G.year);
    for (const c of alive(life)) {
      if (c.theirAge != null) c.theirAge += 1;
      if (c.kind === "child") {
        const ca = G.year - c.birthYear;
        if (ca === 18) { say(G, `${c.name} is grown.`, "soft"); }
        if (ca < 5 && R() < era.infant * [1.6, 1.2, 1.0, 0.8, 0.6][newClass]) { closeChan(G, c, "died"); rec.died.push(c.name); life.warmth = Math.max(0, life.warmth - 20); }
      }
      if (c.alive && c.theirAge != null && (c.kind === "parent" || c.kind === "partner" || c.kind === "sibling" || c.kind === "friend")) {
        if (R() < era.adult + 0.0003 * era.mort * Math.exp(0.088 * (c.theirAge - 18))) {
          closeChan(G, c, "died"); rec.died.push(c.name);
          life.warmth = Math.max(0, life.warmth - (c.kind === "partner" ? 18 : c.kind === "parent" ? 10 : 6));
          if (c.kind === "parent" && R() < 0.5 && newClass >= 1) { const inh = 2 + Math.floor(R() * 20); G.money += inh; say(G, `${c.name} left you ${displayMoney(G, inh)}.`, "soft"); }
          if (c.kind === "partner") G.milestones.push({ kind: "widowed", year: G.year, gen: G.gen, who: [life.name, c.name], place: G.region });
        }
      }
    }
    for (const c of alive(life, "child")) for (const g of c.grandkids) g.D = c.D;
    const w = alive(life, "work")[0];
    if (w && age(G) >= (G.year < 1900 ? 70 : 66)) {
      life.flags.pension = G.year < 1900 ? 0 : 0.4 * (life.flags.lastWage || 0);
      life.flags.retired = true;
      closeChan(G, w, "retired");
    }

    // 8. do you see next year?
    const pDie = era.adult + 0.00008 * era.mort * Math.exp(0.105 * (age(G) - 18)) * Math.exp((60 - life.health) / 22);
    G.records.push(rec);
    if (life.health <= 0 || R() < pDie || age(G) >= 104) { die(G); finishRecord(G, rec); return; }
    clampDrops(G);
    finishRecord(G, rec);
    queueEvents(G);
  }

  // what happened this year, frozen for the narrator and the book
  function finishRecord(G, rec) {
    rec.lines = G.log.slice(G.logMark || 0).map((l) => l.text);
    G.logMark = G.log.length;
    rec.facts = facts(G, rec);
    for (const c of G.life.channels) if (!c.alive) c.reported = true;
  }

  function hazard(G, rec, q, cause) {
    const life = G.life;
    for (const c of alive(life)) {
      if (!KIND[c.kind].person) continue;
      if (G.R() < q) { closeChan(G, c, "died", false, cause); rec.died.push(c.name); life.warmth = Math.max(0, life.warmth - 10); }
    }
    if (G.R() < q * 0.6) life.health = Math.max(0, life.health - 25);
  }

  function closeReason(c) {
    return { partner: "drifted apart", friend: "lost touch", child: "stopped calling", dream: "gave it up", work: "lost the job", sibling: "grew apart", parent: "faded" }[c.kind] || "faded";
  }

  function closeChan(G, c, reason, quiet, cause) {
    c.alive = false; c.ended = G.year; c.endReason = reason; c.drops = 0; c.cause = cause || null;
    if (quiet) return;
    const txt = {
      "drifted apart": `You and ${c.name} drifted apart.`, "lost touch": `You lost touch with ${c.name}.`,
      "stopped calling": `${c.name} no longer comes home.`, "gave it up": `You gave up ${c.dream || "the dream"}.`,
      "lost the job": `You lost your place as ${c.name}.`, "retired": "Your working years are over.",
      "grew apart": `You and your ${c.gender === "m" ? "brother" : "sister"} ${c.name} grew apart.`,
      "died": `${c.name} died${cause ? " of " + cause : ""}.`,
    }[reason] || `${c.name}: ${reason}.`;
    say(G, txt, reason === "died" ? "grief" : reason === "retired" ? "soft" : "loss");
    if (c.kind === "partner" && reason === "drifted apart" && G.money > 0) G.money *= 0.8;
  }

  function die(G) {
    const life = G.life;
    life.alive = false; life.diedAt = age(G); life.diedYear = G.year;
    life.diedOf = life.health <= 0 ? (life.warmth < 20 ? "loneliness wore the body down" : "the body gave out")
      : life.flags.killedBy ? life.flags.killedBy : age(G) >= 80 ? "old age" : life.health < 35 ? "illness" : "a sudden illness";
    say(G, `${life.name} ${G.surname} died at ${life.diedAt}.`, "end");
    life.epitaph = epitaph(G);
    G.milestones.push({ kind: "death", year: G.year, gen: G.gen, who: [life.name], place: G.region, funeral: life.epitaph.funeral });
    G.lives.push(summarize(G, life));
    const heirs = heirCandidates(G);
    if (heirs.length) G.waitingHeir = true; else { G.over = true; say(G, `The ${G.surname} line ends.`, "end"); }
    G.pending = [];
  }

  // ---------------------------------------------------------------- events
  function queueEvents(G) {
    const R = G.R, life = G.life, a = age(G), ev = [];
    const p = alive(life, "partner")[0];
    const kids = alive(life, "child");
    const friends = alive(life, "friend");
    const work = alive(life, "work")[0];
    const cl = classOf(G);
    const social = friends.reduce((s, c) => s + c.D, 0) + (work ? 0.3 * work.D : 0);

    // history first: at most one card a year
    const hist = H.eventsAt(G.region, G.year).filter((e) => !G.used[e.id]);
    for (const e of hist) {
      if (e.p != null && R() > e.p) continue;
      const card = historyCard(G, e);
      G.used[e.id] = true;
      if (card) { ev.push(card); break; }
    }
    if (!ev.length) {
      const bg = H.background(G.year);
      if (R() < bg.famine) ev.push(historyCard(G, { id: "bgfamine" + G.year, type: "famine", sev: 0.4, title: "A bad harvest", text: "Rain at the wrong time. The granaries are half empty by midwinter." }));
      else if (R() < bg.plague) ev.push(historyCard(G, { id: "bgplague" + G.year, type: "plague", sev: 0.25, from: G.year, to: G.year, title: "Fever in the town", text: "The bells ring for funerals every day this month." }));
      else if (R() < bg.war) ev.push(historyCard(G, { id: "bgwar" + G.year, type: "war", sev: 0.25, from: G.year, to: G.year + 1, title: "Soldiers on the roads", text: "A local war. Soldiers take what they need." }));
    }

    // a working life
    if (!work && !life.flags.retired && a >= 16 && a < 64 && R() < 0.5) {
      const opts = availableProfessions(G).filter((x) => x.id !== life.profession);
      const offer = []; while (opts.length && offer.length < 3) offer.push(opts.splice(Math.floor(R() * opts.length), 1)[0]);
      ev.push({ id: "work", title: "Work.", text: "There is work, if you want it.", choices: offer.map((o) => ({ label: o.label, fx: (G) => { setProfession(G, G.life, o, 0.3); say(G, `You became a ${o.label}.`, "money"); } }))
        .concat([{ label: "Not yet", fx: (G) => say(G, "Not yet.") }]) });
    } else if (work && a < 55 && R() < 0.05) {
      const better = availableProfessions(G).filter((x) => x.wage > H.PROFESSIONS.find((y) => y.id === work.prof).wage);
      if (better.length) {
        const o = better[Math.floor(R() * better.length)];
        ev.push({ id: "career", title: `A chance to become a ${o.label}.`, text: "It means starting over at the bottom of it.",
          choices: [{ label: "Take it", fx: (G) => { setProfession(G, G.life, o, 0.2); say(G, `You became a ${o.label}.`, "money"); } }, { label: "Stay", fx: (G) => say(G, "You stayed where you were.") }] });
      }
    }

    if (!p && a < 65 && R() < 0.12 + 0.07 * social) {
      const g = life.gender === "f" ? "m" : "f";
      const n = pickName(G, g);
      const dowry = [0, 2, 10, 60, 300][Math.max(0, Math.min(4, cl + Math.floor(R() * 3) - 1))];
      ev.push({ id: "meet", title: `You meet ${n}.`, text: dowry > cl * 5 ? "Their family has money, and they have noticed yours." : "Something about them stays with you after you part.",
        choices: [
          { label: "Let them in", fx: (G) => { const c = add(G, G.life, "partner", { name: n, gender: g, theirAge: a + Math.floor(G.R() * 7) - 3 }); c.drops = 2; G.money += dowry; say(G, `You and ${n} made a life together.`, "warm"); G.milestones.push({ kind: "partner", year: G.year, gen: G.gen, who: [G.life.name, n], place: G.region }); } },
          { label: "Not now", fx: (G) => say(G, `You let ${n} pass.`) },
        ] });
    }
    if (a < 75 && friends.length < 6 && R() < 0.10 + 0.05 * social) {
      const n = pickName(G);
      ev.push({ id: "friend", title: `${n} wants to be friends.`, text: "An invitation, the kind you could say no to.",
        choices: [{ label: "Go", fx: (G) => { add(G, G.life, "friend", { name: n, theirAge: a }).drops = 1; say(G, `${n} became a friend.`, "warm"); } }, { label: "Too busy", fx: (G) => say(G, `You were too busy for ${n}.`) }] });
    }
    const fertileAge = life.gender === "f" ? a <= 42 : (p && p.theirAge <= 42);
    if (p && p.D > 0.8 && a >= 18 && fertileAge && kids.length < 6 && R() < 0.30) {
      ev.push({ id: "child", title: kids.length ? "Another child?" : "A child?", text: `${p.name} asks quietly, one evening.`,
        choices: [
          { label: "Yes", fx: (G) => birth(G) },
          { label: "Not yet", fx: (G) => say(G, "Not yet, you said.") },
        ] });
    }
    if (!life.house && G.money >= 60 && a < 65 && R() < 0.3) {
      ev.push({ id: "house", title: "A house of your own.", text: `${displayMoney(G, 50)}. Room for everyone you love, if you have them.`,
        choices: [{ label: "Buy it", fx: (G) => { G.money -= 50; G.life.house = true; say(G, "You bought a house.", "warm"); G.milestones.push({ kind: "house", year: G.year, gen: G.gen, who: [G.life.name], place: G.region }); } }, { label: "Keep the money", fx: (G) => say(G, "You kept the money.") }] });
    }
    if (!alive(life, "dream").length && a < 70 && R() < 0.06) {
      const d = pick(G, ["painting", "music", "the garden", "writing", "carving", "the choir", "beekeeping", "a small boat", "astronomy", "healing herbs"]);
      ev.push({ id: "dream", title: `You keep thinking about ${d}.`, text: "It would take time you don't have.",
        choices: [{ label: "Start", fx: (G) => { add(G, G.life, "dream", { name: d, dream: d }).drops = 1; say(G, `You started ${d}.`, "warm"); } }, { label: "Someday", fx: (G) => say(G, `${d}: someday.`) }] });
    }
    const lost = life.channels.filter((c) => !c.alive && c.kind === "friend" && c.endReason === "lost touch" && c.Dpeak > 0.7);
    if (lost.length && R() < 0.06) {
      const c = lost[Math.floor(R() * lost.length)];
      ev.push({ id: "old", title: `${c.name} sends word.`, text: "It's been years.",
        choices: [{ label: "Reply", fx: (G) => { const n = add(G, G.life, "friend", { name: c.name, D: 0.3 + 0.35 * c.Dpeak }); n.drops = 1; n.reunion = true; say(G, `You and ${c.name} found each other again.`, "warm"); } }, { label: "Leave it", fx: (G) => say(G, `You did not answer ${c.name}.`) }] });
    }
    const teen = kids.find((c) => G.year - c.birthYear >= 13 && G.year - c.birthYear <= 17 && c.D < 0.7 && R() < 0.25);
    if (teen) {
      ev.push({ id: "teen", title: `${teen.name} is in trouble.`, text: "People talk. Then they talk to you.",
        choices: [{ label: "Drop everything", fx: (G) => { teen.D += 0.7; G.life.health = Math.max(0, G.life.health - 3); say(G, `You dropped everything for ${teen.name}.`, "warm"); } }, { label: "Pay someone", fx: (G) => { G.money -= 3; teen.D += 0.15; say(G, `You paid someone to deal with ${teen.name}.`); } }] });
    }
    const gk = kids.find((c) => G.year - c.birthYear >= 20 && c.D > 0.5 && c.grandkids.length < 4 && R() < 0.15);
    if (gk) {
      const g = G.R() < 0.5 ? "f" : "m";
      const n = pickName(G, g);
      gk.grandkids.push({ name: n, gender: g, born: G.year, D: gk.D, slot: G.R() });
      say(G, `${gk.name} had a baby: ${n}.`, "warm");
    }
    if (work && work.D > 1.0 && a < 60 && R() < 0.10) {
      ev.push({ id: "promo", title: "Advancement.", text: "More money, more hours, more expected of you.",
        choices: [{ label: "Take it", fx: (G) => { G.life.flags.promo = Math.min(2.2, (G.life.flags.promo || 1) * 1.25); const w = alive(G.life, "work")[0]; if (w) w.drops = Math.min(8, w.drops + 2); say(G, "You took on more.", "money"); } }, { label: "Decline", fx: (G) => say(G, "You declined.") }] });
    }
    if (G.money > 30 && R() < 0.05) {
      const amt = Math.round(G.money * 0.3);
      ev.push({ id: "venture", title: "A venture.", text: `Someone you half trust wants ${displayMoney(G, amt)} for a scheme. It could double. It could vanish.`,
        choices: [{ label: "Put it in", fx: (G) => { if (G.R() < 0.45) { G.money += amt; say(G, "The venture paid double.", "money"); } else { G.money -= amt; say(G, "The venture failed. The money is gone.", "loss"); } } }, { label: "No", fx: (G) => say(G, "You kept your money.") }] });
    }
    G.pending = ev.slice(0, 2);
  }

  function birth(G) {
    const life = G.life;
    const g = G.R() < 0.5 ? "f" : "m";
    const n = pickName(G, g);
    const c = add(G, life, "child", { name: n, gender: g, theirAge: 0 });
    c.drops = 2;
    say(G, `${n} was born.`, "warm");
    G.milestones.push({ kind: "birth", year: G.year, gen: G.gen, who: [life.name, n], place: G.region });
    const era = H.eraLife(G.year);
    const mother = life.gender === "f" ? life : alive(life, "partner")[0];
    if (G.R() < era.childbirth) {
      if (mother === life) { life.health = Math.max(0, life.health - 40); say(G, "The birth nearly killed you.", "grief"); }
      else if (mother) { closeChan(G, mother, "died", false, "childbirth"); life.warmth = Math.max(0, life.warmth - 18); }
    }
  }

  // history events become cards with real choices
  function historyCard(G, e) {
    const life = G.life, a = age(G), R = G.R;
    const head = `${fmtYear(G.year)} · ${H.REGIONS[G.region].label(G.year)}`;
    const man = life.gender === "m" && a >= 17 && a <= 50;
    const mig = (H.EVENTS.find((x) => x.type === "migration" && x.region === G.region && G.year >= x.from && G.year <= x.to) || {}).dest;
    const base = { id: e.id, history: true, head, title: e.title, text: e.text, type: e.type };
    G.milestones.push({ kind: "history", event: e.id, title: e.title, type: e.type, year: G.year, gen: G.gen, who: [life.name], place: G.region });
    if (e.type === "plague") {
      const cause = e.cause || (G.year < 1700 ? "the plague" : "the fever");
      if (e.to > G.year) G.plagueActive = { to: e.to, sev: e.sev, cause };
      return Object.assign(base, { choices: [
        { label: "Flee to the countryside", fx: (G) => { G.money *= 0.9; for (const c of alive(G.life, "friend")) c.D *= 0.8; plagueStrike(G, e.sev * 0.5, cause); } },
        { label: "Stay and tend the sick", fx: (G) => { for (const c of alive(G.life)) if (KIND[c.kind].person && !c.far) c.D += 0.15; plagueStrike(G, e.sev, cause); } },
      ] });
    }
    if (e.type === "war") {
      if (e.to > G.year) G.warActive = { to: e.to, sev: e.sev };
      const ch = [];
      if (man) {
        ch.push({ label: "Go and fight", fx: (G) => { warStrike(G, e.sev, true); } });
        if (classOf(G) >= 2) ch.push({ label: "Pay to stay home", fx: (G) => { G.money *= 0.8; warStrike(G, e.sev, false); say(G, "You paid your way out of the army.", "money"); } });
        else ch.push({ label: "Hide", fx: (G) => { if (G.R() < 0.4) { say(G, "They found you.", "loss"); warStrike(G, e.sev * 1.2, true); } else { say(G, "They didn't find you.", "soft"); warStrike(G, e.sev, false); } } });
      } else ch.push({ label: "Endure", fx: (G) => warStrike(G, e.sev, false) });
      if (mig && G.region !== mig) ch.push({ label: `Leave for ${H.REGIONS[mig].name}`, fx: (G) => migrate(G, mig) });
      return Object.assign(base, { choices: ch });
    }
    if (e.type === "famine") {
      const ch = [
        { label: "Sell what you have for grain", fx: (G) => { G.money *= 0.75; G.life.health = Math.max(0, G.life.health - 5 * e.sev); famineStrike(G, e.sev * 0.4); } },
        { label: "Endure", fx: (G) => { G.life.health = Math.max(0, G.life.health - 15 * e.sev); famineStrike(G, e.sev); } },
      ];
      if (mig && G.region !== mig) ch.push({ label: `Leave for ${H.REGIONS[mig].name}`, fx: (G) => migrate(G, mig) });
      return Object.assign(base, { choices: ch });
    }
    if (e.type === "econ") return Object.assign(base, { choices: [{ label: "…", fx: () => {} }] });
    if (e.type === "boom") return Object.assign(base, { choices: [{ label: "…", fx: (G) => { G.boomYears = e.to - e.from + 1; G.boomMult = 1 + e.sev; } }] });
    if (e.type === "migration") {
      if (G.region === e.dest) return null;
      return Object.assign(base, { choices: [
        { label: `Go to ${H.REGIONS[e.dest].name}`, fx: (G) => migrate(G, e.dest) },
        { label: "Stay", fx: (G) => say(G, "You stayed.") },
      ] });
    }
    if (e.type === "displacement") {
      return Object.assign(base, { choices: [{ label: "…", fx: (G) => { G.money *= (1 - 0.6 * e.sev); for (const c of alive(G.life)) if (c.kind === "friend") c.far = true; G.life.house = false; G.life.warmth = Math.max(0, G.life.warmth - 10); say(G, "You lost the house and the land. You start again elsewhere.", "loss"); G.milestones.push({ kind: "migration", year: G.year, gen: G.gen, who: [G.life.name], place: G.region }); } }] });
    }
    if (e.type === "disaster") {
      return Object.assign(base, { choices: [{ label: "…", fx: (G) => { if (G.money > 0) G.money *= (1 - 0.5 * e.sev); G.life.health = Math.max(0, G.life.health - 6); if (G.R() < 0.3 * e.sev) { G.life.house = false; say(G, "The house is gone.", "loss"); } } }] });
    }
    return Object.assign(base, { choices: [{ label: "…", fx: () => {} }] });
  }

  function plagueStrike(G, sev, cause) {
    const life = G.life, cl = classOf(G);
    const cf = [1.3, 1.1, 1.0, 0.85, 0.7][cl];
    for (const c of alive(life)) {
      if (!KIND[c.kind].person) continue;
      const ag = c.theirAge != null ? c.theirAge : 30;
      const af = ag < 6 || ag > 60 ? 1.5 : 1.0;
      if (G.R() < 0.25 * sev * af * cf) { closeChan(G, c, "died", false, cause); life.warmth = Math.max(0, life.warmth - 12); }
    }
    if (G.R() < 0.18 * sev * cf) { life.health = Math.max(0, life.health - 70); if (life.health <= 0) life.flags.killedBy = cause; say(G, "You fell ill.", "grief"); }
  }
  function warStrike(G, sev, fighting) {
    const life = G.life;
    if (fighting) {
      const wasAt = alive(life, "work")[0];
      if (G.R() < 0.30 * sev) { life.health = 0; life.flags.killedBy = "the war"; say(G, "You did not come back.", "end"); return; }
      life.health = Math.max(5, life.health - 15 * sev); life.warmth = Math.max(0, life.warmth - 10);
      if (wasAt) wasAt.D *= 0.6;
      say(G, "You came back. Not all of you came back.", "grief");
      G.milestones.push({ kind: "war", year: G.year, gen: G.gen, who: [life.name], place: G.region });
    }
    for (const c of alive(life)) {
      if (!KIND[c.kind].person || c.gender !== "m") continue;
      const ag = c.kind === "child" ? G.year - c.birthYear : c.theirAge;
      if (ag != null && ag >= 17 && ag <= 50 && G.R() < 0.2 * sev) { closeChan(G, c, "died", false, "the war"); life.warmth = Math.max(0, life.warmth - 14); }
    }
    if (G.money > 0) G.money *= 1 - 0.15 * sev;
  }
  function famineStrike(G, sev) {
    const life = G.life, cl = classOf(G);
    for (const c of alive(life, "child")) {
      const ag = G.year - c.birthYear;
      if (ag < 10 && G.R() < 0.25 * sev * [1.5, 1.1, 0.7, 0.3, 0.1][cl]) { closeChan(G, c, "died", false, "hunger"); life.warmth = Math.max(0, life.warmth - 18); }
    }
  }
  function migrate(G, dest) {
    const life = G.life;
    G.money = G.money > 0 ? G.money * 0.85 - 2 : G.money - 2;
    for (const c of alive(life)) if (c.kind === "friend" || c.kind === "parent" || c.kind === "sibling") c.far = true;
    for (const c of alive(life, "child")) if (G.year - c.birthYear >= 18 && G.R() < 0.5) c.far = true;
    const w = alive(life, "work")[0];
    if (w) w.D *= 0.5;
    life.flags.moveMult = (life.flags.moveMult || 1) * 1.2;
    life.house = false;
    const from = G.region;
    G.region = dest;
    say(G, `You left ${H.REGIONS[from].name} for ${H.REGIONS[dest].name}.`, "money");
    G.milestones.push({ kind: "migration", year: G.year, gen: G.gen, who: [life.name], from, place: dest });
  }

  // ---------------------------------------------------------------- the end of one life, and the next
  function funeral(G, life) {
    let n = 0; const who = [];
    for (const c of alive(life)) {
      if (!KIND[c.kind].person) continue;
      if (c.D > 0.35 && !c.far) { n += 1; who.push(c.name); }
      if (c.kind === "child" && c.D > 0.35) n += c.grandkids.length;
    }
    const w = life.channels.find((c) => c.kind === "work");
    if (w && w.Dpeak > 1.3) n += 2;
    const d = alive(life, "dream")[0];
    if (d && d.D > 1.0) n += 3;
    return { count: n, names: who };
  }

  function epitaph(G) {
    const life = G.life, f = funeral(G, life);
    const kids = life.channels.filter((c) => c.kind === "child");
    const grand = kids.reduce((s, c) => s + c.grandkids.length, 0);
    const withered = life.channels.filter((c) => !c.alive && !["died", "retired", "changed work"].includes(c.endReason));
    const lostToHistory = life.channels.filter((c) => c.endReason === "died" && c.cause);
    const dream = life.channels.find((c) => c.kind === "dream" && c.alive && c.D > 0.9);
    const cl = classOf(G);
    let line;
    if (life.flags.killedBy === "the war") line = "Went to war and did not come back.";
    else if (lostToHistory.length >= 3) line = "Outlived too many.";
    else if (dream && f.count < 6) line = `Kept at ${dream.dream} until the end.`;
    else if (cl >= 4 && f.count <= 3) line = "Built something the bank could see.";
    else if (f.count >= 12) line = "The house was never quiet.";
    else if (withered.length >= 6) line = "So many doors, each left a little open.";
    else if (cl === 0 && f.count >= 6) line = "Poor, and not alone.";
    else if (life.diedAt >= 80 && life.warmth > 50) line = "Old, warm, and not alone.";
    else if (life.warmth < 20) line = "The rooms went cold slowly.";
    else line = "Lived, mostly in the middle of things.";
    return {
      name: `${life.name} ${G.surname}`, age: life.diedAt, year: G.year, line, money: displayMoney(G), wealth: G.money, cls: H.CLASSES[cl],
      funeral: f.count, funeralNames: f.names, diedOf: life.diedOf, children: kids.length, grandchildren: grand,
      withered: withered.map((c) => ({ name: c.kind === "dream" ? c.dream : c.name, kind: c.kind, reason: c.endReason, year: c.ended })),
      lost: lostToHistory.map((c) => ({ name: c.name, cause: c.cause, year: c.ended })),
      place: H.REGIONS[G.region].name,
    };
  }

  function summarize(G, life) {
    return { gen: life.gen, id: life.id, name: life.name, gender: life.gender, born: life.born, died: G.year, place: G.region,
      epitaph: life.epitaph, profession: life.profession, peakWealth: life.peakWealth };
  }

  function heirCandidates(G) {
    return alive(G.life, "child").map((c) => ({ id: c.id, name: c.name, gender: c.gender, age: G.year - c.birthYear, bond: c.D, far: c.far, grandkids: c.grandkids.length }));
  }

  function inheritanceShare(G, heir, all) {
    const cl = classOf(G);
    const sons = all.filter((c) => c.gender === "m").sort((a, b) => b.age - a.age);
    const eldest = sons[0] || all.slice().sort((a, b) => b.age - a.age)[0];
    if (G.year < 1800 && cl >= 3 && all.length > 1) return heir.id === eldest.id ? 0.7 : 0.3 / (all.length - 1);
    return 1 / all.length;
  }

  function chooseHeir(G, childId) {
    const old = G.life;
    const all = heirCandidates(G);
    const h = all.find((x) => x.id === childId) || all[0];
    const ch = old.channels.find((c) => c.id === h.id);
    const widow = alive(old, "partner")[0];
    const share = inheritanceShare(G, h, all) * (widow ? 0.75 : 1);
    const inherited = G.money > 0 ? G.money * share : G.money * 0.3;
    G.gen += 1;
    // a child too young to live alone grows up off-screen
    let skip = Math.max(0, 16 - h.age);
    G.year += skip;
    const life = newLife(G, h.name, h.gender, G.year - h.age - skip, ch.look);
    life.warmth = 30 + 50 * ch.D / (ch.D + 0.6);
    life.health = h.age + skip < 50 ? 82 : 65;
    G.money = inherited;
    G.life = life;
    if (widow && widow.theirAge + skip < 90) { const m = add(G, life, "parent", { name: widow.name, gender: widow.gender, theirAge: widow.theirAge + skip, D: 0.8 + 0.5 * ch.D }); m.role = widow.gender === "f" ? "mother" : "father"; }
    for (const s of alive(old, "child")) if (s.id !== h.id) add(G, life, "sibling", { name: s.name, gender: s.gender, theirAge: G.year - s.birthYear, D: 0.4 + 0.4 * Math.min(1.5, s.D) });
    for (const g of ch.grandkids) { const k = add(G, life, "child", { name: g.name, gender: g.gender, D: 0.8 }); k.birthYear = g.born; }
    const myAge = age(G, life);
    if (myAge >= 24 && (ch.grandkids.length || G.R() < 0.5)) {
      const gg = life.gender === "f" ? "m" : "f";
      add(G, life, "partner", { name: pickName(G, gg), gender: gg, theirAge: myAge + Math.floor(G.R() * 5) - 2, D: 0.9 });
    }
    add(G, life, "friend", { name: pickName(G), theirAge: myAge, D: 0.5 });
    for (const c of life.channels) c.drops = c.kind === "partner" ? 2 : 1;
    life.selfDrops = 2;
    if (myAge >= 18) setProfession(G, life, old.profession && availableProfessions(G).find((p) => p.id === old.profession) || startingProfession(G), 0.4);
    G.waitingHeir = false;
    G.warActive = null; G.plagueActive = null;
    say(G, `Generation ${G.gen}: you are ${life.name} ${G.surname}, ${myAge}, in ${H.REGIONS[G.region].label(G.year)}. You inherited ${displayMoney(G)}.`, "warm");
    G.milestones.push({ kind: "heir", year: G.year, gen: G.gen, who: [life.name], place: G.region });
    clampDrops(G);
    queueEvents(G);
  }

  // ---------------------------------------------------------------- the action log
  // Every change the player makes goes through act(). Replaying the log on a fresh
  // game with the same setup reproduces everything exactly.
  function act(G, a, replaying) {
    if (a.t === "choose") {
      const e = G.pending[a.i];
      if (!e) return;
      const ch = e.choices[a.c];
      G.pending.splice(a.i, 1);
      ch.fx(G);
      if (G.life.health <= 0 && G.life.alive) die(G);
      clampDrops(G);
    } else if (a.t === "advance") {
      for (const c of alive(G.life)) c.drops = 0;
      G.life.selfDrops = 0;
      for (const [id, n] of a.alloc) { if (id === "self") G.life.selfDrops = n; else { const c = G.life.channels.find((x) => x.id === id && x.alive); if (c) c.drops = n; } }
      clampDrops(G);
      if (a.invest) G.invest = Object.assign({}, a.invest);
      G.pending = [];
      advanceYear(G);
    } else if (a.t === "heir") {
      chooseHeir(G, a.id);
    }
    if (!replaying) G.actions.push(a);
  }

  function advance(G) {
    const alloc = [["self", G.life.selfDrops]].concat(alive(G.life).filter((c) => c.drops > 0).map((c) => [c.id, c.drops]));
    act(G, { t: "advance", alloc, invest: Object.assign({}, G.invest) });
  }
  function choose(G, i, c) { act(G, { t: "choose", i, c }); }
  function heir(G, id) { act(G, { t: "heir", id }); }

  // rebuild a game from its setup and actions; optionally stop at the first moment the
  // calendar reaches `untilYear` (for "go back to a year")
  function replay(setup, actions, untilYear) {
    const G = createGame(setup);
    for (const a of actions) {
      if (untilYear != null && G.year >= untilYear && a.t === "advance") break;
      act(G, a, true);
      G.actions.push(a);
    }
    return G;
  }

  // ---------------------------------------------------------------- facts for the narrator and painter
  function bondWord(D) { return D > 1.3 ? "deep" : D > 0.8 ? "close" : D > 0.35 ? "thin" : "fading"; }
  function relation(G, c) {
    if (c.kind === "child") { const a = G.year - c.birthYear; return `${c.gender === "m" ? "son" : "daughter"}, ${a}`; }
    if (c.kind === "parent") return `${c.role || "parent"}, ${c.theirAge}`;
    if (c.kind === "sibling") return `${c.gender === "m" ? "brother" : "sister"}, ${c.theirAge}`;
    if (c.kind === "partner") return `${c.gender === "m" ? "husband" : "wife"}, ${c.theirAge}`;
    if (c.kind === "friend") return "friend";
    if (c.kind === "dream") return "a pursuit";
    if (c.kind === "work") return "work";
    return c.kind;
  }
  function facts(G, rec) {
    const life = G.life;
    const r = rec || G.records[G.records.length - 1];
    const yr = r ? r.year : G.year;
    const people = life.channels.filter((c) => KIND[c.kind].person && (c.alive || !c.reported))
      .map((c) => ({ name: c.name, relation: relation(G, c), bond: c.alive ? bondWord(c.D) : (c.endReason === "died" ? "died this year" : c.endReason), far: c.far }));
    const logLines = r && r.lines ? r.lines : G.log.slice(G.logMark || 0).map((l) => l.text);
    const hist = G.milestones.filter((m) => m.kind === "history" && m.year === yr).map((m) => m.title);
    return {
      year: fmtYear(yr), place: H.REGIONS[G.region].label(yr), region: G.region, name: `${life.name} ${G.surname}`, gender: life.gender === "f" ? "woman" : "man",
      age: yr - life.born, generation: G.gen, profession: (alive(life, "work")[0] || {}).name || (life.flags.retired ? "retired" : "no work"),
      class: H.CLASSES[classOf(G)], wealth: displayMoney(G), health: life.health > 70 ? "strong" : life.health > 40 ? "worn" : "failing",
      warmth: life.warmth > 65 ? "loved" : life.warmth > 35 ? "getting by" : "lonely", history: hist, happened: logLines, people,
    };
  }

  const api = { createGame, advance, choose, heir, act, replay, setDrops, budget, usedDrops, setInvest, alive, age, wage, displayMoney,
    classOf, availableProfessions, heirCandidates, inheritanceShare, epitaph, funeral, facts, warmthFrom, relation, bondWord, KIND, fmtYear, rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Engine = api;
})(typeof window !== "undefined" ? window : globalThis);
