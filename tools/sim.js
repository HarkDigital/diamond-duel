/* ============================================================
   Diamond Duel - headless balance simulator (Node, no deps)
   Plays frames with the REAL engine + data at several build
   levels and reports mean score / clear% against the target
   curve. Run:  node tools/sim.js [reps]
   Not loaded by the game; a tuning tool only.
   ============================================================ */
global.window = global;
require("../js/rng.js");
require("../js/data.js");
require("../js/engine.js");

const REPS = parseInt(process.argv[2], 10) || 300;

/* ---------- helpers mirrored from app.js ---------- */
function targetFor(inning0, frame) {
  const t = CONFIG.target;
  const raw = t.base * Math.pow(t.inningGrowth, inning0) * t.frameMult[frame] * (CONFIG.scoreScale || 1);
  return Math.max(1, Math.round(raw / 5) * 5);
}
function makePitcher(rng, inning0, frame) {
  const pc = CONFIG.pitcher;
  const boss = frame === 2;
  let stuff = pc.baseStuff + pc.stuffPerInning * inning0 + frame * pc.framePenalty + rng.range(-3, 3);
  let command = pc.baseCommand + pc.commandPerInning * inning0 + frame * (pc.framePenalty * 0.8) + rng.range(-3, 3);
  if (boss) { stuff += pc.bossStuffBonus; command += pc.bossCommandBonus; }
  return {
    name: "Sim", isBoss: boss, rule: null, bats: rng.pick(["L", "R"]),
    stuff: Math.max(5, Math.min(99, Math.round(stuff))),
    command: Math.max(5, Math.min(99, Math.round(command))),
    groundFlyLean: rng.range(-0.3, 0.3), targetMultiplier: 1,
  };
}
const ROLE_TAGS = ["slugger", "contact", "speedster", "table-setter", "utility", "veteran", "rookie"];
function rosterIdsFor(fr) {
  const target = CONFIG.startingDeckSize || fr.deck.length;
  const ids = fr.deck.slice();
  const have = new Set(ids);
  if (ids.length >= target) return ids.slice(0, target);
  const rng = makeRNG("roster:" + fr.id);
  const tagW = {};
  ids.forEach((id) => { const p = getPlayer(id); if (p) p.tags.forEach((t) => { if (ROLE_TAGS.indexOf(t) >= 0) tagW[t] = (tagW[t] || 0) + 1; }); });
  const bench = PLAYERS.filter((p) => !have.has(p.id) && p.rarity !== "legend")
    .map((p) => { let s = rng.float() * 3; p.tags.forEach((t) => { s += (tagW[t] || 0); }); s += p.rarity === "common" ? 6 : p.rarity === "star" ? 2 : 0; return { id: p.id, s }; })
    .sort((a, b) => b.s - a.s);
  while (ids.length < target && bench.length) ids.push(bench.shift().id);
  return ids;
}
let uidN = 0;
function card(id, deluxe) {
  const p = getPlayer(id);
  return { uid: "s" + (++uidN), id: p.id, name: p.name, nick: p.nick, bats: p.bats, contact: p.contact, power: p.power, eye: p.eye, speed: p.speed, tags: p.tags.slice(), edition: null, rarity: p.rarity, cost: p.cost, trait: p.trait, deluxe: deluxe || null, _streak: 0 };
}
function coach(id) {
  const t = getCoach(id);
  return { uid: "c" + (++uidN), id: t.id, name: t.name, fx: t.fx, gen: t.gen, trigger: t.trigger, aura: 0, deluxe: null, state: t.state ? JSON.parse(JSON.stringify(t.state)) : undefined };
}

/* ---------- one frame with the autoplay heuristic ---------- */
function simFrame(run, inning0, frame, rng) {
  const pitcher = makePitcher(rng, inning0, frame);
  const game = {
    pitcher, outsRemaining: CONFIG.outsPerGame, outsMax: CONFIG.outsPerGame, outsThisInning: 0,
    handSize: run.handSize, rally: run.startRally, startRally: run.startRally, score: 0,
    runsScored: 0, inning: 1, inningPA: 0, inningLeadReached: false, consecutiveSafe: 0,
    lastWasSlugger: false, bases: [null, null, null], deck: run.deck.map((c) => ({ ...c })), hand: [], discard: [],
  };
  rng.shuffle(game.deck);
  const draw = () => {
    if (!game.deck.length) { if (!game.discard.length) return null; game.deck = game.discard; game.discard = []; rng.shuffle(game.deck); }
    return game.deck.pop();
  };
  while (game.hand.length < game.handSize) { const c = draw(); if (!c) break; game.hand.push(c); }
  let guard = 0;
  while (game.outsRemaining > 0 && guard++ < 400) {
    const risp = game.bases[1] || game.bases[2];
    let bi = 0, bs = -1;
    game.hand.forEach((c, i) => {
      const s = c.contact * 0.5 + c.power * (risp ? 1.1 : 0.7) + c.eye * 0.4 + c.speed * 0.2;
      if (s > bs) { bs = s; bi = i; }
    });
    const c = game.hand.splice(bi, 1)[0];
    if (!c) break;
    game.discard.push(c);
    let ap = "swing";
    if (c.power >= 80 && (risp || game.outsRemaining > 1)) ap = "power";
    else if (c.eye >= 75 && !risp) ap = "contact";
    Engine.resolveAtBat(c, pitcher, game, run, rng, ap);
    const n = draw(); if (n) game.hand.push(n);
  }
  return game.score;
}

/* ---------- build tiers ---------- */
function baseRun(deckIds, opts) {
  const o = opts || {};
  return {
    deck: deckIds.map((d) => (typeof d === "string" ? card(d) : d)),
    dugout: (o.coaches || []).map(coach),
    analytics: Object.assign({ power: 0, contact: 0, patience: 0, speed: 0, rally: 0 }, o.analytics),
    actionLevels: Object.assign({ swing: 1, power: 1, contact: 1, bunt: 1, steal: 1 }, o.actions),
    handSize: o.handSize || CONFIG.handSize,
    startRally: o.startRally || CONFIG.startingRally,
    payroll: 0,
  };
}
const sandlot = rosterIdsFor(FRANCHISES[0]);
const BUILDS = {
  "B0 bare start": () => baseRun(sandlot),
  "B1 inning-3 build": () => baseRun(sandlot.slice(0, 26).concat(["mack_thunderton", "ziggy_park"]), {
    coaches: ["co_hit1", "co_aura1"], analytics: { contact: 1 }, actions: { swing: 2 },
  }),
  "B2 inning-6 build": () => baseRun(sandlot.slice(0, 18).concat(["mack_thunderton", "cy_bigsby", "walt_pemberton", "ozzie_klein"]), {
    coaches: ["co_hit2", "co_aura2", "co_rhit", "patience_guru", "table_setter"],
    analytics: { contact: 1, rally: 1 }, actions: { swing: 3, power: 2 }, startRally: 1.25,
  }),
  "B3 inning-9 build": () => {
    const ids = sandlot.slice(0, 8).concat(["mack_thunderton", "cy_bigsby", "el_toro_mendez", "lionel_frye", "walt_pemberton", "ozzie_klein", "sherman_boyle", "buster_kray"]);
    const r = baseRun(ids, {
      coaches: ["co_hit3", "co_aura4", "co_rhit2", "two_out_magic", "co_crisp2", "patience_guru", "co_xbh3"],
      analytics: { contact: 2, rally: 2, power: 1 }, actions: { swing: 4, power: 4, contact: 3 }, startRally: 1.5, handSize: 7,
    });
    r.deck[8].deluxe = "allstar"; r.deck[10].deluxe = "hof"; r.deck[11].deluxe = "slugger";
    return r;
  },
};

/* ---------- run the matrix ---------- */
const SPOTS = [];
for (let i = 0; i < 9; i++) { SPOTS.push([i, 0]); SPOTS.push([i, 2]); }
SPOTS.push([10, 2]); // Extra Innings, inning 11 Boss

console.log(`reps=${REPS} per spot. clear% vs target (mean score)`);
const head = ["spot".padEnd(14), "target".padStart(7)].concat(Object.keys(BUILDS).map((b) => b.padStart(20))).join("");
console.log(head);
for (const [inn, fr] of SPOTS) {
  const tgt = targetFor(inn, fr);
  const cells = [];
  for (const name of Object.keys(BUILDS)) {
    let clears = 0, total = 0;
    for (let r = 0; r < REPS; r++) {
      const run = BUILDS[name]();
      const rng = makeRNG("sim:" + name + ":" + inn + ":" + fr + ":" + r);
      const sc = simFrame(run, inn, fr, rng);
      total += sc;
      if (sc >= tgt) clears++;
    }
    cells.push(`${Math.round((clears / REPS) * 100)}% (${Math.round(total / REPS)})`.padStart(20));
  }
  const label = `inn ${inn + 1} ${fr === 2 ? "BOSS" : "Top "}`;
  console.log(label.padEnd(14) + String(tgt).padStart(7) + cells.join(""));
}
