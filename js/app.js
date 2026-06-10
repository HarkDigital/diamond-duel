/* ============================================================
   Diamond Duel - App: state, screens, loop, shop, bracket
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  let TIP = null; // tooltip controller (set up in initTooltips)
  // Game-speed setting (1..4). 4 is the fastest (the original pacing); lower is slower.
  // speedScale() is the delay multiplier: 1.0 at 4x, 2.0 at 2x, 4.0 at 1x. Every gameplay
  // pause flows through sleep(), so one scale here paces the whole game.
  function speedScale() { return 4 / ((typeof META !== "undefined" && META && META.speed) ? META.speed : 4); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * speedScale()));
  const pace = (ms) => Math.round(ms * speedScale());   // scale a UI timeout to match the speed setting
  // Publish the speed multiplier as a CSS var so every gameplay animation/transition scales too
  // (calc(... * var(--gs))). Interaction feedback (hovers, button presses) deliberately ignores it.
  function applySpeedVar() {
    const root = document.getElementById("stage") || document.documentElement;
    if (root) root.style.setProperty("--gs", speedScale().toFixed(3));
  }
  const SAVE_KEY = "diamondduel.run.v1";
  const GAME_KEY = "diamondduel.game.v1";
  const META_KEY = "diamondduel.meta.v1";

  /* ---------------- meta (persists across runs) ---------------- */
  let META = loadMeta();
  function loadMeta() {
    try {
      const m = JSON.parse(localStorage.getItem(META_KEY));
      if (m) return Object.assign(defaultMeta(), m);
    } catch (e) {}
    return defaultMeta();
  }
  function defaultMeta() {
    return {
      sound: true, speed: 4, wins: 0, runs: 0, bestGame: 0, bestScore: 0,
      // profile / achievement tracking
      ach: {},                 // unlocked achievement ids
      career: { homers: 0, hits: 0, walks: 0, steals: 0, bossWins: 0, seedsUsed: 0, bestRally: 1, bestInningScore: 0, packsOpened: 0 },
      franchisesPlayed: {},    // ids ever played
      franchisesWon: {},       // ids whose full run was won
      discovered: {},          // ids of coaches / seeds / front-office vouchers ever acquired (Collection)
      maxStake: 1,             // highest difficulty stake unlocked (win a WS to unlock the next)
      lineupWins: {},          // lineup id -> highest stake won at
    };
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch (e) {} }
  // back-fill new META fields on older saves
  (function migrateMeta() {
    if (!META.ach) META.ach = {};
    if (!META.career) META.career = { homers: 0, hits: 0, walks: 0, steals: 0, bossWins: 0, seedsUsed: 0, bestRally: 1, bestInningScore: 0 };
    if (!META.franchisesPlayed) META.franchisesPlayed = {};
    if (!META.franchisesWon) META.franchisesWon = {};
    if (!META.discovered) META.discovered = {};
    if (!META.maxStake) META.maxStake = 1;
    if (!META.lineupWins) META.lineupWins = {};
    if (META.speed == null) META.speed = 4;   // animation speed 1..4 (4 = fastest = the old default)
    if (META.career.packsOpened == null) META.career.packsOpened = 0;
  })();
  // Collection: an item (coach / Salami Card / front-office voucher) is "discovered"
  // the first time you actually acquire it. Until then it shows locked in the Collection
  // and carries an "Undiscovered" tag in the shop.
  function isDiscovered(id) { return !!(META.discovered && META.discovered[id]); }
  function discover(id) {
    if (!id) return false;
    if (!META.discovered) META.discovered = {};
    if (META.discovered[id]) return false;
    META.discovered[id] = true;
    saveMeta();
    return true;
  }

  /* ---------------- top-level state ---------------- */
  const STATE = {
    screen: "title",
    run: null,
    game: null,
    rng: null,       // current game's rng
    busy: false,
    atBat: null,     // { card } - the batter who has stepped up, awaiting an approach
    shop: null,
    overlay: null,
  };

  /* ---------------- helpers: clone instances ---------------- */
  function cloneCard(tpl) {
    return {
      uid: uid("card"), id: tpl.id, name: tpl.name, nick: tpl.nick || null,
      bats: tpl.bats, contact: tpl.contact, power: tpl.power, eye: tpl.eye, speed: tpl.speed,
      tags: tpl.tags.slice(), edition: tpl.edition || null, rarity: tpl.rarity, cost: tpl.cost,
      trait: tpl.trait || null, deluxe: tpl.deluxe || null, _streak: 0,
    };
  }
  function cloneCoach(tpl) {
    return {
      uid: uid("coach"), id: tpl.id, name: tpl.name, fx: tpl.fx, trigger: tpl.trigger,
      icon: tpl.icon, text: tpl.text, rarity: tpl.rarity, cost: tpl.cost,
      deluxe: tpl.deluxe || null, aura: tpl.aura || 0,
      state: tpl.state ? JSON.parse(JSON.stringify(tpl.state)) : undefined,
    };
  }
  // deluxe-edition helpers
  const DELUXE_COACH_AURA = { allstar: 0.1, slugger: 0.15, goldglove: 0.2, hof: 0.25, legendary: 0.2 };
  function dugoutUsed(run) { return run.dugout.filter((c) => c.deluxe !== "legendary").length; }   // Legendary coaches take no slot
  function applyDeluxeToCoach(coach, ed) { coach.deluxe = ed; coach.aura = (coach.aura || 0) + (DELUXE_COACH_AURA[ed] || 0); }
  function rollDeluxe(rng) {
    const boost = (STATE.run && STATE.run.editionBoost) ? STATE.run.editionBoost * 0.07 : 0;
    return rng.chance(CONFIG.editionSpawnChance + boost) ? rng.weighted(EDITION_WEIGHTS) : null;
  }

  /* ---------------- run setup ---------------- */
  // Role tags that define a franchise's identity (positions/handedness excluded).
  const ROSTER_ROLE_TAGS = ["slugger", "contact", "speedster", "table-setter", "utility", "veteran", "rookie"];
  // A franchise's full roster: its signature players plus a themed bench of UNIQUE
  // fill players. No duplicate human beings on a starting roster - the only way to own
  // two of the same player is the Clone Project scouting card. The bench is scored by
  // how well each free agent matches the franchise's role mix (commons preferred,
  // legends never auto-fill) and is deterministic PER FRANCHISE, same every run.
  function rosterIdsFor(fr) {
    const target = CONFIG.startingDeckSize || fr.deck.length;
    const ids = fr.deck.slice();
    const have = new Set(ids);
    if (ids.length >= target) return ids.slice(0, target);
    const rng = makeRNG("roster:" + fr.id);
    const tagW = {};
    ids.forEach((id) => { const p = getPlayer(id); if (p) p.tags.forEach((t) => { if (ROSTER_ROLE_TAGS.indexOf(t) >= 0) tagW[t] = (tagW[t] || 0) + 1; }); });
    const bench = PLAYERS
      .filter((p) => !have.has(p.id) && p.rarity !== "legend")
      .map((p) => {
        let s = rng.float() * 3;                               // stable tie-break jitter
        p.tags.forEach((t) => { s += (tagW[t] || 0); });       // theme match
        s += p.rarity === "common" ? 6 : p.rarity === "star" ? 2 : 0;   // benches skew common
        return { id: p.id, s };
      })
      .sort((a, b) => b.s - a.s);
    while (ids.length < target && bench.length) ids.push(bench.shift().id);
    return ids;
  }
  function buildStartingDeck(fr) {
    return rosterIdsFor(fr).map((id) => cloneCard(getPlayer(id)));
  }
  function newRun(franchiseId, seed, stake) {
    const fr = FRANCHISES.find((f) => f.id === franchiseId) || FRANCHISES[0];
    stake = Math.max(1, Math.min(STAKES.length, stake || 1));
    const run = {
      seed: seed || randomSeed(),
      seeded: !!seed,        // a custom/replayed seed was supplied: this run earns NO achievements/progression
      franchiseId: fr.id,
      stake: stake,
      gameIndex: 0,
      payroll: CONFIG.economy.startingPayroll + (fr.startBonusPayroll || 0),
      deck: buildStartingDeck(fr),
      dugout: [],
      charms: [],            // owned consumable powerups (charm ids)
      achEarned: {},         // achievements already rewarded this run
      analytics: { power: 0, contact: 0, patience: 0, speed: 0, rally: 0 },
      upgradesOwned: [],
      bosses: [],
      // derived tunables (modifiable by upgrades)
      dugoutSlots: CONFIG.dugoutSlots,
      charmSlots: CONFIG.charmSlots,
      handSize: CONFIG.handSize,
      startRally: CONFIG.startingRally,
      discount: 0,
      extraCardSlots: 0,
      rerollDiscount: 0,
      interestCap: CONFIG.economy.interestCap,
      editionBoost: 0,       // Sabermetrics vouchers: extra edition spawn chance
      lastVoucherInning: -1, // a Front Office voucher can be bought once per inning
      tags: [],              // held skip tags awaiting a shop / boss payout
      skips: 0,              // frames skipped this run (Speed Tag scales off this)
      handBonusNext: 0,      // one-frame hand-size buff from a Lineup Tag
      rallyBonusNext: 0,     // one-frame starting-rally buff from a Rally Tag
      shopBuys: 0,
      actionLevels: { swing: 1, power: 1, contact: 1, bunt: 1, steal: 1 },  // Spring Training
      stat: { gamesWon: 0, homers: 0, bestInning: 0, bestScore: 0 },
    };
    if (fr.signatureCoach) { run.dugout.push(cloneCoach(getCoach(fr.signatureCoach))); discover(fr.signatureCoach); }
    // apply the lineup's effect (deltas on already-wired run tunables)
    const m = fr.mods || {};
    if (m.payroll) run.payroll += m.payroll;
    if (m.dugoutSlots) run.dugoutSlots += m.dugoutSlots;
    if (m.handSize) run.handSize += m.handSize;
    if (m.charmSlots) run.charmSlots += m.charmSlots;
    if (m.extraCardSlots) run.extraCardSlots += m.extraCardSlots;
    if (m.rerollDiscount) run.rerollDiscount += m.rerollDiscount;
    if (m.discount) run.discount += m.discount;
    if (m.startRally) run.startRally = m.startRally;
    if (m.noInterest) run.interestCap = 0;
    if (m.grantSalami) { const crng = makeRNG(run.seed + ":lineupseed"); for (let i = 0; i < m.grantSalami && run.charms.length < run.charmSlots; i++) { const ch = crng.pick(CHARMS); run.charms.push(ch.id); discover(ch.id); } }
    // the hardest stake shrinks your lineup card
    run.handSize = Math.max(1, run.handSize + stakeMods(stake).handDelta);
    // pre-roll the 8 boss rules so telegraphs match
    for (let r = 0; r < ROUNDS.length; r++) run.bosses.push(pickBoss(run, r));
    if (!seed) {   // seeded runs don't count toward lifetime stats / "play every franchise"
      META.runs += 1;
      META.franchisesPlayed[fr.id] = true;
      saveMeta(); checkCareerAch();
    }
    return run;
  }

  function randomSeed() {
    // real entropy is fine HERE (it only generates the seed string); the run itself
    // stays fully reproducible from the resulting seed.
    const t = Date.now().toString(36).toUpperCase().slice(-6);
    const r = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, "0");
    return "DD" + t + r;
  }

  function pickBoss(run, round) {
    const rng = makeRNG(run.seed + ":bosspick:" + round);
    let pool;
    if (round <= 2) pool = BOSSES.filter((b) => b.tier === 1);
    else if (round <= 4) pool = BOSSES.filter((b) => b.tier <= 2);
    else pool = BOSSES.filter((b) => b.tier === 2);
    // no repeat bosses within a run until the pool is exhausted (Balatro-style)
    const used = new Set((run.bosses || []).map((b) => b.id));
    const fresh = pool.filter((b) => !used.has(b.id));
    return rng.pick(fresh.length ? fresh : pool);
  }
  // boss for a given 0-based inning; rolls + caches Extra-Innings bosses on demand
  function bossFor(run, inningIdx) {
    while (run.bosses.length <= inningIdx) run.bosses.push(pickBoss(run, run.bosses.length));
    return run.bosses[inningIdx];
  }

  /* ---------------- pitcher factory ---------------- */
  const PFIRST = ["Cole", "Dustin", "Rafe", "Mort", "Lefty", "Cisco", "Buck", "Hoyt", "Dizzy", "Whip", "Sal", "Gus", "Cy", "Wade", "Lon"];
  const PLAST = ["Brennan", "Voss", "Carmody", "Pruitt", "Okafor", "Salazar", "Mathers", "Dolan", "Renko", "Kasprzak", "Ibarra", "Stenhouse", "Vance", "Nakai", "Quill"];

  function makePitcher(run, gameIndex) {
    const inning = Math.floor(gameIndex / GAMES_PER_ROUND);    // 0-based inning
    const frame = gameIndex % GAMES_PER_ROUND;                 // 0=Top, 1=Middle, 2=Boss
    const isBoss = frame === GAMES_PER_ROUND - 1;
    const rng = makeRNG(run.seed + ":pitcher:" + gameIndex);
    const pc = CONFIG.pitcher;
    const sb = stakeMods(run.stake).pitcherBonus;
    let stuff = pc.baseStuff + pc.stuffPerInning * inning + frame * pc.framePenalty + sb + rng.range(-3, 3);
    let command = pc.baseCommand + pc.commandPerInning * inning + frame * (pc.framePenalty * 0.8) + sb + rng.range(-3, 3);
    let rule = null, name, boss = null;
    if (isBoss) {
      boss = bossFor(run, inning);
      rule = boss.rule;
      stuff += pc.bossStuffBonus;
      command += pc.bossCommandBonus;
      name = boss.name;
    } else {
      name = rng.pick(PFIRST) + " " + rng.pick(PLAST);
    }
    let throws = rule === "leftySpecialist" ? "L" : rng.pick(["L", "R"]);
    let lean = rule === "groundball" ? -0.6 : rng.range(-0.3, 0.3);
    return {
      name, isBoss, rule, boss,
      bats: throws,
      stuff: Math.max(5, Math.min(99, Math.round(stuff))),
      command: Math.max(5, Math.min(99, Math.round(command))),
      groundFlyLean: lean,
      targetMultiplier: rule === "ace" ? (CONFIG.aceTargetMult || 1.25) : 1,
    };
  }

  /* ---------------- start a game ---------------- */
  function startGame() {
    const run = STATE.run;
    const gi = run.gameIndex;
    const pitcher = makePitcher(run, gi);
    const rng = makeRNG(run.seed + ":game:" + gi);
    STATE.rng = rng;

    let outs = CONFIG.outsPerGame;
    if (pitcher.rule === "closer") outs = 2; // the Closer: only 2 outs this inning
    const baseTarget = targetFor(gi);
    const target = Math.round(baseTarget * pitcher.targetMultiplier);

    const deck = run.deck.map((c) => c); // reference copies (prospect growth persists to run.deck)
    rng.shuffle(deck);

    // one-frame buffs from skip tags (Lineup = +hand, Rally = +starting rally), consumed here
    const handSize = run.handSize + (run.handBonusNext || 0);
    const startRally = run.startRally + (run.rallyBonusNext || 0);
    if (run.handBonusNext || run.rallyBonusNext) { run.handBonusNext = 0; run.rallyBonusNext = 0; saveRun(); }

    const game = {
      pitcher,
      outsRemaining: outs,
      outsMax: outs,
      outsThisInning: 0,
      handSize,
      rally: startRally,
      startRally: startRally,
      score: 0,
      target,
      runsScored: 0,
      inning: 1,
      inningPA: 0,
      inningLeadReached: false,
      consecutiveSafe: 0,
      lastWasSlugger: false,
      bases: [null, null, null],
      deck,
      hand: [],
      discard: [],
      isBoss: pitcher.isBoss,
      gameIndex: gi,
      log: [],
      ended: false,
      result: null,
    };
    // reset per-game scaling coach flags
    for (const c of run.dugout) {
      if (c.fx === "hotStreak" && c.state) c.state.homerThisGame = false;
    }
    // draw opening hand
    STATE.game = game;
    drawToHand();
    STATE.screen = "game";
    render();
    // little intro flash
    pushLog(`${icon("chevronR")} ${gameLabel(gi)} - facing ${pitcher.name}. Target ${target}.`, "neutral");
    saveGame();
  }

  function drawCard() {
    const g = STATE.game;
    if (g.deck.length === 0) {
      if (g.discard.length === 0) return null;
      g.deck = g.discard;
      g.discard = [];
      STATE.rng.shuffle(g.deck);
    }
    return g.deck.pop();
  }
  function drawToHand() {
    const g = STATE.game;
    while (g.hand.length < (g.handSize || STATE.run.handSize)) {
      const c = drawCard();
      if (!c) break;
      g.hand.push(c);
    }
  }

  /* ---------------- the at-bat loop ---------------- */
  // Step 1 - drag a batter into the box (or press 1-8): they "step up" and the swing
  // buttons appear inline in the at-bat bar (no popup).
  function selectBatter(handIndex) {
    if (STATE.busy || !STATE.game || STATE.game.ended) return;
    const card = STATE.game.hand[handIndex];
    if (!card) return;
    SFX.resume(); SFX.deal();
    STATE.atBat = { card, idx: handIndex };
    if (TIP) TIP.hide();
    markPicking();
    renderAtBatBar();
  }
  function cancelAtBat() { STATE.atBat = null; markPicking(); renderAtBatBar(); }

  // rough steal success % (mirrors the engine) for the Send button label
  function stealOdds(runner, fromBase) {
    const burner = runner.card && runner.card.trait === "burner";
    let p = (runner.speed - 50) * 0.013 + 0.25;
    if (fromBase === 2) p = Math.max(0.05, Math.min(0.55, p - 0.42 + (burner ? 0.18 : 0)));   // steal of home: long odds
    else p = Math.max(0.35, Math.min(0.97, p + (burner ? 0.22 : 0)));
    return Math.round(p * 100);
  }
  // the swing controls shown inline in the at-bat bar once a batter has stepped up
  function atBatControlsHTML(card) {
    const aps = CONFIG.approaches;
    const g = STATE.game;
    const tr = getTrait(card.trait);
    const traitTag = tr ? `<span class="trait-chip" data-tip="<b>${tr.name}</b><br>${tr.desc}">${icon(tr.icon)}</span>` : "";
    const streak = (card._streak || 0) >= 2 ? `<span class="streak-chip hot" data-tip="<b>Hot streak</b><br>Boosted hitting stats while hot.">${icon("flame")}</span>` : (card._streak || 0) <= -2 ? `<span class="streak-chip cold" data-tip="<b>Cold streak</b><br>Reduced hitting stats while cold.">${icon("snowflake")}</span>` : "";
    const lvBadge = (id) => { const lv = (STATE.run.actionLevels && STATE.run.actionLevels[id]) || 1; return lv > 1 ? ` <span class="ap-lv" title="Spring Training level ${lv}">Lv${lv}</span>` : ""; };
    const btn = (a) => `<button class="approach-btn ap-${a.id}" data-approach="${a.id}"><span class="ap-icon">${icon(a.icon)}</span><span class="ap-name">${a.name}${lvBadge(a.id)}</span><span class="ap-desc">${a.desc}</span></button>`;
    const runnersOn = g.bases.some(Boolean);
    const buntBtn = runnersOn ? `<button class="tactic-btn ap-bunt" data-approach="bunt" title="Sacrifice - trade an out to push your runners up a base. Fast hitters sometimes beat it out.">${icon("chevronsDown")} Bunt${lvBadge("bunt")}</button>` : "";
    let sends = "";
    [0, 1, 2].forEach((fb) => {
      const r = g.bases[fb];
      if (!r) return;
      if (fb < 2 && g.bases[fb + 1]) return;   // next base must be open (home is always "open")
      const label = fb === 2 ? "Steal HOME" : "Send " + shortName(r.name);
      const tip = fb === 2 ? "Steal home - the ultimate gamble. It scores a run, but caught = an out!" : `Steal ${fb === 0 ? "second" : "third"} - caught = an out!`;
      sends += `<button class="tactic-btn send-btn${fb === 2 ? " send-home" : ""}" data-send="${fb}" title="${tip}">${icon("arrowUpRight")} ${label} <b>${stealOdds(r, fb)}%</b>${lvBadge("steal")}</button>`;
    });
    // Cancel lives with the tactics (under Bunt / Send) instead of a corner X.
    const cancelBtn = `<button class="tactic-btn ab-cancel-btn" data-act="cancel-atbat" title="Put this batter back and pick someone else">${icon("close")} Cancel</button>`;
    const tactics = `<div class="tactics-row">${buntBtn}${sends}${cancelBtn}</div>`;
    return `<div class="ab-active">
        <div class="ab-head"><b>${shortName(card.name)}</b> steps up ${traitTag} ${streak}</div>
        <div class="ab-controls">
          <div class="approach-row">${btn(aps.swing)}${btn(aps.power)}${btn(aps.contact)}</div>
          ${tactics}
        </div>
      </div>`;
  }
  // the idle drop-box on the right that you drag a batter into
  function batZoneHTML() {
    return `<div class="ab-idle">
        <div class="bat-zone" id="bat-zone">
          <span class="bz-icon">${icon("bat")}</span>
          <span class="bz-text"><b>Drop batter here</b><span>drag a card to step up</span></span>
        </div>
      </div>`;
  }
  function renderAtBatBar() {
    const bar = $("#atbat-bar");
    if (!bar) return;
    if (STATE.atBat) {
      bar.classList.add("active");
      bar.innerHTML = atBatControlsHTML(STATE.atBat.card);
      bar.classList.remove("pop"); void bar.offsetWidth; bar.classList.add("pop");
    } else {
      bar.classList.remove("active");
      bar.innerHTML = batZoneHTML();
    }
  }

  // ACTIVE steal - the player Sends a runner. Caught = an out (precious!).
  async function sendRunner(fromBase) {
    if (STATE.busy || !STATE.game || STATE.game.ended) return;
    const g = STATE.game, run = STATE.run;
    STATE.busy = true;
    try {
      const res = Engine.attemptSteal(g, run, STATE.rng, fromBase);
      if (res && res.ok) {
        SFX.steal();
        renderDiamond();
        if (res.caught) {
          SFX.out();
          pushLog(`${icon("out")} Caught stealing - ${res.runner.name} is out!`, "bad");
          setReadout("CAUGHT STEALING", "bad", { batterName: res.runner.name, platoon: "neutral" }, "Out on the basepaths.");
        } else {
          const to = res.to === 1 ? "2nd" : res.to === 2 ? "3rd" : "HOME";
          pushLog(`${icon("arrowUpRight")} ${res.runner.name} steals ${to}!`, "steal");
          if (res.runs) { popRuns(res.runs); stampOutcome("STOLE HOME", "huge", "SB", false); screenShake("big"); }
          if (res.rallyBonus) animateRally({ rallyDelta: res.rallyBonus });
          (res.triggers || []).forEach(flashCoachByFx);
          g.steals = (g.steals || 0) + 1; if (!runIsSeeded()) META.career.steals++;
          if (g.steals >= 3) awardAchievement("thief");
          if (res.to === 3) awardAchievement("steal_home");
          saveMeta(); checkCareerAch();
        }
        await sleep(380);
        renderGame();
        if (g.outsRemaining <= 0) {
          await sleep(220);
          return g.score >= g.target ? onWin() : onLose();
        }
        saveGame();
      }
    } finally {
      STATE.busy = false;
    }
    refreshAtBat();
  }
  // highlight the chosen batter in the hand (and dim the rest) while the popup is open
  function markPicking() {
    const app = $("#app");
    if (app) app.classList.toggle("has-atbat", !!STATE.atBat);
    const hand = $("#hand");
    if (!hand) return;
    hand.classList.toggle("picking", !!STATE.atBat);
    $$(".card", hand).forEach((el) => {
      const sel = STATE.atBat && STATE.atBat.card.uid === el.getAttribute("data-uid");
      el.classList.toggle("selected", !!sel);
    });
  }
  function refreshAtBat() {
    markPicking();
    renderAtBatBar();
  }

  // Step 2 - choose an approach: resolve the plate appearance with that swing profile.
  async function commitAtBat(approach) {
    if (STATE.busy || !STATE.atBat || !STATE.game || STATE.game.ended) return;
    const g = STATE.game, run = STATE.run;
    const card = STATE.atBat.card;
    const idx = g.hand.indexOf(card);
    if (idx < 0) { STATE.atBat = null; renderGame(); return; }
    STATE.busy = true;
    try {
      STATE.atBat = null;
      markPicking();
      renderAtBatBar();

      // remove from hand -> discard (fly the card toward the plate for a little juice)
      const cardEl = $(`#hand .card[data-uid="${card.uid}"]`);
      if (cardEl) { cardEl.classList.add("playing"); }
      g.hand.splice(idx, 1);
      g.discard.push(card);
      await sleep(110);

      // resolve with the chosen approach
      const ev = Engine.resolveAtBat(card, g.pitcher, g, run, STATE.rng, approach || "swing");
      await animateResult(ev, card);

      drawToHand();
      Engine.maybeAdvanceInning(g);
      renderGame();

      if (g.score >= g.target) { await sleep(250); return onWin(); }
      if (g.outsRemaining <= 0) { await sleep(250); return onLose(); }
      saveGame();
    } finally {
      // never leave the table soft-locked, even if something above throws
      STATE.busy = false;
    }
  }

  // convenience for debug/auto-play: select + commit in one shot.
  async function playAB(handIndex, approach) {
    if (STATE.busy || !STATE.game || STATE.game.ended) return;
    const card = STATE.game.hand[handIndex];
    if (!card) return;
    STATE.atBat = { card };
    return commitAtBat(approach || "swing");
  }

  /* ---------------- result animation ---------------- */
  const OUTCOME_LABEL = {
    K: "STRIKEOUT", BB: "WALK", HBP: "HIT BY PITCH", OUT_GB: "GROUND OUT", OUT_FB: "FLY OUT",
    "1B": "SINGLE", "2B": "DOUBLE", "3B": "TRIPLE", HR: "HOME RUN",
  };
  const OUTCOME_CLASS = {
    K: "bad", BB: "ok", HBP: "ok", OUT_GB: "bad", OUT_FB: "bad",
    "1B": "good", "2B": "great", "3B": "great", HR: "huge",
  };

  async function animateResult(ev, card) {
    const g = STATE.game;
    const o = ev.outcome;
    g.lastOutcome = o;

    // sound + screen-shake juice (shake scales with the result)
    if (o === "HR") { SFX.homer(); screenShake(ev.runsOnPlay >= 4 ? "huge" : "big"); flashScreen("huge"); }
    else if (o === "2B" || o === "3B") { SFX.xbh(); screenShake("big"); }
    else if (o === "1B") { SFX.single(); screenShake("sm"); }
    else if (o === "BB" || o === "HBP") SFX.walk();
    else if (o === "K") { SFX.strikeout(); screenShake("sm"); }
    else SFX.out();
    // outcome stamp punches in, color-coded; a ball arcs onto the field on contact
    stampOutcome(OUTCOME_LABEL[o] || o, OUTCOME_CLASS[o] || "neutral", o, ev.runsOnPlay >= 4);
    if (o === "1B" || o === "2B" || o === "3B" || o === "HR") ballFlight(o);

    // ---- achievements & career stats ----
    const isHit = (o === "1B" || o === "2B" || o === "3B" || o === "HR");
    const seeded = runIsSeeded();   // seeded runs accrue no lifetime/career stats
    if (isHit) {
      g.hits = (g.hits || 0) + 1; if (!seeded) META.career.hits++;
      g.inningTypes = g.inningTypes || {}; g.inningTypes[o] = true;
      if (g.hits >= 5) awardAchievement("five_hits");
      if (g.inningTypes["1B"] && g.inningTypes["2B"] && g.inningTypes["3B"] && g.inningTypes["HR"]) awardAchievement("the_cycle");
    }
    if (o === "HR") {
      g.homers = (g.homers || 0) + 1; if (!seeded) META.career.homers++;
      if (ev.runsOnPlay >= 4) awardAchievement("grand_slam");
      if (g.homers >= 2) awardAchievement("long_ball");
      if (g.homers >= 3) awardAchievement("three_hr");
    } else if (o === "BB") {
      g.walks = (g.walks || 0) + 1; if (!seeded) META.career.walks++;
      if (g.walks >= 3) awardAchievement("patient_eye");
    }
    if (ev.scoreGained >= 15 * (CONFIG.scoreScale || 1)) awardAchievement("big_swing");
    if (!seeded && g.rally > (META.career.bestRally || 1)) META.career.bestRally = g.rally;
    if (!seeded && g.score > (META.career.bestInningScore || 0)) META.career.bestInningScore = g.score;
    saveMeta(); checkCareerAch();

    // readout
    const cls = OUTCOME_CLASS[o] || "neutral";
    let math = "";
    if (ev.isSafe && ev.bagValue > 0) {
      math = `Bag ${trim(ev.bagValue)} × Rally ${ev.rallyUsed.toFixed(1)} = <b>+${ev.scoreGained}</b>`;
    } else if (ev.productiveOut && ev.runsOnPlay > 0) {
      math = `Productive out - ${ev.runsOnPlay} run scored`;
    } else if (ev.doublePlay) {
      math = `Double play - two outs!`;
    } else {
      math = ev.isSafe ? "" : (g.rally > g.startRally + 0.01 ? `Out - rally holds at ×${g.rally.toFixed(1)}` : "Out.");
    }
    setReadout(OUTCOME_LABEL[o] || o, cls, ev, math);

    // diamond update + run pops
    renderDiamond();
    if (ev.runsOnPlay > 0) popRuns(ev.runsOnPlay);

    // score + progress
    bumpScore(ev.scoreGained);
    // rally
    animateRally(ev);

    // coach flashes
    (ev.triggers || []).forEach((t) => {
      if (t.indexOf("coach:") === 0) flashCoachById(t.slice(6));
    });
    if (ev.payrollGained > 0) { SFX.coin(); flashPayrollGain(ev.payrollGained); }

    // log entry
    logEvent(ev);

    await sleep(o === "HR" ? 620 : 460);
  }

  function trim(n) { return Number.isInteger(n) ? "" + n : n.toFixed(1); }

  function screenShake(level) {
    const el = $("#app");   // NOT #stage (it carries the fit transform: scale)
    if (!el) return;
    // accept legacy boolean (true = big) or a level string ("sm" | "big" | "huge")
    const lvl = level === true ? "big" : level === false ? "sm" : (level || "sm");
    const cls = "shake-" + lvl;
    ["shake-sm", "shake-big", "shake-huge"].forEach((c) => el.classList.remove(c));
    void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), pace(620));
  }
  // a big color-coded outcome word that punches onto the screen with a scale-bounce
  function stampOutcome(label, cls, outcome, grand) {
    const host = $("#stage") || document.body;
    const d = document.createElement("div");
    d.className = "outcome-stamp os-" + cls + (outcome === "HR" ? " os-hr" : "") + (grand ? " os-grand" : "");
    d.textContent = grand && outcome === "HR" ? "GRAND SLAM" : label;
    host.appendChild(d);
    setTimeout(() => d.remove(), pace(outcome === "HR" ? 1150 : 820));
  }
  // a ball arcs from the plate out onto the field; the path/height scales with the hit
  function ballFlight(outcome) {
    const dia = $(".diamond");
    if (!dia) return;
    const b = document.createElement("div");
    b.className = "ball-fly bf-" + outcome;
    dia.appendChild(b);
    if (outcome === "HR") {
      const flash = document.createElement("div");
      flash.className = "hr-flash";
      dia.appendChild(flash);
      setTimeout(() => flash.remove(), pace(900));
    }
    setTimeout(() => b.remove(), pace(outcome === "HR" ? 1100 : 900));
  }
  // confetti + a little trophy pop, for winning a run (the World Series)
  function confettiBurst(n) {
    const host = $("#stage") || document.body;
    const wrap = document.createElement("div");
    wrap.className = "confetti-wrap";
    const colors = ["#ffcb47", "#56b4ff", "#ff7a59", "#5ad17a", "#b66cff", "#ffffff"];
    const count = n || 70;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("i");
      const hue = colors[i % colors.length];
      const left = (i / count) * 100;
      const delay = (i % 10) * 40;
      const dur = 1700 + (i % 7) * 220;
      const rot = (i * 47) % 360;
      p.style.cssText = `left:${left}%; background:${hue}; animation-delay:${delay}ms; animation-duration:${dur}ms; --rot:${rot}deg;`;
      wrap.appendChild(p);
    }
    host.appendChild(wrap);
    setTimeout(() => wrap.remove(), 3600);
  }
  // tween a number element from its current value up to `to` (Balatro-style count-up)
  function tickNumber(el, to, dur) {
    if (!el) return;
    const from = parseInt(("" + el.textContent).replace(/[^0-9-]/g, ""), 10) || 0;
    to = Math.round(to);
    if (from === to) { el.textContent = to; return; }
    const start = performance.now();
    dur = (dur || 450) * speedScale();   // slower count-up at lower speeds
    (function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = t * (2 - t); // ease-out
      el.textContent = Math.round(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = to;
    })(start);
  }
  function flashScreen(kind) {
    let f = $("#screen-flash");
    if (!f) { f = document.createElement("div"); f.id = "screen-flash"; const st = document.getElementById("stage"); (st || document.body).appendChild(f); }
    f.className = "show " + (kind || "");
    setTimeout(() => { f.className = ""; }, pace(400));
  }

  /* ---------------- win / lose ---------------- */
  // Cross-game scaling coaches that resolve at the end of a game (Hot Streak).
  function processEndOfGameScaling(run) {
    for (const c of run.dugout) {
      if (c.fx === "hotStreak" && c.state) {
        if (c.state.homerThisGame) c.state.bonus = +(c.state.bonus + 0.5).toFixed(2);
        else c.state.bonus = 0;
      }
    }
  }

  function onWin() {
    const g = STATE.game, run = STATE.run;
    g.ended = true; g.result = "win";
    STATE.busy = false;
    // ---- win achievements ----
    awardAchievement("first_win");
    if ((g.outsThisInning || 0) === 0) awardAchievement("perfect_inning");   // cleared with no outs
    if (g.outsRemaining <= 1) awardAchievement("comeback");                   // won on the final out
    if (g.lastOutcome === "HR") awardAchievement("walkoff");                  // walk-off homer
    if (g.isBoss) {
      if (!runIsSeeded()) META.career.bossWins++;
      run.bossWins = (run.bossWins || 0) + 1;
      if (run.bossWins >= 3) awardAchievement("boss_sweep");
    }
    if (isExtraInnings(g.gameIndex)) unlockAchievement("extra_frame");
    if (run.deck.length <= 12) unlockAchievement("thin_deck");
    saveMeta(); checkCareerAch();
    processEndOfGameScaling(run);
    SFX.win();

    const eco = CONFIG.economy;
    const round = Math.floor(g.gameIndex / GAMES_PER_ROUND);
    let base = eco.winRewardBase + eco.winRewardPerRound * round + (g.isBoss ? eco.bossBonus : 0);
    let frugal = 0;
    if (Engine.hasCoach(run, "frugalFO")) frugal = Math.max(0, g.outsRemaining) * eco.perLeftoverOut;
    const interest = Math.min(run.interestCap, Math.floor(run.payroll / eco.interestPer));

    const breakdown = [
      { label: "Win reward", amt: base },
      { label: "Interest", amt: interest },
    ];
    if (frugal > 0) breakdown.push({ label: `Frugal FO (${g.outsRemaining} outs left)`, amt: frugal });
    // held Boss tags (Investment) pay out now that a Boss has been beaten
    let bossTagBonus = 0;
    if (g.isBoss && run.tags && run.tags.length) {
      const keep = [];
      for (const id of run.tags) {
        const t = getTag(id);
        if (t && t.when === "boss") { bossTagBonus += (t.fx.amt || 0); breakdown.push({ label: t.name, amt: t.fx.amt || 0 }); }
        else keep.push(id);
      }
      run.tags = keep;
    }
    const total = base + interest + frugal + bossTagBonus;
    run.payroll += total;

    // stats (per-run always; career/lifetime records skip seeded runs)
    run.stat.gamesWon += 1;
    if (g.score > (run.stat.bestScore || 0)) run.stat.bestScore = g.score;
    if (!runIsSeeded()) {
      if (g.score > (META.bestScore || 0)) META.bestScore = g.score;
      META.bestGame = Math.max(META.bestGame || 0, g.gameIndex);
      saveMeta();
    }

    // advance the bracket
    run.gameIndex += 1;
    saveRun();
    clearGameSave(); // the frame is over; the next one starts fresh on Play Ball

    // beat inning 8's Boss for the first time -> World Series; then you may push into Extra Innings
    if (run.gameIndex === ROUNDS.length * GAMES_PER_ROUND && !run.wonWS) {
      run.wonWS = true;
      // seeded runs still get the victory screen + Extra Innings, but no career win / stake unlock
      if (!runIsSeeded()) {
        META.wins += 1;
        META.franchisesWon[run.franchiseId] = true;
        // record the best stake won with this lineup, and unlock the next stake
        const st = run.stake || 1;
        if (st > (META.lineupWins[run.franchiseId] || 0)) META.lineupWins[run.franchiseId] = st;
        if (st >= (META.maxStake || 1)) META.maxStake = Math.min(STAKES.length, st + 1);
        if (st >= 3) unlockAchievement("stake_3");
        if (st >= 5) unlockAchievement("stake_5");
        saveMeta(); checkCareerAch();
      }
      saveRun();
      return showVictory();
    }
    showWinOverlay(g, breakdown, total);
  }

  function onLose() {
    const g = STATE.game;
    g.ended = true; g.result = "lose";
    STATE.busy = false;
    SFX.lose();
    META.bestGame = Math.max(META.bestGame || 0, g.gameIndex);
    saveMeta();
    clearSave();
    showGameOver(g);
  }

  /* ============================================================
     SKIP TAGS  (Balatro-style: skip a frame, pocket a tag)
     ============================================================ */
  function isSkippable(gi) { return !isBossInning(gi); }   // Top & Middle skippable; a Boss must be played
  function tagFor(gi) {
    // deterministic per frame, so the previewed tag is exactly the one you earn.
    // weighted by rarity so the legendary tags actually feel legendary.
    const W = { common: 100, star: 45, allstar: 16, legendary: 4 };
    const pool = TAGS.map((t) => ({ v: t, w: W[t.rarity] || 40 }));
    return makeRNG(STATE.run.seed + ":tag:" + gi).weighted(pool);
  }
  function skipFrame() {
    const run = STATE.run, gi = run.gameIndex;
    if (!isSkippable(gi)) { SFX.error(); toast("You cannot skip a Boss frame."); return; }
    const tag = tagFor(gi);
    run.skips = (run.skips || 0) + 1;
    if (run.skips >= 3) unlockAchievement("skip_3");
    discover(tag.id);
    applyTag(tag);
    run.gameIndex += 1;     // advance past the skipped frame: no win reward, no shop
    clearGameSave();
    saveRun();
    render();               // stay on the map, now showing the next frame
  }
  function applyTag(tag) {
    const run = STATE.run, fx = tag.fx || {};
    if (tag.when !== "instant") { run.tags.push(tag.id); SFX.coin && SFX.coin(); toast(`${tag.name} earned. ${tag.when === "boss" ? "Pays out after the next Boss." : "Resolves at the next shop."}`); return; }
    if (fx.kind === "money") run.payroll += fx.amt;
    else if (fx.kind === "speedMoney") run.payroll += fx.amt * (run.skips || 1);
    else if (fx.kind === "double") run.payroll += Math.min(fx.cap || 40, run.payroll);
    else if (fx.kind === "levelAction") { const ks = Object.keys(run.actionLevels); const k = makeRNG(run.seed + ":tagact:" + run.skips).pick(ks); run.actionLevels[k] += (fx.amt || 1); }
    else if (fx.kind === "handNext") run.handBonusNext = (run.handBonusNext || 0) + (fx.amt || 1);
    else if (fx.kind === "rallyNext") run.rallyBonusNext = (run.rallyBonusNext || 0) + (fx.amt || 0);
    else if (fx.kind === "freeCoaches") grantFreeCoaches(fx.amt || 1, "common");
    SFX.coin && SFX.coin();
    toast(`${tag.name}: ${tag.text}`);
  }
  function grantFreeCoaches(n, rarity) {
    const run = STATE.run;
    const rng = makeRNG(run.seed + ":freecoach:" + run.skips);
    let added = 0;
    for (let i = 0; i < n; i++) {
      if (dugoutUsed(run) >= run.dugoutSlots) break;
      const choices = COACHES.filter((c) => (!rarity || c.rarity === rarity) && !run.dugout.some((d) => d.fx === c.fx));
      if (!choices.length) break;
      const c = rng.pick(choices);
      run.dugout.push(cloneCoach(c)); discover(c.id); added++;
    }
    if (added < n) toast("Dugout was too full for every free coach.");
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  function render() {
    const root = $("#app");
    if (STATE.screen === "title") root.innerHTML = renderTitle();
    else if (STATE.screen === "game") root.innerHTML = renderGameScreen();
    else if (STATE.screen === "shop") root.innerHTML = renderShop();
    else if (STATE.screen === "map") root.innerHTML = renderMap();
    wireScreen();
    if (STATE.screen === "game") { renderGame(); }
    else if (STATE.run && (STATE.screen === "map" || STATE.screen === "shop")) {
      // the persistent run frame's chip rows are filled by the live updaters
      renderDugout(); renderPowerups();
    }
    // the menu button only makes sense once a run is underway (title is the main menu)
    const mb = document.getElementById("menu-btn");
    if (mb) mb.style.display = STATE.screen === "title" ? "none" : "";
  }

  /* ---------- title ---------- */
  function renderTitle() {
    const hasSave = !!localStorage.getItem(SAVE_KEY);
    if (STATE._pickIndex == null) STATE._pickIndex = 0;
    if (STATE._replayFranchise) { const ri = FRANCHISES.findIndex((f) => f.id === STATE._replayFranchise); if (ri >= 0) STATE._pickIndex = ri; }
    if (STATE._pickStake == null) STATE._pickStake = 1;
    STATE._pickStake = Math.max(1, Math.min(STATE._pickStake, META.maxStake || 1));
    return `
    <div class="screen title-screen">
      <div class="title-hero">
        ${(typeof logoSVG === "function")
          ? `<div class="logo logo-svg">${logoSVG()}</div>`
          : `<div class="logo"><span class="logo-diamond">${icon("diamond")}</span><h1>DIAMOND<span>DUEL</span></h1></div>`}
      </div>
      ${hasSave ? `<div class="continue-row"><button class="btn btn-big btn-gold" data-act="continue">Continue Run</button><button class="btn btn-ghost" data-act="abandon">Abandon</button></div>` : ""}
      <h2 class="pick-h">Choose your lineup</h2>
      ${STATE._replaySeed ? `<div class="seed-hint replay">${icon("replay")} Replaying <code>${escAttr(STATE._replaySeed)}</code></div>` : ""}
      ${renderLineupCarousel()}
      <div class="title-foot">
        <div class="foot-btns">
          <button class="btn btn-foot" data-act="open-profile">${icon("trophy")} Profile</button>
          <button class="btn btn-foot" data-act="howto">${icon("help")} How to Play</button>
          <button class="btn btn-foot" data-act="open-stats">${icon("stats")} Stats</button>
          <button class="btn btn-foot btn-icon" data-act="toggle-sound" aria-label="Toggle sound" title="Sound: ${META.sound ? "On" : "Off"}">${META.sound ? icon("soundOn") : icon("soundOff")}</button>
        </div>
        <span class="foot-stats">${META.wins} ${META.wins === 1 ? "championship" : "championships"} · ${META.runs} runs · best ${META.bestScore || 0}</span>
        <span class="foot-version">v1.0</span>
      </div>
    </div>`;
  }

  // Balatro-style lineup + difficulty carousel (one lineup shown at a time)
  function renderLineupCarousel() {
    const idx = STATE._pickIndex || 0;
    const f = FRANCHISES[idx];
    const stake = STATE._pickStake || 1;
    const maxStake = META.maxStake || 1;
    const coach = f.signatureCoach ? getCoach(f.signatureCoach) : null;
    const ids = rosterIdsFor(f);   // average the FULL 30-man roster (starters + bench), not just the stars
    const totals = ids.reduce((a, id) => { const p = getPlayer(id); a.c += p.contact; a.p += p.power; a.e += p.eye; a.s += p.speed; return a; }, { c: 0, p: 0, e: 0, s: 0 });
    const n = ids.length, mini = (v) => Math.round(v / n);
    const bestStake = META.lineupWins[f.id] || 0;
    const dots = FRANCHISES.map((_, i) => `<span class="lc-dot ${i === idx ? "on" : ""}" data-lineup-dot="${i}"></span>`).join("");
    const stakeBtns = STAKES.map((s) => {
      const locked = s.id > maxStake, sel = s.id === stake;
      return `<button class="stake-btn st-${s.id} ${sel ? "sel" : ""} ${locked ? "locked" : ""}" data-stake="${s.id}" title="${s.name}">${locked ? icon("lock") : s.id}</button>`;
    }).join("");
    const cur = STAKES[stake - 1];
    const unlockHint = (stake === maxStake && maxStake < STAKES.length) ? `<div class="stake-unlock">Win the World Series here to unlock ${STAKES[stake].name}.</div>` : "";
    return `
      <div class="lineup-carousel">
        <button class="lc-arrow" data-act="prev-lineup" aria-label="Previous lineup">${icon("chevronL")}</button>
        <div class="lc-card">
          ${bestStake ? `<div class="lc-best" title="Best stake won">${icon("trophy")} ${STAKES[bestStake - 1].name}</div>` : ""}
          <div class="lc-num">${idx + 1} / ${FRANCHISES.length}</div>
          ${(typeof crestSVG === "function") ? `<div class="lc-crest">${crestSVG(f)}</div>` : ""}
          <h3>${f.name}</h3>
          <p class="lc-tag">${f.tagline}</p>
          <div class="fr-stats lc-stats">
            ${miniStat("CON", mini(totals.c))}${miniStat("POW", mini(totals.p))}${miniStat("EYE", mini(totals.e))}${miniStat("SPD", mini(totals.s))}
          </div>
          <div class="lc-effect"><span class="fr-star">${icon(coach ? coach.icon : "star")}</span> ${f.bonusText}</div>
        </div>
        <button class="lc-arrow" data-act="next-lineup" aria-label="Next lineup">${icon("chevronR")}</button>
      </div>
      <div class="lc-dots">${dots}</div>
      <div class="stake-row">
        <span class="stake-label">Difficulty</span>
        <div class="stake-btns">${stakeBtns}</div>
        <span class="stake-name st-${stake}">${cur.name}</span>
      </div>
      <div class="stake-desc">${cur.text}</div>
      ${unlockHint}
      <div class="lc-start">
        <div class="lc-seed"><label>Seed <span>(optional)</span></label><input id="fr-seed" class="seed-input" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="random" value="${STATE._replaySeed ? escAttr(STATE._replaySeed) : ""}" /></div>
        <button class="btn btn-big btn-gold" data-act="confirm-start">Play Ball ${icon("chevronR")}</button>
      </div>`;
  }

  function miniStat(label, v) {
    return `<div class="mini-stat"><span class="ms-l">${label}</span><div class="ms-bar"><div class="ms-fill ${barClass(label)}" style="width:${v}%"></div></div><span class="ms-v">${v}</span></div>`;
  }
  function barClass(l) { return ({ CON: "b-contact", POW: "b-power", EYE: "b-eye", SPD: "b-speed", C: "b-contact", P: "b-power", E: "b-eye", S: "b-speed" })[l] || ""; }

  /* ---------- the persistent run frame (Balatro-style chrome) ---------- */
  // EVERY in-run screen (game / map / shop) shares the same fixed chrome: a left
  // sidebar (matchup, target, score, outs, payroll, Deck/Menu) and a top band with
  // the DUGOUT and SALAMI rows as LARGE art cards, always in the same place.
  // The rows keep the live ids (#dugout / #powerups) so the in-game updaters,
  // tooltips, taps, drags, corner sells, and coach trigger flashes all just work.
  function runTopHTML() {
    const run = STATE.run;
    if (!run) return "";
    return `<div class="run-top">
        <div class="rt-group rt-dugout">
          <button class="rt-label panel-btn" data-act="open-dugout" title="Open the Dugout (sell any time)">DUGOUT <span class="pt-n" id="pt-dugout">${dugoutUsed(run)}/${run.dugoutSlots}</span></button>
          <div class="rt-chips" id="dugout"></div>
        </div>
        <div class="rt-group rt-salami">
          <button class="rt-label panel-btn" data-act="open-salami" title="Open the Salami pouch (sell any time)">SALAMI <span class="pt-n" id="pt-salami">${run.charms.length}/${run.charmSlots}</span></button>
          <div class="rt-chips" id="powerups"></div>
        </div>
      </div>`;
  }
  function runSideHTML(ctx) {
    const run = STATE.run;
    if (!run) return "";
    const gi = run.gameIndex;
    const fr = FRANCHISES.find((f) => f.id === run.franchiseId);
    let head = "", body = "";
    if (ctx === "game") {
      body = `
        <div class="sd-round" id="sb-round"></div>
        <div class="sd-blind" id="sd-blind">
          <div class="sd-vs" id="sb-vs">NOW PITCHING</div>
          <div class="sd-pitcher" id="sb-pitcher"></div>
          <div class="sd-rule" id="sb-rule"></div>
        </div>
        <div class="sd-target"><span class="sd-cap">SCORE AT LEAST</span><b id="sb-target">0</b></div>
        <div class="sd-score"><span class="sd-cap">ROUND SCORE</span><b id="sb-score">0</b>
          <div class="sb-progress"><div class="sb-progress-fill" id="sb-progress"></div></div>
          <div class="sd-runs">Runs this inning: <b id="sb-runs">0</b></div>
        </div>
        <div class="sd-duo">
          <div class="sd-cell"><div class="sit-pips" id="out-pips"></div><span>OUTS LEFT</span></div>
          <div class="sd-cell"><b id="res-inning">1</b><span>INNING</span></div>
        </div>`;
    } else if (ctx === "map") {
      const boss = isBossInning(gi);
      const b = boss ? bossFor(run, inningOf(gi) - 1) : null;
      const tgt = Math.round(targetFor(gi) * (b && b.rule === "ace" ? (CONFIG.aceTargetMult || 1.25) : 1));
      body = `
        <div class="sd-round">${gameLabel(gi)}</div>
        <div class="sd-blind ${boss ? "is-boss" : ""}">
          <div class="sd-vs">UP NEXT</div>
          <div class="sd-pitcher">${boss ? b.name : "A starter on the mound"}</div>
          ${boss ? `<div class="sd-rule" style="display:block">${b.text}</div>` : ""}
        </div>
        <div class="sd-target"><span class="sd-cap">SCORE AT LEAST</span><b>${tgt}</b></div>`;
    } else {
      body = `
        <div class="sd-round">THE SHOP</div>
        <div class="sd-blind">
          <div class="sd-vs">BEFORE</div>
          <div class="sd-pitcher">${gameLabel(gi)}</div>
        </div>`;
    }
    return `<div class="run-side">
        ${head}${body}
        <div class="sd-pay payroll-chip" id="payroll-chip">$<span id="payroll-amt">${run.payroll}</span></div>
        <div class="sd-fr">${fr ? fr.name : ""} · ${STAKES[(run.stake || 1) - 1].name}</div>
        <div class="sd-btns">
          <button class="btn btn-secondary" data-act="open-deck">Deck (${run.deck.length})</button>
          <button class="btn btn-secondary" data-act="open-menu">Menu</button>
        </div>
      </div>`;
  }

  /* ---------- game screen ---------- */
  function renderGameScreen() {
    return `
    <div class="screen run-screen game-screen">
      ${runSideHTML("game")}
      <div class="run-main">
        ${runTopHTML()}
        <div class="run-content">
          <div class="game-main">
            <div class="col-field">
              <div class="sb-rally field-rally" id="sb-rally-wrap">
                <div class="sb-rally-label">RALLY</div>
                <div class="sb-rally-num" id="sb-rally">x1.0</div>
              </div>
              <div class="diamond-wrap">
                <div class="diamond" id="diamond">
                  <div class="base base-2" data-base="2"></div>
                  <div class="base base-1" data-base="1"></div>
                  <div class="base base-3" data-base="3"></div>
                  <div class="base base-home"></div>
                  <div class="runner-layer" id="runner-layer"></div>
                  <div class="run-pop-layer" id="run-pop-layer"></div>
                </div>
                <div class="field-result" id="field-result"></div>
              </div>
            </div>

            <div class="col-summary">
              <div class="play-log" id="play-log"></div>
            </div>

            <!-- at-bat bar: drop a batter into the box to step up; swing buttons appear here -->
            <div class="atbat-bar" id="atbat-bar"></div>
          </div>

          <div class="hand-row">
            <div class="hand" id="hand"></div>
            <div class="deck-pile" data-act="open-deck" title="View your deck">
              <div class="dp-card"></div><div class="dp-card"></div>
              <div class="dp-card dp-top">${icon("diamond")}</div>
              <div class="dp-count"><b id="deck-count">0</b><span id="deck-total">/0</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderGame() {
    if (STATE.screen !== "game") return;
    const g = STATE.game, run = STATE.run;
    const gi = g.gameIndex;
    setText("sb-round", gameLabel(gi));
    setText("sb-vs", "NOW PITCHING");
    setText("sb-pitcher", `${g.pitcher.name}  ·  ${g.pitcher.bats}HP  ·  Stuff ${g.pitcher.stuff} / Cmd ${g.pitcher.command}`);
    const ruleEl = $("#sb-rule");
    if (ruleEl) {
      if (g.pitcher.boss) { ruleEl.innerHTML = `<span class="boss-tag">BOSS</span> ${g.pitcher.boss.text}`; ruleEl.style.display = "block"; }
      else { ruleEl.style.display = "none"; }
    }
    setText("sb-score", g.score);
    setText("sb-target", g.target);
    setText("sb-runs", g.runsScored);
    const pct = Math.min(100, (g.score / g.target) * 100);
    const pf = $("#sb-progress"); if (pf) pf.style.width = pct + "%";
    renderOutPips(g);
    setText("res-inning", isExtraInnings(gi) ? "+" + (inningOf(gi) - ROUNDS.length) : inningOf(gi));
    setRally(g.rally, false);
    setText("payroll-amt", run.payroll);
    renderDiamond();
    renderHand();
    renderDugout();
    renderPowerups();
    setText("deck-count", g.deck.length);
    setText("deck-total", "/" + run.deck.length);
    refreshAtBat();
  }

  // base-center coordinates (% of the square diamond): index 0=1st, 1=2nd, 2=3rd, plus home
  const BASE_XY = [[84, 50], [50, 16], [16, 50]];
  const HOME_XY = [50, 84];
  // "stops" along the basepath in running order: 0=home(start) 1=1st 2=2nd 3=3rd 4=home(score)
  const STOPS = [HOME_XY, BASE_XY[0], BASE_XY[1], BASE_XY[2], HOME_XY];
  const LEG_MS = 230; // time to run a single base; matches the CSS transition on .rtok
  let _runnerUid = 0;
  // Run a token from its current stop to a target stop, hitting every base in between
  // (so a man on first who advances to third rounds 2nd instead of cutting across).
  function animateTokenTo(tok, toStop, onDone) {
    if (tok._stepTimer) { clearTimeout(tok._stepTimer); tok._stepTimer = null; }
    let cur = parseInt(tok.getAttribute("data-stop") || "0", 10);
    function step() {
      if (cur >= toStop) { tok._stepTimer = null; if (onDone) onDone(); return; }
      cur += 1;
      const xy = STOPS[cur];
      tok.style.left = xy[0] + "%";
      tok.style.top = xy[1] + "%";
      tok.setAttribute("data-stop", cur);
      tok._stepTimer = setTimeout(step, LEG_MS * speedScale());
    }
    step();
  }
  function renderOutPips(g) {
    const el = $("#out-pips");
    if (!el) return;
    const total = g.outsMax || (g.outsRemaining + (g.outsThisInning || 0)) || 3;
    let h = "";
    for (let i = 0; i < total; i++) h += `<span class="out-pip ${i < g.outsRemaining ? "left" : "used"}"></span>`;
    el.innerHTML = h;
  }
  function renderDiamond() {
    const g = STATE.game;
    if (!g) return;
    for (let i = 0; i < 3; i++) {
      const el = $(`.base[data-base="${i + 1}"]`);
      if (el) el.classList.toggle("occupied", !!g.bases[i]);
    }
    reconcileRunners(g);
  }
  // Animated runner tokens: each runner keeps a stable id, so the engine moving a
  // runner from base to base smoothly slides its token (CSS transition on left/top).
  function reconcileRunners(g) {
    const layer = $("#runner-layer");
    if (!layer) return;
    const want = {};
    for (let i = 0; i < 3; i++) {
      const r = g.bases[i];
      if (!r) continue;
      if (!r._uid) r._uid = "r" + (++_runnerUid);
      want[r._uid] = { base: i, r };
    }
    Object.keys(want).forEach((uid) => {
      const { base, r } = want[uid];
      const targetStop = base + 1; // base 0 (1st) -> stop 1, etc.
      let tok = layer.querySelector(`.rtok[data-rid="${uid}"]`);
      if (!tok) {
        tok = document.createElement("div");
        tok.className = "rtok " + speedClass(r.speed);
        tok.setAttribute("data-rid", uid);
        tok.setAttribute("data-stop", "0"); // starts at home plate
        tok.title = `${r.name} · SPD ${Math.round(r.speed)}`;
        tok.style.left = STOPS[0][0] + "%"; tok.style.top = STOPS[0][1] + "%";
        layer.appendChild(tok);
        void tok.offsetWidth; // commit the start position so the run animates
      }
      animateTokenTo(tok, targetStop); // runs the basepath, hitting each base in turn
    });
    $$(".rtok", layer).forEach((tok) => {
      const rid = tok.getAttribute("data-rid");
      if (!want[rid] && !tok.classList.contains("leaving")) {
        tok.classList.add("leaving"); // scored - round the remaining bases to home, then fade
        animateTokenTo(tok, 4, () => {
          tok.classList.add("crossed");
          setTimeout(() => { if (tok.parentNode) tok.parentNode.removeChild(tok); }, pace(260));
        });
      }
    });
  }
  function speedClass(s) { return s >= 80 ? "spd-fast" : s >= 60 ? "spd-mid" : "spd-slow"; }

  function renderHand() {
    const g = STATE.game;
    const hand = $("#hand");
    if (!hand) return;
    hand.innerHTML = g.hand.map((c, i) => cardHTML(c, i)).join("");
    // stagger-in animation
    $$(".card", hand).forEach((el, i) => {
      el.style.animationDelay = (i * 35) + "ms";
    });
  }

  // procedural artwork helpers (js/art.js); everything falls back if art is unavailable
  function cardArt(c) { return (typeof portraitSVG === "function") ? `<div class="card-art">${portraitSVG(c)}</div>` : ""; }
  function packArt(kind) { return (typeof packArtSVG === "function") ? packArtSVG(kind) : `<span class="pk-ico">${icon(packIcon(kind))}</span>`; }
  function itemArt(kind, item) { return (typeof itemArtSVG === "function") ? itemArtSVG(kind, item) : (item && item.icon ? icon(item.icon) : ""); }
  function coachFace(c) { return (typeof coachPortraitSVG === "function") ? coachPortraitSVG(c) : (c && c.icon ? icon(c.icon) : ""); }
  // the shared RETRO CARD frame: cream cardstock, a colored kind-banner, an art window,
  // a name plate and the rule text. Used for coaches, vouchers, Salami, scouting,
  // analytics and Spring Training everywhere they're offered.
  function retroCardHTML(o) {
    const dxEd = o.deluxe ? (getEdition(o.deluxe) || {}) : null;
    const dx = o.deluxe ? `<div class="dx-badge dx-${o.deluxe}" data-tip="<b>${dxEd.name || ""} edition</b><br>${dxEd.text || ""}">${dxEd.name || ""}</div>` : "";
    return `<div class="rcard rk-${o.kind} rar-${o.rarity || "common"}${o.deluxe ? " has-dx dx-" + o.deluxe : ""}">
        <div class="rc-banner">${o.kindLabel || ""}</div>
        <div class="rc-art">${o.art || ""}</div>
        <div class="rc-name">${o.name}${o.sub ? ` <span class="rc-sub">${o.sub}</span>` : ""}</div>
        <div class="rc-text">${o.text || ""}</div>
        ${dx}
      </div>`;
  }

  function cardHTML(c, idx, opts) {
    opts = opts || {};
    const ed = c.edition ? `<div class="edition ed-${c.edition}">${editionLabel(c.edition)}</div>` : "";
    const dxEd = c.deluxe ? (getEdition(c.deluxe) || {}) : null;
    const dx = c.deluxe ? `<div class="dx-badge dx-${c.deluxe}" data-tip="<b>${dxEd.name || ""} edition</b><br>${dxEd.text || ""}">${dxEd.name || ""}</div>` : "";
    const pos = (c.tags.find((t) => /^(C|1B|2B|SS|3B|LF|CF|RF|OF|DH)$/.test(t))) || "";
    const roleTags = c.tags.filter((t) => ["slugger", "contact", "speedster", "table-setter", "utility", "veteran", "rookie", "legend"].indexOf(t) >= 0).slice(0, 3);
    const tagHTML = roleTags.map((t) => `<span class="ctag ct-${t}">${t}</span>`).join("");
    const idxAttr = idx != null ? `data-idx="${idx}"` : "";
    const tr = (typeof getTrait === "function") ? getTrait(c.trait) : null;
    const traitBadge = tr ? `<div class="card-trait" data-tip="<b>${tr.name}</b><br>${tr.desc}">${icon(tr.icon)}</div>` : "";
    const st = c._streak || 0;
    const streakBadge = st >= 2 ? `<div class="card-streak hot" data-tip="<b>Hot streak</b><br>Boosted hitting stats while hot.">${icon("flame")}</div>` : st <= -2 ? `<div class="card-streak cold" data-tip="<b>Cold streak</b><br>Reduced hitting stats while cold.">${icon("snowflake")}</div>` : "";
    const infoBtn = `<button class="card-info" data-cardinfo aria-label="Player info" data-tip="${cardTip(c)}">${icon("help")}</button>`;
    return `
      <div class="card rar-${c.rarity} ${c.edition ? "has-ed ed-bg-" + c.edition : ""}${c.deluxe ? " has-dx dx-" + c.deluxe : ""}${st >= 2 ? " is-hot" : st <= -2 ? " is-cold" : ""}" ${idxAttr} data-uid="${c.uid}">
        <div class="card-top">
          <div class="bats bats-${c.bats}">${c.bats}</div>
          <div class="card-name">${shortName(c.name)}</div>
        </div>
        ${cardArt(c)}
        ${ed}${dx}${streakBadge}
        <div class="card-stats">
          ${statBar("C", c.contact, "b-contact")}
          ${statBar("P", c.power, "b-power")}
          ${statBar("E", c.eye, "b-eye")}
          ${statBar("S", c.speed, "b-speed")}
        </div>
        <div class="card-bottom">
          <div class="card-tags">${tagHTML}</div>
          <div class="card-foot">${traitBadge}<div class="card-pos">${pos}</div>${infoBtn}</div>
        </div>
      </div>`;
  }
  function statBar(label, v, cls) {
    const w = Math.max(2, Math.min(100, v));
    return `<div class="sbar"><span class="sbar-l">${label}</span><div class="sbar-track"><div class="sbar-fill ${cls}" style="width:${w}%"></div></div><span class="sbar-v">${Math.round(v)}</span></div>`;
  }
  // qualitative word for a 0..100ish stat, used in the player explainer tooltip
  function statWord(v) { return v >= 88 ? "elite" : v >= 72 ? "high" : v >= 52 ? "average" : v >= 36 ? "low" : "poor"; }
  // the rich explainer shown when a player card is tapped/hovered (task: explain stats)
  function cardTip(c) {
    const tr = (typeof getTrait === "function") ? getTrait(c.trait) : null;
    const hand = c.bats === "S" ? "switch-hitter - never platoon-disadvantaged" : (c.bats === "L" ? "bats left" : "bats right");
    return `<b>${c.name}</b> · ${hand}`
      + `<br><b class='t-c'>Contact ${Math.round(c.contact)}</b> · ${statWord(c.contact)} - singles &amp; avoids strikeouts`
      + `<br><b class='t-p'>Power ${Math.round(c.power)}</b> · ${statWord(c.power)} - extra-base hits &amp; home runs`
      + `<br><b class='t-e'>Eye ${Math.round(c.eye)}</b> · ${statWord(c.eye)} - draws walks`
      + `<br><b class='t-s'>Speed ${Math.round(c.speed)}</b> · ${statWord(c.speed)} - steals &amp; extra bases`
      + (tr ? `<br><span class='tip-trait'>${tr.name} - ${tr.desc}</span>` : "");
  }
  // uniform compact name across the whole UI: "First-initial. Lastname" (e.g. R. Ruiz, N. Reyburn)
  function shortName(n) { const p = n.split(" "); return p.length > 1 ? p[0][0] + ". " + p[p.length - 1] : n; }
  function editionLabel(e) { return ({ gold: "GOLD", clutch: "CLUTCH", prospect: "PROSPECT", foil: "FOIL", veteran: "VET" })[e] || e.toUpperCase(); }

  function renderDugout() {
    const run = STATE.run;
    const d = $("#dugout");
    if (!d) return;
    const slots = [];
    for (let i = 0; i < run.dugoutSlots; i++) {
      const c = run.dugout[i];
      if (c) slots.push(coachIconHTML(c, i));
      else slots.push(`<div class="coach-icon empty" style="--i:${i}">+</div>`);
    }
    d.innerHTML = slots.join("");
    setText("pt-dugout", `${dugoutUsed(run)}/${run.dugoutSlots}`);
  }
  // A dugout coach as a LARGE mini-card (portrait + name), Balatro-joker style. The full
  // rule lives in the tap/hover tooltip; idx (when given) adds the corner sell button.
  function coachIconHTML(c, idx) {
    const scale = (c.state && c.state.bonus) ? `<span class="coach-badge">+${c.state.bonus.toFixed(1)}</span>` : "";
    const sellP = Math.max(1, Math.floor((c.cost || 5) / 2));
    const dxTip = c.deluxe ? `<br><span class='tip-use'>${(getEdition(c.deluxe) || {}).name}${c.deluxe === "legendary" ? " (no slot)" : " coach: +" + (DELUXE_COACH_AURA[c.deluxe] || 0) + " Rally aura"}</span>` : "";
    const sell = (idx != null) ? `<button class="os-sell" data-stripsell="coach:${idx}" aria-label="Sell ${c.name}">${icon("sell")}</button>` : "";
    return `<div class="coach-icon rar-${c.rarity} ${c.deluxe ? "has-dx dx-" + c.deluxe : ""}" data-coach="${c.id}" data-uid="${c.uid}" style="--i:${idx || 0}" data-tip="<b>${c.name}</b><br>${c.text}${dxTip}<br><span class='tip-use'>Sell +$${sellP}</span>">
        <span class="ci-art">${coachFace(c)}</span>
        <span class="ci-name">${c.name}</span>
        ${scale}${sell}
      </div>`;
  }
  /* ---------- CHARMS (consumable powerups) ---------- */
  function renderPowerups() {
    const run = STATE.run;
    const el = $("#powerups");
    if (!el) return;
    const slots = [];
    for (let i = 0; i < run.charmSlots; i++) {
      const id = run.charms[i];
      const c = id ? getCharm(id) : null;
      if (c) slots.push(charmBadgeHTML(c, i));
      else slots.push(`<div class="charm-badge empty" style="--i:${i}">+</div>`);
    }
    el.innerHTML = slots.join("");
    setText("pt-salami", `${run.charms.length}/${run.charmSlots}`);
  }
  function charmBadgeHTML(c, i) {
    const how = c.target === "immediate" ? "Tap to use" : (c.target === "coach" ? "Drag onto a coach" : "Drag onto a player");
    const refund = charmRefund(c);
    return `<div class="charm-badge rar-${c.rarity}" data-charm="${i}" data-charmtarget="${c.target}" style="--i:${i}" data-tip="<b>${c.name}</b><br>${c.text}<br><span class='tip-use'>${how} &middot; sell +$${refund}</span>">
        <span class="cb-art">${itemArt("charm", c)}</span>
        <span class="ci-name">${c.name}</span>
        <button class="cb-sell" data-charmsell="${i}" data-tip="Sell ${c.name} for +$${refund}" aria-label="Sell ${c.name}">${icon("sell")}</button>
      </div>`;
  }
  // give a charm to the run (from the shop or an achievement). false if the pouch is full.
  function grantCharm(id, announce) {
    const run = STATE.run;
    if (!run) return false;
    if (run.charms.length >= run.charmSlots) { if (announce) toast("Salami pouch is full. Use one first."); return false; }
    run.charms.push(id);
    discover(id);
    saveRun();
    if (STATE.screen === "game") renderPowerups();
    return true;
  }
  function consumeCharm(index) {
    STATE.run.charms.splice(index, 1);
    SFX.coin();
    if (!runIsSeeded()) META.career.seedsUsed = (META.career.seedsUsed || 0) + 1;
    saveMeta(); checkCareerAch();
    saveRun();
    if (STATE.screen === "game") renderPowerups();
  }
  function charmRefund(c) { return Math.max(1, Math.floor((c.cost || 4) / 2)); }
  // sell a Salami Card for half its cost - available at ALL times (panel button, make-room)
  function sellCharm(index, ctx) {
    const run = STATE.run;
    const id = run.charms[index];
    const c = id ? getCharm(id) : null;
    if (!c) return;
    const refund = charmRefund(c);
    run.payroll += refund;
    run.charms.splice(index, 1);
    if (SFX && SFX.coin) SFX.coin();
    toast(`Sold ${c.name} for $${refund}.`);
    saveRun();
    if (STATE.screen === "game") { renderPowerups(); setText("payroll-amt", run.payroll); }
    if (STATE.screen === "shop" || STATE.screen === "map") render();   // covers the inline pack stage too
  }
  // The Salami pouch, inspectable (and sellable) from ANY screen - mirrors openDugoutView.
  function openSalamiView() {
    const run = STATE.run;
    if (!run) return;
    const cells = run.charms.map((id, i) => {
      const c = getCharm(id);
      if (!c) return "";
      const how = c.target === "immediate" ? "Tap it in the SALAMI panel during play to use it."
        : c.target === "coach" ? "Drag it onto a dugout coach during play."
        : "Drag it onto a player in your hand during play.";
      return `<div class="mr-item rar-${c.rarity}">
          <span class="mr-ico mr-art">${itemArt("charm", c)}</span>
          <div class="mr-txt"><b>${c.name}</b><span>${c.text}</span><span class="mr-how">${how}</span></div>
          <button class="btn btn-sell" data-pouchsell="${i}">Sell +$${charmRefund(c)}</button>
        </div>`;
    }).join("") || `<div class="shop-empty">No Salami Cards yet. Pull them from Salami Packs or earn them with feats.</div>`;
    const free = Math.max(0, run.charmSlots - run.charms.length);
    overlay(`
      <div class="ov-card salami-view">
        <h2><span class="h2-ico">${icon("sparkle")}</span> Salami Pouch (${run.charms.length}/${run.charmSlots})</h2>
        <div class="ov-sub">One-shot powerups. Sell any for half cost, any time.${free ? ` ${free} slot${free === 1 ? "" : "s"} open.` : " The pouch is full."}</div>
        <div class="mr-list">${cells}</div>
        <button class="btn btn-gold" data-act="close-ov">Close</button>
      </div>`);
  }
  // when a pack pick can't fit (pouch/dugout full), let the player SELL to make room instead of
  // being forced to skip the card they wanted (Balatro-style). `retry` re-runs the blocked pick.
  function openMakeRoom(kind, retry) {
    const run = STATE.run;
    let items = "";
    if (kind === "charm") {
      items = run.charms.map((id, i) => { const c = getCharm(id); return c ? `<div class="mr-item rar-${c.rarity}"><span class="mr-ico mr-art">${itemArt("charm", c)}</span><div class="mr-txt"><b>${c.name}</b><span>${c.text}</span></div><button class="btn btn-sell" data-mrsell="charm:${i}">Sell +$${charmRefund(c)}</button></div>` : ""; }).join("");
    } else {
      items = run.dugout.map((co, i) => `<div class="mr-item rar-${co.rarity || "common"}"><span class="mr-ico mr-art">${coachFace(co)}</span><div class="mr-txt"><b>${co.name}</b><span>${co.text}</span></div><button class="btn btn-sell" data-mrsell="coach:${i}">Sell +$${Math.max(1, Math.floor((co.cost || 5) / 2))}</button></div>`).join("");
    }
    STATE._makeRoom = { kind, retry };
    overlay(`
      <div class="ov-card make-room">
        <h2><span class="h2-ico">${icon("sell")}</span> ${kind === "coach" ? "Dugout" : "Salami pouch"} is full</h2>
        <div class="ov-sub">Sell one to make room, then take the card you wanted.</div>
        <div class="mr-list">${items}</div>
        <button class="btn btn-ghost" data-act="cancel-makeroom">Cancel</button>
      </div>`);
  }
  function makeRoomSell(spec) {
    const ctx = STATE._makeRoom; if (!ctx) return;
    const parts = spec.split(":"), i = parseInt(parts[1], 10);
    if (parts[0] === "charm") sellCharm(i, "makeroom"); else sellCoach(i, "makeroom");
    const retry = ctx.retry;
    STATE._makeRoom = null;
    closeOverlay();                     // the inline stage / shop sits right beneath
    if (retry) retry();                 // re-run the blocked pick (room now exists)
    else render();
  }
  function closeMakeRoom() {
    STATE._makeRoom = null;
    closeOverlay();                     // the inline stage / shop is still on screen
  }
  function useCharm(index) {
    if (STATE.busy) return;
    const c = getCharm(STATE.run.charms[index]);
    if (!c) return;
    SFX.click && SFX.click();
    if (c.target === "immediate") {
      const g = STATE.game;
      if (!g || g.ended) { SFX.error(); return; }
      overlay(`<div class="ov-card confirm-card"><h2><span class="h2-ico">${icon(c.icon)}</span> ${c.name}</h2>
        <div class="ov-sub">${c.text}</div>
        <div class="ov-actions"><button class="btn btn-gold" data-act="charm-confirm">Use it</button><button class="btn btn-ghost" data-act="cancel-charm">Cancel</button></div></div>`);
      STATE._charm = { charm: c, index };
    } else {
      // targeted Salami cards are drag-only (Balatro-style): no picker, drag onto the target
      const where = c.target === "coach" ? "a coach in the dugout" : "a player in your hand";
      toast(`Drag ${c.name} onto ${where} to use it.`);
      const badge = $(`.charm-badge[data-charm="${index}"]`);
      if (badge) { badge.classList.remove("nudge"); void badge.offsetWidth; badge.classList.add("nudge"); }
    }
  }
  function applyImmediateCharm(c) {
    const g = STATE.game;
    if (!g) return false;
    if (c.op === "rally") {
      g.rally = +(g.rally + c.amt).toFixed(2);
      setRally(g.rally, true); SFX.rally(g.rally);
      pushLog(`${icon(c.icon)} ${c.name} - Rally +${c.amt}`, "steal");
      return true;
    }
    if (c.op === "extraout") {
      g.outsRemaining += 1; g.outsMax = (g.outsMax || g.outsRemaining) + 1;
      renderOutPips(g);
      pushLog(`${icon(c.icon)} ${c.name} - one extra out this inning`, "ok");
      return true;
    }
    if (c.op === "freewalk") {
      awardAchievement("free_runner");
      const runner = { name: "Pinch Runner", nick: "Runner", speed: 60, card: { trait: null } };
      const nb = g.bases.slice();
      let forcedIn = 0;
      if (nb[0]) { if (nb[1]) { if (nb[2]) forcedIn++; nb[2] = nb[1]; } nb[1] = nb[0]; }
      nb[0] = runner;
      g.bases = nb;
      if (forcedIn) { g.runsScored += forcedIn; popRuns(forcedIn); }
      g.rally = +(g.rally + (CONFIG.rallyIncrement || 0.5)).toFixed(2);
      setRally(g.rally, true);
      renderDiamond();
      pushLog(`${icon(c.icon)} Intentional walk - a free runner takes first`, "ok");
      return true;
    }
    return false;
  }
  /* ---------- achievements: feats that gift a Charm ---------- */
  // unlock an achievement in the career profile (once ever) + a banner
  // a run started from a typed/replayed seed earns no unlocks (anti-cheese, Balatro-style)
  function runIsSeeded() { return !!(STATE.run && STATE.run.seeded); }
  function unlockAchievement(id) {
    if (runIsSeeded()) return false;          // seeded runs never unlock achievements
    if (!META.ach) META.ach = {};
    if (META.ach[id]) return false;
    META.ach[id] = Date.now ? Date.now() : 1;
    saveMeta();
    const ach = (typeof getAchievement === "function") ? getAchievement(id) : null;
    if (ach) achievementBanner(ach);
    return true;
  }
  // in-inning feat: unlock the achievement AND gift a Salami Card (once per run)
  function awardAchievement(id) {
    const run = STATE.run;
    unlockAchievement(id);
    if (!run) return;
    if (!run.achEarned) run.achEarned = {};
    if (run.achEarned[id]) return;            // one seed per feat per run
    const ach = (typeof getAchievement === "function") ? getAchievement(id) : null;
    if (!ach || !ach.seed) return;            // only feats gift a seed
    run.achEarned[id] = true;
    const rng = makeRNG(run.seed + ":ach:" + id);
    const charmId = rng.pick(CHARMS.map((c) => c.id));
    const granted = grantCharm(charmId, false);
    if (SFX && SFX.coin) SFX.coin();
    const cn = getCharm(charmId);
    if (granted && cn) toast(`Feat: ${ach.name} - earned the ${cn.name} Salami card!`);
    saveRun();
  }
  // career-stat milestone checks (call after bumping META.career.*)
  function checkCareerAch() {
    const c = META.career;
    if (c.homers >= 1) unlockAchievement("first_dinger");
    if (c.homers >= 25) unlockAchievement("dingers_25");
    if (c.homers >= 100) unlockAchievement("dingers_100");
    if (c.homers >= 300) unlockAchievement("dingers_300");
    if (c.hits >= 1) unlockAchievement("first_hit");
    if (c.hits >= 100) unlockAchievement("hits_100");
    if (c.hits >= 500) unlockAchievement("hits_500");
    if (c.hits >= 1500) unlockAchievement("hits_1500");
    if (c.walks >= 1) unlockAchievement("first_walk");
    if (c.walks >= 100) unlockAchievement("walks_100");
    if (c.walks >= 400) unlockAchievement("walks_400");
    if (c.steals >= 1) unlockAchievement("first_steal");
    if (c.steals >= 50) unlockAchievement("steals_50");
    if (c.steals >= 200) unlockAchievement("steals_200");
    if (c.bossWins >= 1) unlockAchievement("first_boss");
    if (c.bossWins >= 10) unlockAchievement("boss_10");
    if (c.bossWins >= 30) unlockAchievement("boss_30");
    if (c.seedsUsed >= 1) unlockAchievement("first_seed");
    if (c.seedsUsed >= 20) unlockAchievement("seeds_20");
    if (c.bestRally >= 3) unlockAchievement("rally_3");
    if (c.bestRally >= 5) unlockAchievement("rally_5");
    if (c.bestRally >= 10) unlockAchievement("rally_10");
    if (c.bestRally >= 20) unlockAchievement("rally_20");
    if (c.bestInningScore >= 50 * (CONFIG.scoreScale || 1)) unlockAchievement("inning_50");
    if (c.bestInningScore >= 100 * (CONFIG.scoreScale || 1)) unlockAchievement("inning_100");
    if (META.runs >= 50) unlockAchievement("runs_50");
    if ((c.packsOpened || 0) >= 50) unlockAchievement("packs_50");
    if (Object.keys(META.discovered || {}).length >= 100) unlockAchievement("discover_100");
    const played = Object.keys(META.franchisesPlayed || {}).length;
    if (played >= FRANCHISES.length) unlockAchievement("all_franchises");
    const won = Object.keys(META.franchisesWon || {}).length;
    if (won >= 5) unlockAchievement("win_variety");
    if (META.wins >= 1) unlockAchievement("first_champ");
    if (META.wins >= 5) unlockAchievement("champ_5");
  }
  function checkBuildAch(run) {
    if (!run) return;
    if (run.dugout.length >= 8) unlockAchievement("full_dugout");
    if (run.deck.some((c) => c.rarity === "legend")) unlockAchievement("got_legend");
    if (run.deck.length <= 12) unlockAchievement("thin_deck");
    if (run.payroll >= 40) unlockAchievement("deep_pockets");
  }
  // a little Balatro-style banner that slides in when something is unlocked
  function achievementBanner(ach) {
    let host = document.getElementById("ach-banner");
    if (!host) { host = document.createElement("div"); host.id = "ach-banner"; document.body.appendChild(host); }
    const el = document.createElement("div");
    el.className = "ach-pop";
    el.innerHTML = `<div class="ach-pop-ic">${icon("trophy")}</div><div class="ach-pop-txt"><div class="ach-pop-eyebrow">Achievement unlocked</div><div class="ach-pop-name">${ach.name}</div><div class="ach-pop-desc">${ach.text}</div></div>`;
    host.appendChild(el);
    if (SFX && SFX.coin) SFX.coin();
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => { if (el.parentNode) el.remove(); }, 400); }, 3600);
  }

  /* ---------- readout + animations ---------- */
  // the outcome now pops over the field for a moment, then fades (no persistent box)
  function setReadout(label, cls, ev, math) {
    const r = $("#field-result");
    if (!r) return;
    const plat = ev.platoon === "adv" ? `<span class="plat plat-adv">platoon +</span>` : ev.platoon === "dis" ? `<span class="plat plat-dis">platoon -</span>` : "";
    r.innerHTML = `
      <div class="ro-card ro-${cls}">
        <div class="ro-label">${label}</div>
        <div class="ro-batter">${ev.batterName} ${plat}</div>
        <div class="ro-math">${math || ""}</div>
      </div>`;
    r.classList.remove("show"); void r.offsetWidth; r.classList.add("show");
    clearTimeout(setReadout._t);
    setReadout._t = setTimeout(() => { r.classList.remove("show"); }, pace(1700));
  }

  function bumpScore(amt) {
    const g = STATE.game;
    const pct = Math.min(100, (g.score / g.target) * 100);
    const pf = $("#sb-progress"); if (pf) pf.style.width = pct + "%";
    const el = $("#sb-score");
    if (amt > 0 && el) {
      tickNumber(el, g.score, 460);          // count up to the new score
      el.classList.remove("score-bump"); void el.offsetWidth; el.classList.add("score-bump");
      floatText(null, `+${amt}`, "float-score");
    } else {
      setText("sb-score", g.score);
    }
  }

  function animateRally(ev) {
    const g = STATE.game;
    if (ev.rallyDelta === -999) {
      // reset / shatter (legacy hot-hand mode)
      setRally(g.rally, false);
      const w = $("#sb-rally-wrap");
      if (w) { w.classList.remove("rally-reset"); void w.offsetWidth; w.classList.add("rally-reset"); }
    } else if (ev.rallyDelta > 0) {
      setRally(g.rally, true);
      SFX.rally(g.rally);
    } else {
      setRally(g.rally, false); // no change (an out) - sync without a pulse
    }
  }
  function setRally(v, grow) {
    const el = $("#sb-rally");
    const wrap = $("#sb-rally-wrap");
    if (!el) return;
    el.textContent = "x" + v.toFixed(1);
    // scale visual with rally height
    const scale = Math.min(1.9, 1 + (v - 1) * 0.16);
    el.style.transform = `scale(${scale})`;
    if (wrap) {
      const heat = Math.min(1, (v - 1) / 6);
      wrap.style.setProperty("--heat", heat.toFixed(3));
      // discrete tiers add flame/glow intensity as the rally climbs
      wrap.classList.toggle("rally-warm", v >= 2);
      wrap.classList.toggle("rally-hot", v >= 3.5);
      wrap.classList.toggle("rally-blaze", v >= 5.5);
    }
    if (grow) { el.classList.remove("rally-grow"); void el.offsetWidth; el.classList.add("rally-grow"); }
  }

  function popRuns(n) {
    const layer = $("#run-pop-layer");
    if (!layer) return;
    const d = document.createElement("div");
    d.className = "run-pop";
    d.textContent = n === 1 ? "RUN!" : n + " RUNS!";
    layer.appendChild(d);
    setTimeout(() => d.remove(), pace(1100));
  }

  function floatText(anchorEl, text, cls) {
    const host = $(".sd-score") || $(".scoreboard");
    if (!host) return;
    const d = document.createElement("div");
    d.className = "float-text " + (cls || "");
    d.textContent = text;
    host.appendChild(d);
    setTimeout(() => d.remove(), pace(900));
  }

  function flashPayrollGain(amt) {
    const chip = $("#payroll-chip");
    if (chip) { chip.classList.remove("flash"); void chip.offsetWidth; chip.classList.add("flash"); }
  }

  function flashCoachById(id) {
    const el = $(`.coach-icon[data-coach="${id}"]`) || $(`.coach-chip[data-coach="${id}"]`);
    if (el) { el.classList.remove("trigger"); void el.offsetWidth; el.classList.add("trigger"); SFX.coach(); }
  }
  function flashCoachByFx(t) {
    if (typeof t === "string" && t.indexOf("coach:") === 0) flashCoachById(t.slice(6));
  }

  /* ---------- play log ---------- */
  function pushLog(text, cls) {
    const g = STATE.game;
    if (g) g.log.unshift({ text, cls });
    const log = $("#play-log");
    if (!log) return;
    const d = document.createElement("div");
    d.className = "log-entry log-" + (cls || "neutral");
    d.innerHTML = text;
    log.insertBefore(d, log.firstChild);
    while (log.children.length > 40) log.removeChild(log.lastChild);
  }
  function logEvent(ev) {
    const o = ev.outcome;
    let cls = OUTCOME_CLASS[o] || "neutral";
    let txt = `<b>${OUTCOME_LABEL[o] || o}</b> - ${ev.batterName}`;
    if (ev.isSafe && ev.scoreGained > 0) txt += ` <span class="lg-pts">+${ev.scoreGained}</span>`;
    if (ev.runsOnPlay > 0) txt += ` <span class="lg-run">${ev.runsOnPlay}R</span>`;
    pushLog(txt, cls);
  }

  /* ============================================================
     WIN OVERLAY / GAME OVER / VICTORY
     ============================================================ */
  function showWinOverlay(g, breakdown, total) {
    const rows = breakdown.map((b) => `<div class="brk-row"><span>${b.label}</span><b>+$${b.amt}</b></div>`).join("");
    overlay(`
      <div class="ov-card win-ov">
        <div class="ov-burst">${icon("sparkle")}</div>
        <h2>${gameLabel(g.gameIndex).toUpperCase()} CLEARED</h2>
        <div class="ov-sub">You beat ${g.pitcher.name} - <b>${g.score}</b> vs ${g.target}.</div>
        <div class="brk">${rows}<div class="brk-row brk-total"><span>Total earned</span><b>+$${total}</b></div></div>
        <div class="ov-pay">Payroll: <b>$${STATE.run.payroll}</b></div>
        <button class="btn btn-big btn-gold" data-act="to-shop">Visit the Shop ${icon("chevronR")}</button>
      </div>`);
  }

  function showGameOver(g) {
    SFX.lose && SFX.lose();
    const run = STATE.run;
    const fr = FRANCHISES.find((f) => f.id === run.franchiseId);
    const total = ROUNDS.length * GAMES_PER_ROUND;          // 27 frames in the main run
    const cleared = (run.stat.gamesWon != null ? run.stat.gamesWon : g.gameIndex);  // frames won
    const inningReached = inningOf(g.gameIndex);
    const stripN = Math.max(total, g.gameIndex + 1);
    // a frame-by-frame strip: cleared / lost / ahead, bosses are diamonds, extras flagged
    let strip = "";
    for (let i = 0; i < stripN; i++) {
      const boss = isBossInning(i);
      let cls = i < cleared ? "done" : (i === g.gameIndex ? "lost" : "future");
      if (i >= total) cls += " extra";
      strip += `<span class="pm-pip ${cls}${boss ? " boss" : ""}" title="${gameLabel(i)}">${boss ? icon("diamond") : ""}</span>`;
    }
    const flavor = g.gameIndex >= total ? "A champion, undone deep in Extra Innings. What a run."
      : inningReached >= 9 ? "Fell in the 9th. One swing from history."
      : inningReached >= 7 ? "Deep into the late innings. So close."
      : inningReached >= 3 ? "A real run, cut short."
      : inningReached >= 2 ? "The makings of something here."
      : "Every dynasty starts with a loss.";
    const pct = Math.min(100, Math.round((g.score / g.target) * 100));
    const clearedLabel = cleared >= total ? total + " + " + (cleared - total) + " extra" : cleared + " / " + total;
    overlay(`
      <div class="ov-card lose-ov postmortem">
        <div class="pm-burst">${icon("close")}</div>
        <h2>GAME OVER</h2>
        <div class="ov-sub">${fr ? fr.name : "Your club"} fell to <b>${g.pitcher.name}</b> in <b>${gameLabel(g.gameIndex)}</b>.<br><span class="pm-flavor">${flavor}</span></div>
        <div class="pm-final">
          <div class="pm-final-top"><span>Final line</span><b>${g.score} <i>/</i> ${g.target}</b></div>
          <div class="pm-bar"><div class="pm-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="pm-strip">${strip}</div>
        <div class="pm-grid">
          ${statCell("Frames cleared", clearedLabel)}
          ${statCell("Best frame", run.stat.bestScore || g.score)}
          ${statCell("Coaches", run.dugout.length)}
          ${statCell("Deck size", run.deck.length + " cards")}
          ${statCell("Payroll banked", "$" + run.payroll)}
          ${statCell("Seed", seedChip(run.seed))}
        </div>
        <div class="ov-actions">
          <button class="btn btn-big btn-gold" data-act="replay-seed">${icon("replay")} Replay this seed</button>
          <button class="btn btn-secondary" data-act="retry-run">New Run</button>
          <button class="btn btn-ghost" data-act="to-title">Main Menu</button>
        </div>
      </div>`, true);
  }

  // shown once, after beating inning 8's Boss. The run is NOT cleared: you can push into Extra Innings.
  function showVictory() {
    SFX.win();
    confettiBurst(90);
    setTimeout(() => confettiBurst(60), 700);   // a second wave for a real flourish
    const run = STATE.run;
    overlay(`
      <div class="ov-card victory-ov">
        <div class="ov-burst big">${icon("trophy")}</div>
        <h2>WORLD SERIES CHAMPIONS</h2>
        <div class="ov-sub">You ran the gauntlet with ${FRANCHISES.find(f => f.id === run.franchiseId).name} and won it all.<br>Keep going into <b>Extra Innings</b> to see how far your build can climb, or call it a championship.</div>
        <div class="ov-stat">Frames won: ${run.stat.gamesWon} · Best frame score: ${run.stat.bestScore} · Seed: ${seedChip(run.seed)}</div>
        <div class="ov-actions">
          <button class="btn btn-big btn-gold" data-act="extra-innings">${icon("fastForward")} Play Extra Innings</button>
          <button class="btn btn-secondary" data-act="retry-run">New Run</button>
          <button class="btn btn-ghost" data-act="to-title">Main Menu</button>
        </div>
      </div>`, true);
  }

  /* ---------- pause / main menu ---------- */
  function showMenu() {
    if (SFX && SFX.click) SFX.click();
    const inRun = !!STATE.run;
    const tile = (act, ic, label, note, cls) =>
      `<button class="btn menu-tile ${cls || ""}" data-act="${act}"><span class="mi-icon">${ic}</span><span class="mi-text"><span class="mi-label">${label}</span>${note ? `<span class="menu-note">${note}</span>` : ""}</span></button>`;
    overlay(`
      <div class="ov-card menu-card">
        <h2>Menu</h2>
        <div class="menu-grid">
          ${inRun ? tile("menu-resume", icon("chevronR"), "Resume", "back to the game", "tile-resume") : ""}
          ${inRun ? tile("open-deck", icon("layers"), "Deck", "your roster") : ""}
          ${inRun ? tile("open-dugout", icon("medal"), "Dugout", "coaches · sell anytime") : ""}
          ${inRun ? tile("open-salami", icon("sparkle"), "Salami", "powerups · sell anytime") : ""}
          ${tile("open-stats", icon("stats"), "Stats", "career &amp; run")}
          ${tile("howto", icon("help"), "How to Play", "the rules")}
          ${tile("toggle-sound-menu", META.sound ? icon("soundOn") : icon("soundOff"), "Sound: " + (META.sound ? "On" : "Off"), "toggle audio")}
          ${inRun ? tile("to-menu", icon("chevronL"), "Main Menu", "keeps your run") : ""}
          ${inRun ? tile("abandon-run", icon("close"), "Abandon Run", "quit &amp; discard", "tile-danger") : ""}
        </div>
        <div class="menu-speed">
          <span class="ms-label">${icon("fastForward")} Game speed</span>
          <div class="ms-btns">
            ${[1, 2, 3, 4].map((n) => `<button class="ms-btn ${META.speed === n ? "sel" : ""}" data-speed="${n}">${n}x</button>`).join("")}
          </div>
          <span class="ms-hint">4x is fastest</span>
        </div>
        ${inRun ? "" : `<button class="btn btn-ghost" data-act="close-ov">Close</button>`}
      </div>`);
  }
  function setSpeed(n) {
    if (!(n >= 1 && n <= 4)) return;
    META.speed = n; saveMeta();
    applySpeedVar();   // update the CSS speed multiplier so animations rescale immediately
    if (SFX && SFX.click) SFX.click();
    showMenu();   // re-render so the selected button updates
  }

  function confirmAbandon(cancelAct) {
    overlay(`
      <div class="ov-card confirm-card">
        <h2>Abandon this run?</h2>
        <div class="ov-sub">Your current run will end and its progress is lost for good. (Your career stats are kept.)</div>
        <div class="ov-actions">
          <button class="btn btn-danger" data-act="abandon-confirm">Yes, abandon</button>
          <button class="btn btn-ghost" data-act="${cancelAct || "back-to-menu"}">No, keep playing</button>
        </div>
      </div>`);
  }

  function showStats() {
    const m = META;
    const furthest = (m.bestGame != null && m.bestGame >= 0) ? gameLabel(m.bestGame) : "-";
    let runHTML = "";
    if (STATE.run) {
      const r = STATE.run;
      const fr = FRANCHISES.find((f) => f.id === r.franchiseId);
      runHTML = `
        <h3>Current run</h3>
        <div class="stat-grid">
          ${statCell("Franchise", fr ? fr.name : "-")}
          ${statCell("Now playing", gameLabel(r.gameIndex))}
          ${statCell("Games won", r.stat.gamesWon)}
          ${statCell("Payroll", "$" + r.payroll)}
          ${statCell("Deck size", r.deck.length + " cards")}
          ${statCell("Dugout", r.dugout.length + " / " + r.dugoutSlots)}
          ${statCell("Best game (run)", r.stat.bestScore || 0)}
          ${statCell("Seed", r.seeded ? `<span class="seed-hidden">hidden - seeded run, no unlocks</span>` : `<span class="seed-hidden">hidden until the run ends</span>`)}
        </div>`;
    }
    overlay(`
      <div class="ov-card stats-card">
        <h2><span class="h2-ico">${icon("stats")}</span> Stats</h2>
        <h3>Career</h3>
        <div class="stat-grid">
          ${statCell("Championships", m.wins)}
          ${statCell("Runs played", m.runs)}
          ${statCell("Best game score", m.bestScore || 0)}
          ${statCell("Furthest reached", furthest)}
        </div>
        ${runHTML}
        <div class="stats-actions">
          ${STATE.run ? `<button class="btn btn-secondary" data-act="replay-seed">${icon("replay")} Replay this seed</button>` : ""}
          <button class="btn ${STATE.run ? "" : "btn-gold"}" data-act="${STATE.run ? "back-to-menu" : "close-ov"}">${STATE.run ? icon("chevronL") + " Back" : "Close"}</button>
        </div>
      </div>`);
  }
  function statCell(label, val) {
    return `<div class="stat-cell"><div class="stat-val">${val}</div><div class="stat-label">${label}</div></div>`;
  }

  /* ---------- profile: career stats + achievements (Balatro-style) ---------- */
  function showProfile() {
    if (SFX && SFX.click) SFX.click();
    const c = META.career || {};
    const unlocked = META.ach || {};
    const total = ACHIEVEMENTS.length;
    const got = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
    // group by category in declared order
    const cats = [];
    ACHIEVEMENTS.forEach((a) => { if (cats.indexOf(a.cat) < 0) cats.push(a.cat); });
    const grid = cats.map((cat) => {
      const items = ACHIEVEMENTS.filter((a) => a.cat === cat).map((a) => {
        const on = !!unlocked[a.id];
        return `<div class="ach-cell ${on ? "got" : "locked"}" data-tip="<b>${a.name}</b><br>${a.text}${on ? "" : "<br><span class='tip-use'>Locked</span>"}">
            <div class="ach-ic">${icon(on ? "trophy" : "help")}</div>
            <div class="ach-nm">${on ? a.name : "???"}</div>
          </div>`;
      }).join("");
      return `<div class="ach-cat"><div class="ach-cat-h">${cat}</div><div class="ach-row">${items}</div></div>`;
    }).join("");
    overlay(`
      <div class="ov-card profile-card">
        <h2><span class="h2-ico">${icon("trophy")}</span> Profile</h2>
        <div class="prof-stats">
          ${statCell("Achievements", got + " / " + total)}
          ${statCell("Championships", META.wins)}
          ${statCell("Runs played", META.runs)}
          ${statCell("Career homers", c.homers || 0)}
          ${statCell("Career hits", c.hits || 0)}
          ${statCell("Career steals", c.steals || 0)}
          ${statCell("Bosses beaten", c.bossWins || 0)}
          ${statCell("Best Rally", "×" + (c.bestRally || 1).toFixed(1))}
        </div>
        <div class="ach-board">${grid}</div>
        <div class="ov-actions">
          <button class="btn btn-secondary" data-act="open-collection">${icon("book")} Collection</button>
          <button class="btn btn-gold" data-act="close-ov">Close</button>
        </div>
      </div>`);
  }

  /* ---------- collection: every coach / seed / voucher, locked until discovered ---------- */
  function showCollection() {
    if (SFX && SFX.click) SFX.click();
    const groups = [
      { title: "Coaches", items: COACHES, art: (it) => coachFace(it) },
      { title: "Salami Cards", items: CHARMS, art: (it) => itemArt("charm", it) },
      { title: "Front Office", items: UPGRADES, art: (it) => itemArt("upgrade", it) },
      { title: "Skip Tags", items: TAGS, art: null },
    ];
    let allN = 0, gotN = 0;
    const board = groups.map((g) => {
      const gGot = g.items.filter((it) => isDiscovered(it.id)).length;
      allN += g.items.length; gotN += gGot;
      const cells = g.items.map((it) => {
        if (isDiscovered(it.id)) {
          const face = g.art ? `<div class="col-art">${g.art(it)}</div>` : `<div class="col-ic">${icon(it.icon || "trophy")}</div>`;
          return `<div class="col-cell got rar-${it.rarity || "common"}" data-tip="<b>${it.name}</b><br>${it.text}">
              ${face}
              <div class="col-nm">${it.name}</div>
            </div>`;
        }
        return `<div class="col-cell locked" data-tip="<b>Undiscovered</b><br>Acquire this in a run to add it to your Collection.">
            <div class="col-ic">${icon("lock")}</div>
            <div class="col-nm">???</div>
          </div>`;
      }).join("");
      return `<div class="col-group">
          <div class="col-group-h">${g.title} <span class="col-count">${gGot} / ${g.items.length}</span></div>
          <div class="col-grid">${cells}</div>
        </div>`;
    }).join("");
    overlay(`
      <div class="ov-card collection-card">
        <h2><span class="h2-ico">${icon("book")}</span> Collection <span class="col-total">${gotN} / ${allN}</span></h2>
        <div class="ov-sub">Coaches, Salami Cards, Front Office vouchers, and Skip Tags. Locked items reveal once you acquire them in a run.</div>
        <div class="col-board">${board}</div>
        <div class="ov-actions">
          <button class="btn btn-secondary" data-act="open-profile">${icon("chevronL")} Back</button>
          <button class="btn btn-gold" data-act="close-ov">Close</button>
        </div>
      </div>`);
  }

  /* ---------- seeds: copy + replay ---------- */
  function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function seedChip(seed) { return `<code class="seed-copy" data-seed="${escAttr(seed)}" title="Click to copy this seed">${seed} ${icon("copy", "ico-sm")}</code>`; }
  function copySeed(seed) {
    const done = () => { toast("Seed copied - " + seed); if (SFX && SFX.coin) SFX.coin(); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(seed).then(done, () => fallbackCopy(seed, done));
      else fallbackCopy(seed, done);
    } catch (e) { fallbackCopy(seed, done); }
  }
  function fallbackCopy(text, cb) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      if (cb) cb();
    } catch (e) { toast("Couldn't copy - seed is " + text); }
  }
  function replaySeed(seed, franchiseId) {
    STATE._replaySeed = seed || null;
    STATE._replayFranchise = franchiseId || null;
    STATE.run = null; STATE.game = null;
    closeOverlay();
    STATE.screen = "title";
    render();
    if (franchiseId) setTimeout(() => openFranchisePopup(franchiseId), 60); // jump straight to confirm
  }

  /* ---------- new run (with overwrite guard) ---------- */
  function doStartRun(id) {
    SFX.resume();
    let seed = null;
    const el = document.getElementById("fr-seed") || document.getElementById("seed-input");
    if (el && el.value.trim()) seed = el.value.trim().toUpperCase();
    STATE.run = newRun(id, seed, STATE._pickStake || 1);
    STATE.game = null;
    STATE._replaySeed = null; STATE._replayFranchise = null;
    clearGameSave();
    saveRun();
    closeOverlay();
    STATE.screen = "map";
    render();
  }
  // selecting a franchise opens a confirm popup with an optional seed + Play Ball
  function openFranchisePopup(id) {
    const f = FRANCHISES.find((x) => x.id === id);
    if (!f) return;
    if (SFX && SFX.click) SFX.click();
    STATE._pendingFranchise = id;
    const coach = f.signatureCoach ? getCoach(f.signatureCoach) : null;
    const ids = rosterIdsFor(f);
    const totals = ids.reduce((a, pid) => { const p = getPlayer(pid); a.c += p.contact; a.p += p.power; a.e += p.eye; a.s += p.speed; return a; }, { c: 0, p: 0, e: 0, s: 0 });
    const n = ids.length, mini = (v) => Math.round(v / n);
    const hasSave = !!localStorage.getItem(SAVE_KEY);
    const presetSeed = STATE._replaySeed ? escAttr(STATE._replaySeed) : "";
    overlay(`
      <div class="ov-card franchise-pop">
        <h2>${f.name}</h2>
        <div class="ov-sub">${f.tagline}</div>
        <div class="fr-stats fp-stats">
          ${miniStat("CON", mini(totals.c))}${miniStat("POW", mini(totals.p))}${miniStat("EYE", mini(totals.e))}${miniStat("SPD", mini(totals.s))}
        </div>
        <div class="fr-bonus fp-bonus">${coach ? `<span class="fr-star">${icon(coach.icon)}</span> ${coach.name}` : "-"}</div>
        <div class="fr-sub fp-sub">${f.bonusText}</div>
        <div class="fp-seed">
          <label>Seed <span>(optional)</span></label>
          <input id="fr-seed" class="seed-input" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="leave blank for a random run" value="${presetSeed}" />
        </div>
        ${hasSave ? `<div class="fp-warn">Starting replaces your current run.</div>` : ""}
        <div class="ov-actions">
          <button class="btn btn-big btn-gold" data-act="confirm-start">Play Ball ${icon("chevronR")}</button>
          <button class="btn btn-ghost" data-act="close-ov">Cancel</button>
        </div>
      </div>`);
    setTimeout(() => { const el = document.getElementById("fr-seed"); if (el && !presetSeed) el.focus(); }, 40);
  }

  const HOWTO_SECTIONS = [
    `<section><h3>The goal</h3><p>A run is <b>9 innings</b>, and each inning has <b>3 frames</b> (Top, Middle, and a <b>Boss</b>). In every frame, pile up <b>Score</b> to beat its <b>Target</b> before you make your <b>3rd out</b>. Clear inning 9's Boss to win the <b>World Series</b>, then push your luck in <b>Extra Innings</b> for as long as your build holds up. Come up short in any frame and the run is over.</p></section>`,
    `<section><h3>Lineups &amp; difficulty</h3><p>Pick a <b>lineup</b> on the home screen (use the arrows to flip through all 15). Each one starts you with a different roster and a unique perk: extra cash, a bigger dugout, a roomier hand, a free Salami card, and more. Then choose a <b>difficulty stake</b> (Rookie up to Cooperstown). Each stake stacks a harder rule on the one below it (higher targets, tougher pitchers, pricier shops), and you <b>unlock the next stake</b> by winning the World Series at the current one.</p></section>`,
    `<section><h3>Sending a batter up</h3><p>Your hand is your lineup. <b>Drag a card into the "Drop batter here" box</b> (or press <b>1-9</b>) to send that batter to the plate. The box highlights as you drag over it. Once they step up, the swing buttons appear in the bar above the box, and you can hit <b>Cancel</b> there to put the batter back. You draw a fresh card after every at-bat.</p></section>`,
    `<section><h3>Choosing a swing</h3><ul><li><b>Contact Swing</b> - balanced; your natural swing.</li><li><b>Power Swing</b> - more homers &amp; extra-base hits, but more strikeouts.</li><li><b>Work the Count</b> - lots of walks, few strikeouts, little power.</li></ul><p>With runners on, you can also <b>Bunt</b> or <b>Send</b> a runner from the same bar.</p></section>`,
    `<section class="howto-rally"><h3>The Rally - the heart of it</h3><p>Every scoring play is worth <b>Bag value × Rally</b>.</p><ul><li><b>Bag value:</b> Walk 100, Single 200, Double 300, Triple 400, Home Run 500 - plus <b>+100</b> for every runner who scores.</li><li><b>Rally</b> starts at <b>×1.0</b> and climbs <b>+0.5</b> each time you reach base safely. An out does <b>not</b> reset it - the rally holds for the whole inning - but outs are your clock: three and the frame is over.</li></ul><p>Build the rally with table-setters, then land your big bats while it's high.</p></section>`,
    `<section><h3>Reading a card</h3><p>Four stats (0-100): <b class='s-c'>Contact</b> (singles, fewer strikeouts), <b class='s-p'>Power</b> (extra-base hits &amp; homers), <b class='s-e'>Eye</b> (walks), <b class='s-s'>Speed</b> (steals &amp; extra bases). The <b>L / R / S</b> badge is handedness - opposite hands earn a <b>platoon</b> boost; switch-hitters never lose it. Tap the <b>?</b> on any card for a full readout.</p></section>`,
    `<section><h3>Baserunning</h3><p>Hits move runners around the diamond, and a runner on 2nd or 3rd is <b>in scoring position</b> (each drives in +1 bag value). When the path is clear you can <b>Send</b> a runner to steal the next base - but getting caught costs a precious out. A <b>Bunt</b> trades an out to push your runners up.</p></section>`,
    `<section><h3>Traits &amp; streaks</h3><p>Star players carry a <b>trait</b> - the icon on their card. Burners steal at will, sluggers launch homers risk-free, eagle-eyes draw walks, and more. Players also run <b>hot</b> (boosted after back-to-back hits) or <b>cold</b> (slumping after outs). Tap a trait icon to read it.</p></section>`,
    `<section><h3>Coaches &amp; the dugout</h3><p>Coaches are your <b>build</b> (think Balatro's Jokers). They fill your <b>dugout</b> (8 slots) and trigger passively or in the right spot - bag boosts, rally bonuses, payoffs for sluggers or speedsters, and scaling coaches that grow all run. <b>Tap a coach icon</b> to see what it does; sell any for half its cost.</p></section>`,
    `<section><h3>Innings, frames &amp; bosses</h3><p>Each of the 9 innings has three frames: <b>Top</b>, <b>Middle</b>, and <b>Boss</b>, with the target climbing each step. The <b>Boss</b> frame is a special pitcher with a nasty rule, telegraphed on the linescore so you can prepare. You shop between every frame, or <b>skip</b> a Top/Middle frame to pocket a Tag instead. Win inning 9's Boss for the title, then <b>Extra Innings</b> scale up forever.</p></section>`,
    `<section><h3>Salami Cards</h3><p>Salami cards are one-shot <b>powerups</b> in your pouch (on the bar at the top of the screen). <b>Drag a Salami card onto one of your players</b> to boost a stat or grant a trait, or <b>drag it onto a coach</b> to duplicate that coach or mentor it for a permanent Rally aura. A few fire instantly instead, so you just tap them: an <b>Intentional Walk</b> (free runner), a <b>Momentum Shift</b> (+Rally), or a <b>Second Wind</b> (an extra out). Get them from a <b>Salami Pack</b> in the shop, or earn them by pulling off <b>feats</b> like a grand slam, a perfect inning, or back-to-back homers.</p></section>`,
    `<section><h3>Profile &amp; Collection</h3><p>Your <b>Profile</b> (home screen) tracks <b>57 achievements</b> across a dozen categories alongside your career stats. Open its <b>Collection</b> for a compendium of every <b>coach</b>, <b>Salami Card</b>, <b>Front Office</b> voucher, and <b>Skip Tag</b>: each stays locked until you acquire it in a run, and anything you have not found yet wears an <b>Undiscovered</b> tag when it shows up in the shop.</p></section>`,
    `<section><h3>The shop</h3><p>Between innings, spend <b>Payroll ($)</b> to build your club. <b>Coaches</b> and <b>Front Office</b> vouchers are bought directly. Everything else comes in <b>packs</b>: <b>drag a sealed pack into the open slot</b> (or just tap it) to open it, then <b>choose</b> what you want inside, or <b>skip</b> it. A <b>Prospect Pack</b> offers players, a <b>Scouting Pack</b> offers analytics and scouting cards, a <b>Salami Pack</b> offers Salami cards, a <b>Coaching Pack</b> offers coaches, and a <b>Spring Training</b> pack levels up your at-bat actions. Packs come in three sizes: <b>Normal</b> (pick 1 of 3), <b>Jumbo</b> (pick 1 of 5), and <b>Mega</b> (pick 2 of 5). Reroll for fresh stock. <em>You can't clear the late innings with your starting deck, so building is the point.</em></p></section>`,
    `<section><h3>Editions &amp; Spring Training</h3><p>Cards and coaches in packs can roll a shiny <b>edition</b>: <b>All-Star</b> (+2 Bag), <b>Silver Slugger</b> (+1.0 Rally), <b>Gold Glove</b> (that play scores at x1.5 Rally), <b>Hall of Fame</b> (+2 Bag and +0.5 Rally), and the rare <b>Legendary</b> (the biggest boost, and on a coach it takes no dugout slot). An edition fires whenever that card scores. Separately, <b>Spring Training</b> packs <b>level up an action</b> (Contact Swing, Power Swing, Work the Count, Bunt, Steal), so every safe play with that action builds your Rally faster. Levels show right on the swing buttons.</p></section>`,
    `<section class="howto-tips"><h3>${icon("sparkle")} Quick tips</h3><ul><li>Don't waste your slugger leading off - hold it until runners are on and the rally is built.</li><li>Thin your deck: fewer, better cards means you draw your bombs more often.</li><li>Two or three coaches pointing the same way beat a pile of random ones.</li></ul></section>`,
  ];
  const HOWTO_PAGES = [[0], [1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13], [14]];
  function showHowTo(page) {
    if (SFX && SFX.click) SFX.click();
    const np = HOWTO_PAGES.length;
    let p = page == null ? 0 : page;
    p = Math.max(0, Math.min(np - 1, p));
    STATE._howtoPage = p;
    const body = HOWTO_PAGES[p].map((i) => HOWTO_SECTIONS[i]).join("");
    const dots = HOWTO_PAGES.map((_, i) => `<span class="ht-dot ${i === p ? "on" : ""}"></span>`).join("");
    const first = p === 0, last = p === np - 1;
    overlay(`
      <div class="ov-card howto">
        <h2>How to Play <span class="howto-sub">Diamond Duel</span> <span class="howto-pageno">${p + 1}/${np}</span></h2>
        <div class="howto-body">${body}</div>
        <div class="howto-nav">
          <button class="btn btn-ghost" data-act="${first ? "close-ov" : "howto-prev"}">${first ? "Close" : icon("chevronL") + " Back"}</button>
          <div class="ht-dots">${dots}</div>
          <button class="btn btn-gold" data-act="${last ? "close-ov" : "howto-next"}">${last ? "Got it " + icon("check") : "Next " + icon("chevronR")}</button>
        </div>
      </div>`);
  }

  function overlay(html, lock) {
    let ov = $("#overlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "overlay"; document.body.appendChild(ov); }
    ov.className = "overlay show" + (lock ? " lock" : "");
    ov.innerHTML = `<div class="overlay-inner">${html}</div>`;
    wireOverlay();
  }
  function closeOverlay() {
    const ov = $("#overlay");
    if (ov) { ov.className = "overlay"; ov.innerHTML = ""; }
  }

  /* ============================================================
     MAP / BRACKET SCREEN
     ============================================================ */
  function renderMap() {
    const run = STATE.run;
    const gi = run.gameIndex;
    // a compact linescore: 8 inning columns, each with 3 frame cells (Top / Middle / Boss target)
    const inningCol = (ri, extra) => {
      const frames = [];
      for (let f = 0; f < GAMES_PER_ROUND; f++) {
        const idx = ri * GAMES_PER_ROUND + f;
        const boss = f === GAMES_PER_ROUND - 1;
        let cls = "ls-frame";
        cls += idx < gi ? " done" : (idx === gi ? " current" : " future");
        if (boss) cls += " boss";
        const tgt = Math.round(targetFor(idx) * (boss && bossFor(run, ri).rule === "ace" ? (CONFIG.aceTargetMult || 1.25) : 1));
        frames.push(`<div class="${cls}" title="${gameLabel(idx)} - target ${tgt}">${boss ? icon("diamond") : ""}<span class="lsf-t">${tgt}</span></div>`);
      }
      const now = (ri === inningOf(gi) - 1);
      return `<div class="ls-inning ${extra ? "ls-extra" : ""} ${now ? "ls-now" : ""}"><div class="ls-num">${extra ? "+" + (ri - ROUNDS.length + 1) : (ri + 1)}</div><div class="ls-frames">${frames.join("")}</div></div>`;
    };
    let cols = ROUNDS.map((rd, ri) => inningCol(ri, false)).join("");
    if (isExtraInnings(gi)) cols += inningCol(inningOf(gi) - 1, true);

    const pitcher = makePitcher(run, gi);
    const isBoss = pitcher.isBoss;
    const target = Math.round(targetFor(gi) * pitcher.targetMultiplier);
    const tArt = (typeof pitcherPortraitSVG === "function") ? `<div class="tele-art${isBoss ? " boss" : ""}">${pitcherPortraitSVG(pitcher)}</div>` : "";
    const telegraph = isBoss
      ? `<div class="boss-telegraph with-art">${tArt}<div class="tele-body"><div class="bt-tag">BOSS PITCHER</div><h3>${pitcher.name}</h3><p>${pitcher.boss.text}</p><div class="bt-stats">Stuff ${pitcher.stuff} · Command ${pitcher.command} · Target ${target}</div></div></div>`
      : `<div class="match-telegraph with-art">${tArt}<div class="tele-body"><h3>${pitcher.name}</h3><p>${pitcher.bats}HP starter.</p><div class="bt-stats">Stuff ${pitcher.stuff} · Command ${pitcher.command} · Target ${target}</div></div></div>`;

    return `
    <div class="screen run-screen map-screen">
      ${runSideHTML("map")}
      <div class="run-main">
        ${runTopHTML()}
        <div class="run-content map-inner">
          <div class="map-head">
            <h2>The Linescore ${isExtraInnings(gi) ? `<span class="ls-extra-tag">EXTRA INNINGS</span>` : ""}</h2>
            <div class="map-sub">${FRANCHISES.find(f => f.id === run.franchiseId).name}</div>
          </div>
          <div class="linescore">${cols}</div>
          ${tagTrayHTML(run)}
          <div class="map-next">
            <div class="mn-left">
              <div class="mn-round">${gameLabel(gi)}</div>
              ${telegraph}
            </div>
            <div class="mn-right">
              ${isSkippable(gi) ? (() => { const t = tagFor(gi); return `<div class="skip-offer">
                <div class="skip-cap">Skip and earn</div>
                <div class="tag-chip rar-${t.rarity || "common"}" data-tip="<b>${t.name}</b><br>${t.text}"><span class="tag-ic">${icon(t.icon)}</span><span class="tag-nm">${t.name}</span></div>
                <button class="btn btn-secondary skip-btn" data-act="skip-frame" data-tip="Skip this frame (no win reward, no shop) and take the tag instead.">Skip frame ${icon("fastForward")}</button>
              </div>`; })() : ""}
              <button class="btn btn-big btn-gold" data-act="play-game">Play Ball ${icon("chevronR")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }
  // chips for tags you are holding (resolve at the next shop / after the next Boss)
  function tagTrayHTML(run) {
    if (!run.tags || !run.tags.length) return "";
    const chips = run.tags.map((id) => { const t = getTag(id); return t ? `<div class="tag-chip held rar-${t.rarity || "common"}" data-tip="<b>${t.name}</b><br>${t.text}"><span class="tag-ic">${icon(t.icon)}</span><span class="tag-nm">${t.name}</span></div>` : ""; }).join("");
    return `<div class="tags-tray"><span class="tt-label">Tags held</span>${chips}</div>`;
  }

  /* ============================================================
     SHOP
     ============================================================ */
  // Selling from the pinned top rows (corner coin button on any chip). sellCoach /
  // sellCharm re-render whichever screen state is showing, incl. the inline pack stage.
  function stripSellAction(spec) {
    const parts = spec.split(":"), i = parseInt(parts[1], 10);
    if (parts[0] === "coach") sellCoach(i, "strip"); else sellCharm(i, "strip");
  }

  function enterShop() {
    STATE.shop = { reroll: 0, freeUsed: false };
    consumeTagsIntoShop();   // resolve held shop tags into free coaches/packs/voucher + flags
    rollShop();
    STATE.screen = "shop";
    render();
  }
  // Turn the held shop-type tags into concrete free items / flags stored on STATE.shop, so
  // they survive rerolls. Boss tags (Investment) stay in run.tags for the next Boss payout.
  function consumeTagsIntoShop() {
    const run = STATE.run, sh = STATE.shop;
    const fx = { freeCoaches: [], freePacks: [], voucherItem: null, coupon: false, freeReroll: false };
    const keep = [];
    const usedFx = new Set(run.dugout.map((c) => c.fx));
    let ci = 0;
    for (const id of run.tags) {
      const t = getTag(id);
      if (!t || t.when !== "shop") { keep.push(id); continue; }   // boss tags remain held
      const f = t.fx;
      if (f.kind === "freeCoach" || f.kind === "editionCoach") {
        let pool = COACHES.filter((c) => !usedFx.has(c.fx));
        if (f.rarity) { const rp = pool.filter((c) => c.rarity === f.rarity); if (rp.length) pool = rp; }
        if (pool.length) {
          const c = makeRNG(run.seed + ":tagcoach:" + run.gameIndex + ":" + (ci++)).pick(pool);
          usedFx.add(c.fx);
          const item = cloneCoach(c);
          if (f.ed) applyDeluxeToCoach(item, f.ed);
          fx.freeCoaches.push({ kind: "coach", item: item, cost: 0, free: true });
        }
      } else if (f.kind === "freePack") {
        const p = PACKS.find((x) => x.kind === f.packKind && x.size === (f.size || "")) || PACKS.find((x) => x.kind === f.packKind && !x.size);
        if (p) fx.freePacks.push({ kind: "pack", item: p, cost: 0, free: true });
      } else if (f.kind === "voucher") {
        const ownedUp = new Set(run.upgradesOwned);
        const vPool = UPGRADES.filter((u) => !ownedUp.has(u.id) && (!u.requires || ownedUp.has(u.requires)));
        if (vPool.length) fx.voucherItem = makeRNG(run.seed + ":tagvoucher:" + run.gameIndex).sample(vPool, 1).map((u) => ({ kind: "upgrade", item: u, cost: priceOf(u.cost) }))[0];
      } else if (f.kind === "coupon") fx.coupon = true;
      else if (f.kind === "freeReroll") fx.freeReroll = true;
    }
    run.tags = keep;
    sh.tagFx = fx;
    saveRun();
  }
  // Append the resolved free items + apply flags to the freshly rolled shop (runs every roll).
  function applyTagFxToShop() {
    const sh = STATE.shop, fx = sh.tagFx;
    if (!fx) return;
    if (fx.freeCoaches && fx.freeCoaches.length) sh.coaches = sh.coaches.concat(fx.freeCoaches);
    if (fx.freePacks && fx.freePacks.length) sh.packs = sh.packs.concat(fx.freePacks);
    // the Voucher Tag ADDS a voucher (it must never be silently lost to the inning's natural one)
    if (fx.voucherItem) sh.upgrades = (sh.upgrades && sh.upgrades.length) ? sh.upgrades.concat([fx.voucherItem]) : [fx.voucherItem];
    if (fx.coupon) { sh.coaches.forEach((s) => { s.cost = 0; }); (sh.upgrades || []).forEach((s) => { s.cost = 0; }); }
  }

  function rollShop() {
    const run = STATE.run;
    const sh = STATE.shop;
    const rng = makeRNG(run.seed + ":shop:" + run.gameIndex + ":" + sh.reroll);
    const round = Math.floor(run.gameIndex / GAMES_PER_ROUND);

    // coaches not already owned (direct buy)
    const ownedFx = new Set(run.dugout.map((c) => c.fx));
    const coachPool = COACHES.filter((c) => !ownedFx.has(c.fx));
    sh.coaches = rng.sample(coachPool, CONFIG.shop.coachSlots).map((c) => ({ kind: "coach", item: c, cost: priceOf(c.cost) }));

    // One Front Office voucher per inning, held steady across all 3 frames (seeded by
    // inning, independent of reroll). A tier-2 upgrade only appears once its base voucher
    // is owned; once you buy a voucher this inning, the slot stays empty until next inning.
    const ownedUp = new Set(run.upgradesOwned);
    const vPool = UPGRADES.filter((u) => !ownedUp.has(u.id) && (!u.requires || ownedUp.has(u.requires)));
    const vrng = makeRNG(run.seed + ":voucher:" + round);
    sh.upgrades = (run.lastVoucherInning === round || !vPool.length)
      ? []
      : vrng.sample(vPool, 1).map((u) => ({ kind: "upgrade", item: u, cost: priceOf(u.cost) }));

    // everything else is a sealed pack you drag open: one of each family (Prospect,
    // Scouting, Salami, Coaching), each rolled to a size (Normal / Jumbo / Mega).
    // Bigger packs get more likely the deeper into the run you are.
    const sizeRoll = () => rng.weighted([
      { v: "",      w: 100 },
      { v: "jumbo", w: 18 + round * 9 },
      { v: "mega",  w: 5 + round * 6 },
    ]);
    const packFor = (k) => {
      const size = sizeRoll();
      const p = PACKS.find((x) => x.kind === k && x.size === size) || PACKS.find((x) => x.kind === k && !x.size);
      return { kind: "pack", item: p, cost: priceOf(p.cost) };
    };
    // Balatro-style: only a subset of pack families shows per shop. Roll `packSlots` packs,
    // each an independent weighted pick (families can repeat), re-rolled on every shop reroll.
    const famPool = CONFIG.shop.packWeights || [{ v: "player", w: 1 }, { v: "scouting", w: 1 }, { v: "charm", w: 1 }, { v: "coach", w: 1 }, { v: "action", w: 1 }];
    const nPacks = CONFIG.shop.packSlots || 2;
    sh.packs = [];
    for (let i = 0; i < nPacks; i++) sh.packs.push(packFor(rng.weighted(famPool)));

    sh.bought = sh.bought || {}; // keys of consumed slots
    applyTagFxToShop();          // fold in free coaches/packs/voucher + coupon from skip tags
  }
  function priceOf(base) { return Math.max(1, base - (STATE.run.discount || 0) + stakeMods(STATE.run.stake).priceBump); }
  function rerollCost() {
    if (STATE.shop.tagFx && STATE.shop.tagFx.freeReroll) return 0;   // Discount Tag: free rerolls this shop
    const eco = CONFIG.economy;
    return Math.max(1, eco.rerollBase + eco.rerollStep * STATE.shop.reroll - (STATE.run.rerollDiscount || 0));
  }
  // shared pack styling helpers (used by the shop and the opening overlay)
  function packIcon(kind) { return ({ player: "bat", charm: "sparkle", analytics: "barChart", scouting: "eye", coach: "medal", action: "rocket" })[kind] || "layers"; }
  function packLabel(kind) { return ({ player: "PROSPECT", charm: "SALAMI", analytics: "SCOUTING", scouting: "SCOUTING", coach: "COACHING", action: "SPRING" })[kind] || "PACK"; }
  function actionIcon(id) { return ({ swing: "bat", power: "muscle", contact: "eye", bunt: "chevronsDown", steal: "arrowUpRight" })[id] || "rocket"; }

  function renderShop() {
    const run = STATE.run, sh = STATE.shop;
    const slotHTML = (slot, i, group) => {
      const owned = sh.bought[group + i];
      const it = slot.item;
      const aff = run.payroll >= slot.cost && !owned;
      let body = "";
      if (slot.kind === "coach") body = retroCardHTML({ kind: "coach", kindLabel: "COACH", art: coachFace(it), name: it.name, text: it.text, rarity: it.rarity });
      else body = retroCardHTML({ kind: "upgrade", kindLabel: "FRONT OFFICE", art: itemArt("upgrade", it), name: it.name, text: it.text, rarity: it.rarity });
      // a coach / seed / voucher you've never acquired before is flagged for the Collection
      const collectible = group === "coach" || group === "charm" || group === "up";
      const undisc = collectible && it.id && !isDiscovered(it.id);
      const free = slot.cost === 0 && !owned;
      return `
        <div class="shop-item ${owned ? "sold" : ""} ${aff ? "" : "cant"} ${free ? "free" : ""}" data-group="${group}" data-i="${i}">
          ${free ? `<span class="free-tag" data-tip="<b>Free</b><br>Granted by a skip tag.">${icon("sparkle")} Free</span>` : (undisc ? `<span class="undisc-tag" data-tip="<b>Undiscovered</b><br>New to your Collection. Buy it to add it.">${icon("book")} Undiscovered</span>` : "")}
          <div class="shop-item-body">${body}</div>
          <button class="btn buy-btn ${aff ? "" : "disabled"}" data-buy="${group}:${i}" ${owned ? "disabled" : ""}>${owned ? "Sold" : (slot.cost === 0 ? "Free" : "$" + slot.cost)}</button>
        </div>`;
    };

    const coaches = sh.coaches.map((s, i) => slotHTML(s, i, "coach")).join("") || emptyRow();
    const ups = sh.upgrades.map((s, i) => slotHTML(s, i, "up")).join("") || emptyRow();

    const packHTML = (slot, i) => {
      const it = slot.item;
      const owned = sh.bought["pack" + i];
      const aff = run.payroll >= slot.cost && !owned;
      const size = it.size || "";
      const choose = it.choose > 1 ? `PICK ${it.choose} OF ${it.count}` : `PICK 1 OF ${it.count}`;
      return `
        <div class="shop-pack kind-${it.kind} ${size ? "sz-" + size : ""} ${owned ? "opened" : ""} ${aff ? "" : "cant"}" data-packslot="${i}" data-tip="<b>${it.name}</b><br>${it.text}">
          <div class="pk-wrap kind-${it.kind}">
            <span class="pk-crimp pk-crimp-top"></span>
            <span class="pk-foil"></span>
            <div class="pk-art">${packArt(it.kind)}</div>
            <div class="pk-band"><span class="pk-band-name">${packLabel(it.kind)}</span><span class="pk-band-sub">PACK</span></div>
            <span class="pk-crimp pk-crimp-bot"></span>
            ${size ? `<span class="pk-size">${size === "mega" ? "MEGA" : "JUMBO"}</span>` : ""}
          </div>
          <div class="pk-cost">${owned ? "Opened" : "$" + slot.cost}</div>
        </div>`;
    };
    const packs = sh.packs.map((s, i) => packHTML(s, i)).join("");

    const dugFull = dugoutUsed(run) >= run.dugoutSlots;

    // while a pack is open, the shop's middle gives way to the inline pack stage;
    // the frame (sidebar + dugout/Salami rows) stays put and stays interactive
    if (STATE._pack) {
      return `
      <div class="screen run-screen shop-screen">
        ${runSideHTML("shop")}
        <div class="run-main">
          ${runTopHTML()}
          <div class="run-content">${packStageHTML()}</div>
        </div>
      </div>`;
    }
    return `
    <div class="screen run-screen shop-screen">
      ${runSideHTML("shop")}
      <div class="run-main">
        ${runTopHTML()}
        <div class="run-content shop-inner">
          <div class="shop-head">
            <div class="shop-title">The Shop <span class="shop-round">before ${gameLabel(run.gameIndex)}</span></div>
            <div class="shop-money">
              <button class="btn btn-reroll" data-act="reroll">Reroll (${rerollCost() === 0 ? "Free" : "$" + rerollCost()})</button>
              <button class="btn btn-big btn-gold" data-act="leave-shop">Proceed ${icon("chevronR")}</button>
            </div>
          </div>
          ${tagTrayHTML(run)}
          ${dugFull ? `<div class="shop-warn">Dugout full (${dugoutUsed(run)}/${run.dugoutSlots}). Sell a coach right from the row above to make room.</div>` : ""}
          <div class="shop-grid">
            <div class="shop-rowgrp shop-rowgrp-top">
              <div class="shop-section sec-coaches"><h3>Coaches</h3><div class="shop-row">${coaches}</div></div>
              <div class="shop-section sec-frontoffice"><h3>Front Office</h3><div class="shop-row">${ups}</div></div>
            </div>
            <div class="shop-section sec-packs">
              <h3>Packs <span class="sec-hint">drag a pack into the slot to open it, or just tap it</span></h3>
              <div class="pack-area">
                <div class="pack-open-slot" id="pack-slot">
                  <span class="pos-ico">${icon("layers")}</span>
                  <span class="pos-text"><b>Open a pack</b><span>drag one here</span></span>
                </div>
                <div class="pack-rack">${packs}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }
  function emptyRow() { return `<div class="shop-empty">- sold out -</div>`; }
  function cloneCardPreview(tpl, deluxe) { const c = cloneCard(tpl); if (deluxe) c.deluxe = deluxe; return c; }

  /* ---------- buying ---------- */
  function buy(group, i) {
    const run = STATE.run, sh = STATE.shop;
    if (STATE._pack || STATE._pick) return;   // finish resolving the current pack/pick first
    const key = group + i;
    if (sh.bought[key]) return;
    let slot;
    if (group === "coach") slot = sh.coaches[i];
    else if (group === "up") slot = sh.upgrades[i];
    else if (group === "pack") slot = sh.packs[i];
    if (!slot) return;
    if (run.payroll < slot.cost) { SFX.error(); shake(`.shop-item[data-group="${group}"][data-i="${i}"]`); return; }

    if (group === "coach") {
      // full dugout no longer blocks the buy: offer to sell a coach to make room (Balatro-style)
      if (dugoutUsed(run) >= run.dugoutSlots) { openMakeRoom("coach", () => { closeOverlay(); buy(group, i); }); return; }
      run.dugout.push(cloneCoach(slot.item));
      if (slot.item.deluxe === "legendary") unlockAchievement("legendary_dx");
      discover(slot.item.id);
      finishBuy(slot, key); render();
    } else if (group === "up") {
      applyUpgrade(slot.item);
      if (slot.item.requires) unlockAchievement("tier2_voucher");
      run.upgradesOwned.push(slot.item.id);
      run.lastVoucherInning = Math.floor(run.gameIndex / GAMES_PER_ROUND);
      discover(slot.item.id);
      finishBuy(slot, key); render();
    } else if (group === "pack") {
      // pay on open (Balatro-style): the cost is committed before you see the cards,
      // so refreshing mid-pack can't refund it.
      finishBuy(slot, key);
      openPack(slot.item, () => { render(); });
    }
  }
  function finishBuy(slot, key) {
    STATE.run.payroll -= slot.cost;
    STATE.shop.bought[key] = true;
    STATE.run.shopBuys += 1;
    SFX.buy();
    setText("shop-payroll", STATE.run.payroll);
    setText("payroll-amt", STATE.run.payroll);   // the persistent run bar
    checkBuildAch(STATE.run);
    saveRun();
  }

  function applyUpgrade(u) {
    const run = STATE.run;
    // legacy fx vouchers (the 7 originals)
    switch (u.fx) {
      case "dugoutSlot": run.dugoutSlots += 1; break;
      case "handSize": run.handSize += 1; break;
      case "discount": run.discount += 1; break;
      case "shopSlot": run.extraCardSlots += 1; break;
      case "rerollCheap": run.rerollDiscount += 1; break;
      case "startRally": run.startRally = Math.max(run.startRally, 1.5); break;
      case "interest": run.interestCap = 8; break;
    }
    // data-driven mods (tier-2 upgrades + the new base vouchers)
    const m = u.mods;
    if (m) {
      if (m.dugoutSlots) run.dugoutSlots += m.dugoutSlots;
      if (m.handSize) run.handSize += m.handSize;
      if (m.discount) run.discount += m.discount;
      if (m.extraCardSlots) run.extraCardSlots += m.extraCardSlots;
      if (m.rerollDiscount) run.rerollDiscount += m.rerollDiscount;
      if (m.charmSlots) run.charmSlots += m.charmSlots;
      if (m.payroll) run.payroll += m.payroll;
      if (m.interestCap) run.interestCap += m.interestCap;
      if (m.interestCapAbs) run.interestCap = Math.max(run.interestCap, m.interestCapAbs);
      if (m.startRally) run.startRally = Math.max(run.startRally, m.startRally);
      if (m.startRallyAdd) run.startRally += m.startRallyAdd;
      if (m.editionBoost) run.editionBoost = (run.editionBoost || 0) + m.editionBoost;
      if (m.springLevel) { for (const k in run.actionLevels) run.actionLevels[k] = Math.max(run.actionLevels[k], m.springLevel); }
      if (m.deckStat) run.deck.forEach((c) => {
        ["contact", "power", "eye", "speed"].forEach((s) => { if (typeof c[s] === "number") c[s] = Math.min(140, c[s] + m.deckStat); });
      });
    }
    toast(`${u.name} acquired.`);
  }
  function doReroll() {
    const run = STATE.run, sh = STATE.shop;
    let cost = rerollCost();
    if (Engine.hasCoach(run, "signStealer") && !sh.freeUsed) { cost = 0; sh.freeUsed = true; }
    if (run.payroll < cost) { SFX.error(); toast("Not enough payroll to reroll."); return; }
    run.payroll -= cost;
    sh.reroll += 1;
    rollShop();
    SFX.click();
    render();
  }

  /* ---------- scouting picker ---------- */
  function openScoutingPicker(report, onApply) {
    const run = STATE.run;
    // 'release' or 'copy' or 'edition' or 'bump' or 'switch'
    const cards = run.deck.map((c, i) => `<div class="pick-card" data-pick="${i}">${cardHTML(c, null)}</div>`).join("");
    overlay(`
      <div class="ov-card picker">
        <h2>${report.name}</h2>
        <div class="ov-sub">${report.text}</div>
        <div class="picker-grid">${cards}</div>
        <button class="btn btn-ghost" data-act="cancel-pick">Cancel</button>
      </div>`);
    STATE._pick = { report, onApply };
  }
  function applyScouting(cardIndex) {
    const run = STATE.run;
    const ctx = STATE._pick;
    if (!ctx) return;
    const report = ctx.report;
    const card = run.deck[cardIndex];
    if (!card) return;
    let ok = true;
    if (report.op === "edition") {
      if (report.arg === "foil") {
        // bump two stats and mark foil
        card.contact = Math.min(130, card.contact + CONFIG.edition.foilStatBump);
        card.power = Math.min(130, card.power + CONFIG.edition.foilStatBump);
      }
      card.edition = report.arg;
    } else if (report.op === "switch") {
      card.bats = "S";
    } else if (report.op === "bump") {
      card[report.arg] = Math.min(130, card[report.arg] + 12);
    } else if (report.op === "copy") {
      run.deck.push(cloneCard(card));
    } else if (report.op === "destroy") {
      if (card.edition === "veteran") { ok = false; toast("Veterans can't be released."); }
      else { run.deck.splice(cardIndex, 1); run.payroll += CONFIG.economy.sellRefundCard; }
    }
    if (ok) {
      SFX.coin();
      closeOverlay();
      const cb = ctx.onApply; STATE._pick = null;
      if (cb) cb();
    }
  }

  /* ---------- pack opening ---------- */
  function openPack(pack, onDone) {
    const run = STATE.run;
    if (!runIsSeeded()) { META.career.packsOpened = (META.career.packsOpened || 0) + 1; saveMeta(); checkCareerAch(); }
    const rng = makeRNG(run.seed + ":pack:" + run.gameIndex + ":" + run.shopBuys);
    // Scouting Network vouchers + The Scouts lineup widen every pack you open
    const count = pack.count + (run.extraCardSlots || 0);
    let options = [];
    if (pack.kind === "player") {
      const round = Math.floor(run.gameIndex / GAMES_PER_ROUND);
      let rar = ["common", "star"];
      if (round >= 1 || pack.size) rar.push("allstar");   // jumbo/mega packs can roll stronger cards
      if (round >= 2) rar.push("legend");
      // never offer a player you already employ (duplicates only via Clone Project);
      // fall back to the full pool if the deck has grown so large the filter runs dry
      const owned = new Set(run.deck.map((c) => c.id));
      let pool = PLAYERS.filter((p) => rar.indexOf(p.rarity) >= 0 && !owned.has(p.id));
      if (pool.length < count) pool = PLAYERS.filter((p) => rar.indexOf(p.rarity) >= 0);
      options = rng.sample(pool, count).map((p) => ({ kind: "card", item: p, deluxe: rollDeluxe(rng) }));
    } else if (pack.kind === "coach") {
      const ownedFx = new Set(run.dugout.map((c) => c.fx));
      const pool = COACHES.filter((c) => !ownedFx.has(c.fx));
      options = rng.sample(pool, count).map((c) => ({ kind: "coach", item: c, deluxe: rollDeluxe(rng) }));
    } else if (pack.kind === "scouting" || pack.kind === "analytics") {
      // a Scouting pack mixes analytics and scouting reports
      const pool = ANALYTICS.concat(SCOUTING);
      options = rng.sample(pool, count).map((c) => ({ kind: c.kind, item: c }));
    } else if (pack.kind === "charm") {
      options = rng.sample(CHARMS, count).map((c) => ({ kind: "charm", item: c }));
    } else if (pack.kind === "action") {
      // Spring Training: each option levels up an at-bat action (max 5 distinct actions)
      options = rng.sample(ACTIONS, count).map((a) => ({ kind: "action", item: a }));
    }
    STATE._pack = { pack, options, picksLeft: pack.choose, onDone, picked: [] };
    render();   // the shop's content gives way to the inline pack stage
  }
  // The pack reveal is NOT a modal: the shop's middle simply gives way to the dealt
  // cards (Balatro-style) while the run frame - sidebar + the big dugout/Salami rows -
  // stays on screen and fully interactive above.
  function packStageHTML() {
    const ctx = STATE._pack;
    if (!ctx) return "";
    const run = STATE.run;
    const firstOpen = !ctx.opened;            // play the tear-open + deal animation only once
    ctx.opened = true;
    const opts = ctx.options.map((o, i) => {
      const picked = ctx.picked.indexOf(i) >= 0;
      let body;
      if (o.kind === "card") body = cardHTML(cloneCardPreview(o.item, o.deluxe), null);
      else if (o.kind === "action") {
        const lvl = (run.actionLevels && run.actionLevels[o.item.id]) || 1;
        body = retroCardHTML({ kind: "action", kindLabel: "SPRING TRAINING", art: itemArt("action", o.item), name: o.item.name, sub: `Lv ${lvl} &gt; ${lvl + 1}`, text: o.item.text });
      } else if (o.kind === "coach") {
        body = retroCardHTML({ kind: "coach", kindLabel: "COACH", art: coachFace(o.item), name: o.item.name, text: o.item.text, rarity: o.item.rarity, deluxe: o.deluxe });
      } else if (o.kind === "charm") {
        body = retroCardHTML({ kind: "charm", kindLabel: "SALAMI CARD", art: itemArt("charm", o.item), name: o.item.name, text: o.item.text, rarity: o.item.rarity });
      } else if (o.kind === "analytics") {
        body = retroCardHTML({ kind: "analytics", kindLabel: "ANALYTICS", art: itemArt("analytics", o.item), name: o.item.name, text: o.item.text, rarity: o.item.rarity });
      } else {
        body = retroCardHTML({ kind: "scouting", kindLabel: "SCOUT REPORT", art: itemArt("scouting", o.item), name: o.item.name, text: o.item.text, rarity: o.item.rarity });
      }
      return `<div class="pack-opt ${picked ? "picked" : ""}" data-packpick="${i}" style="--deal:${i}">${body}${picked ? '<div class="pick-check">' + icon("check") + '</div>' : ""}</div>`;
    }).join("");
    const left = ctx.picksLeft;
    const btnLabel = left === 0 ? "Done " + icon("check") : (ctx.picked.length ? "Skip rest" : "Skip pack");
    const burst = firstOpen ? `<div class="pack-burst kind-${ctx.pack.kind}">
        <div class="pkb-half pkb-top"><span class="pk-ico">${icon(packIcon(ctx.pack.kind))}</span></div>
        <div class="pkb-half pkb-bot"><span class="pk-label">${packLabel(ctx.pack.kind)}</span></div>
        <div class="pkb-rip"></div>
        <div class="pkb-flash"></div>
      </div>` : "";
    return `
      <div class="pack-stage ${firstOpen ? "pk-opening" : ""}">
        ${burst}
        <h2 class="ps-title"><span class="h2-ico">${icon("layers")}</span> ${ctx.pack.name}</h2>
        <div class="ps-sub">Choose ${ctx.pack.choose} of ${ctx.options.length}.${left > 0 ? " (" + left + " left)" : ""}${ctx.pack.kind !== "player" && left > 0 ? ` <span class="ps-hint">tap a card, or drag it up into its row</span>` : ""}</div>
        <div class="pack-grid ${firstOpen ? "pack-deal" : ""}">${opts}</div>
        <button class="btn btn-big ${left === 0 ? "btn-gold" : "btn-ghost"} ps-done" data-act="pack-done">${btnLabel}</button>
      </div>`;
  }
  function packPick(i) {
    const ctx = STATE._pack;
    if (!ctx || ctx.picksLeft <= 0) return;
    if (ctx.picked.indexOf(i) >= 0) return;
    const o = ctx.options[i];
    const run = STATE.run;
    if (o.kind === "card") { const c = cloneCard(o.item); if (o.deluxe) c.deluxe = o.deluxe; run.deck.push(c); if (o.deluxe === "legendary") unlockAchievement("legendary_dx"); }
    else if (o.kind === "coach") {
      if (dugoutUsed(run) >= run.dugoutSlots) { openMakeRoom("coach", () => packPick(i)); return; }
      const c = cloneCoach(o.item); if (o.deluxe) applyDeluxeToCoach(c, o.deluxe);
      run.dugout.push(c);
      if (o.deluxe === "legendary") unlockAchievement("legendary_dx");
      discover(o.item.id);
    } else if (o.kind === "action") {
      run.actionLevels[o.item.id] = ((run.actionLevels[o.item.id]) || 1) + 1;
    } else if (o.kind === "scouting") {
      // scouting reports apply to a chosen card after the pack closes
      STATE._pendingScout = STATE._pendingScout || [];
      STATE._pendingScout.push(o.item);
    } else if (o.kind === "charm") {
      if (run.charms.length >= run.charmSlots) { openMakeRoom("charm", () => packPick(i)); return; }
      run.charms.push(o.item.id);
      discover(o.item.id);
    } else if (o.kind === "analytics") {
      run.analytics[o.item.key] = (run.analytics[o.item.key] || 0) + 1;
    }
    ctx.picked.push(i);
    ctx.picksLeft -= 1;
    SFX.buy();
    saveRun();   // a pick is permanent the moment it's made (refresh-proof)
    render();
    if (ctx.picksLeft === 0) {
      setTimeout(() => packDone(), 350);
    }
  }
  function packDone() {
    const ctx = STATE._pack;
    if (!ctx) return;
    const cb = ctx.onDone;
    STATE._pack = null;
    closeOverlay();   // clears any picker/make-room overlay left above the stage
    // resolve any pending scouting reports from the pack, one at a time
    if (STATE._pendingScout && STATE._pendingScout.length) {
      const next = STATE._pendingScout.shift();
      openScoutingPicker(next, () => { if (STATE._pendingScout.length) { const n = STATE._pendingScout.shift(); openScoutingPicker(n, finalize); } else finalize(); });
      function finalize() { if (cb) cb(); render(); }
    } else {
      if (cb) cb(); else render();
    }
  }

  /* ---------- deck / dugout inspectors ---------- */
  function openDeckView(page) {
    const run = STATE.run;
    const sorted = run.deck.slice().sort((a, b) => (RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]) || (b.power - a.power));
    const PER = 18;                                  // 9 per row × 2 rows - fits with no scroll
    const pages = Math.max(1, Math.ceil(sorted.length / PER));
    let p = (page == null) ? 0 : page;
    p = Math.max(0, Math.min(pages - 1, p));
    STATE._deckPage = p;
    const cards = sorted.slice(p * PER, p * PER + PER).map((c) => `<div class="deck-card">${cardHTML(c, null)}</div>`).join("");
    const nav = pages > 1 ? `<div class="deck-nav">
        <button class="btn btn-ghost" data-act="deck-prev" ${p === 0 ? "disabled" : ""}>${icon("chevronL")} Prev</button>
        <span class="deck-page">Page ${p + 1} / ${pages}</span>
        <button class="btn btn-ghost" data-act="deck-next" ${p >= pages - 1 ? "disabled" : ""}>Next ${icon("chevronR")}</button>
      </div>` : "";
    overlay(`
      <div class="ov-card deck-view">
        <h2>Your Deck (${run.deck.length})</h2>
        <div class="deck-grid">${cards}</div>
        ${nav}
        <button class="btn btn-gold" data-act="close-ov">Close</button>
      </div>`);
  }
  function openDugoutView() {
    const run = STATE.run;
    const cells = run.dugout.map((c, i) => {
      const sub = (c.state && c.state.bonus) ? `<span class="coach-scale">+${c.state.bonus.toFixed(1)}</span>` : "";
      const glyph = c.icon ? icon(c.icon) : icon("star");
      return `
      <div class="dug-cell">
        <div class="coach-chip rar-${c.rarity}" data-coach="${c.id}" data-uid="${c.uid}" data-tip="<b>${c.name}</b><br>${c.text}">
          <span class="coach-chip-ico">${glyph}</span>
          <div class="coach-chip-body"><div class="coach-name">${c.name}${sub}</div></div>
        </div>
        <button class="btn btn-sell" data-sell="${i}">Sell +$${Math.max(1, Math.floor(c.cost / 2))}</button>
      </div>`;
    }).join("") || `<div class="shop-empty">No coaches yet.</div>`;
    overlay(`
      <div class="ov-card dugout-view">
        <h2>Dugout (${dugoutUsed(run)}/${run.dugoutSlots})</h2>
        <div class="ov-sub">Tap a coach to see what it does · sell any for half its cost.</div>
        <div class="dug-list">${cells}</div>
        <button class="btn btn-gold" data-act="close-ov">Close</button>
      </div>`);
  }
  function sellCoach(i, ctx) {
    const run = STATE.run;
    const c = run.dugout[i];
    if (!c) return;
    const refund = Math.max(1, Math.floor(c.cost / 2));
    run.payroll += refund;
    run.dugout.splice(i, 1);
    SFX.coin();
    toast(`Sold ${c.name} for $${refund}.`);
    saveRun();
    if (!ctx) openDugoutView();   // make-room / the top rows handle their own re-render
    if (STATE.screen === "shop" || STATE.screen === "map") render();   // covers the inline pack stage too
    if (STATE.screen === "game") { renderDugout(); setText("payroll-amt", run.payroll); }
  }

  /* ============================================================
     toast + shake
     ============================================================ */
  let toastTimer = null;
  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ""; }, 2200);
  }
  function shake(sel) { const el = $(sel); if (el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); } }

  /* ============================================================
     utilities
     ============================================================ */
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
  const FRAME_NAMES = ["Top", "Middle", "Boss"];
  function inningOf(gi) { return Math.floor(gi / GAMES_PER_ROUND) + 1; }        // 1-based inning (ante)
  function frameOf(gi) { return gi % GAMES_PER_ROUND; }                          // 0=Top, 1=Middle, 2=Boss
  function isBossInning(gi) { return frameOf(gi) === GAMES_PER_ROUND - 1; }      // the Boss frame
  function isExtraInnings(gi) { return inningOf(gi) > ROUNDS.length; }           // past inning 8
  function roundName(gi) { return isExtraInnings(gi) ? "Extra Innings " + (inningOf(gi) - ROUNDS.length) : "Inning " + inningOf(gi); }
  function gameLabel(gi) { return roundName(gi) + " · " + (isBossInning(gi) ? "Boss" : FRAME_NAMES[frameOf(gi)]); }
  // target for a frame: base * growth^(inning-1) * frameMult[frame]; extends into Extra Innings.
  // difficulty stakes: cumulative modifiers, keyed off run.stake (1..5)
  function stakeMods(stake) {
    stake = Math.max(1, Math.min(STAKES.length, stake || 1));
    return {
      targetMult: 1 + 0.08 * (stake - 1),          // 1.00 / 1.08 / 1.16 / 1.24 / 1.32
      pitcherBonus: stake >= 3 ? (stake - 2) * 2 + 1 : 0,  // +3 / +5 / +7
      priceBump: stake >= 4 ? 1 : 0,
      handDelta: stake >= 5 ? -1 : 0,
    };
  }
  function targetFor(gi) {
    const t = CONFIG.target;
    const mult = (STATE.run ? stakeMods(STATE.run.stake).targetMult : 1);
    const scale = CONFIG.scoreScale || 1;
    const raw = t.base * Math.pow(t.inningGrowth, inningOf(gi) - 1) * (t.frameMult[frameOf(gi)] || 1) * mult * scale;
    // round to a clean multiple of 5 so the grand numbers read nicely
    return Math.max(1, Math.round(raw / 5) * 5);
  }
  /* ============================================================
     SAVE / LOAD
     ============================================================ */
  function saveRun() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(STATE.run)); } catch (e) {}
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(GAME_KEY); } catch (e) {} }
  function loadRun() {
    try {
      const r = JSON.parse(localStorage.getItem(SAVE_KEY));
      return r || null;
    } catch (e) { return null; }
  }
  // ---- in-inning save/resume: persist the live game so a refresh keeps your progress ----
  function saveGame() {
    try {
      const g = STATE.game;
      if (!g || g.ended) { localStorage.removeItem(GAME_KEY); return; }
      const rngState = (STATE.rng && typeof STATE.rng.state === "function") ? STATE.rng.state() : null;
      localStorage.setItem(GAME_KEY, JSON.stringify({ gi: g.gameIndex, rng: rngState, game: g }));
    } catch (e) {}
  }
  function clearGameSave() { try { localStorage.removeItem(GAME_KEY); } catch (e) {} }
  function loadGameSnap() {
    try { return JSON.parse(localStorage.getItem(GAME_KEY)) || null; } catch (e) { return null; }
  }

  /* ============================================================
     EVENT WIRING
     ============================================================ */
  function wireScreen() {
    const root = $("#app");
    if (!root) return;

    root.onclick = (e) => {
      // selling takes precedence over tooltips (sell at all times)
      const charmSellEl = e.target.closest("[data-charmsell]");
      if (charmSellEl) { if (TIP) TIP.hide(); sellCharm(parseInt(charmSellEl.getAttribute("data-charmsell"), 10)); return; }
      const stripSellEl = e.target.closest("[data-stripsell]");
      if (stripSellEl) { if (TIP) TIP.hide(); stripSellAction(stripSellEl.getAttribute("data-stripsell")); return; }
      // explainer tooltips (info button + coach/trait badges) - pin on tap, toggle off
      const tipEl = tipTargetOf(e);
      if (tipEl) { if (TIP) TIP.toggle(tipEl, e.clientX, e.clientY); return; }
      if (TIP) TIP.hide();

      const seedEl = e.target.closest("[data-seed]");
      if (seedEl) { copySeed(seedEl.getAttribute("data-seed")); return; }
      const charmEl = e.target.closest("[data-charm]");
      if (charmEl && !charmEl.classList.contains("empty")) {
        if (_suppressCharmClick) { _suppressCharmClick = false; return; }   // a drag already handled it
        if (STATE.screen === "game") useCharm(parseInt(charmEl.getAttribute("data-charm"), 10));
        else openSalamiView();   // outside play, a pouch chip opens the pouch view
        return;
      }
      const act = e.target.closest("[data-act]");
      const dotEl = e.target.closest("[data-lineup-dot]");
      const stakeEl = e.target.closest("[data-stake]");
      const buyEl = e.target.closest("[data-buy]");
      const packTapEl = e.target.closest("[data-packslot]");
      const packpickEl = e.target.closest("[data-packpick]");
      const apEl = e.target.closest("[data-approach]");
      const sellEl = e.target.closest("[data-sell]");
      const sendEl = e.target.closest("[data-send]");

      if (packpickEl) {
        if (_suppressOptClick) { _suppressOptClick = false; return; }   // a drag already claimed it
        packPick(parseInt(packpickEl.getAttribute("data-packpick"), 10)); return;
      }
      if (dotEl) { STATE._pickIndex = parseInt(dotEl.getAttribute("data-lineup-dot"), 10); if (SFX.click) SFX.click(); render(); return; }
      if (stakeEl) { const s = parseInt(stakeEl.getAttribute("data-stake"), 10); if (s <= (META.maxStake || 1)) { STATE._pickStake = s; if (SFX.click) SFX.click(); render(); } else if (SFX.error) SFX.error(); return; }
      if (buyEl) { const [g, i] = buyEl.getAttribute("data-buy").split(":"); buy(g, parseInt(i, 10)); return; }
      if (packTapEl && STATE.screen === "shop") {
        if (_suppressPackClick) { _suppressPackClick = false; return; }   // a drag already opened it
        buy("pack", parseInt(packTapEl.getAttribute("data-packslot"), 10)); return;
      }
      if (STATE.screen === "game" && sendEl && !STATE.busy) { sendRunner(parseInt(sendEl.getAttribute("data-send"), 10)); return; }
      if (STATE.screen === "game" && apEl && !STATE.busy) { commitAtBat(apEl.getAttribute("data-approach")); return; }
      if (sellEl) { sellCoach(parseInt(sellEl.getAttribute("data-sell"), 10)); return; }
      // note: tapping/dragging a hand card to bat is handled by the pointer-drag system
      if (!act) return;
      handleAct(act.getAttribute("data-act"));
    };
  }

  function handleAct(a) {
    switch (a) {
      case "continue": resumeRun(); break;
      case "abandon": confirmAbandon("close-ov"); break;
      case "toggle-sound": META.sound = !META.sound; SFX.setEnabled(META.sound); saveMeta(); render(); break;
      case "toggle-sound-menu": META.sound = !META.sound; SFX.setEnabled(META.sound); saveMeta(); showMenu(); break;
      case "play-game": startGame(); break;
      case "skip-frame": skipFrame(); break;
      case "cancel-atbat": cancelAtBat(); break;
      case "open-deck": openDeckView(0); break;
      case "deck-prev": openDeckView((STATE._deckPage || 0) - 1); break;
      case "deck-next": openDeckView((STATE._deckPage || 0) + 1); break;
      case "open-dugout": openDugoutView(); break;
      case "open-salami": openSalamiView(); break;
      case "charm-confirm": { const ctx = STATE._charm; if (ctx && applyImmediateCharm(ctx.charm)) { closeOverlay(); consumeCharm(ctx.index); saveGame(); } STATE._charm = null; break; }
      case "cancel-charm": closeOverlay(); STATE._charm = null; break;
      case "reroll": doReroll(); break;
      case "pack-done": packDone(); break;
      case "leave-shop": STATE.screen = "map"; saveRun(); render(); break;
      case "to-shop": closeOverlay(); enterShop(); break;
      case "extra-innings": closeOverlay(); saveRun(); enterShop(); break;   // continue a won run into Extra Innings
      // menu system
      case "open-menu": showMenu(); break;
      case "menu-resume": closeOverlay(); break;
      case "back-to-menu": showMenu(); break;
      case "open-stats": showStats(); break;
      case "open-profile": showProfile(); break;
      case "open-collection": showCollection(); break;
      case "howto": showHowTo(0); break;
      case "howto-next": showHowTo((STATE._howtoPage || 0) + 1); break;
      case "howto-prev": showHowTo((STATE._howtoPage || 0) - 1); break;
      case "to-menu": closeOverlay(); if (STATE.run) saveRun(); STATE.screen = "title"; render(); break;
      case "abandon-run": confirmAbandon("back-to-menu"); break;
      case "replay-seed": if (STATE.run) replaySeed(STATE.run.seed, STATE.run.franchiseId); break;
      case "abandon-confirm": clearSave(); STATE.run = null; STATE.game = null; closeOverlay(); STATE.screen = "title"; render(); break;
      case "prev-lineup": STATE._pickIndex = ((STATE._pickIndex || 0) - 1 + FRANCHISES.length) % FRANCHISES.length; if (SFX.click) SFX.click(); render(); break;
      case "next-lineup": STATE._pickIndex = ((STATE._pickIndex || 0) + 1) % FRANCHISES.length; if (SFX.click) SFX.click(); render(); break;
      case "confirm-start": case "confirm-newrun": { const id = (STATE._pendingFranchise) || FRANCHISES[STATE._pickIndex || 0].id; STATE._pendingFranchise = null; doStartRun(id); break; }
      case "retry-run": closeOverlay(); STATE.run = null; STATE.game = null; STATE.screen = "title"; render(); break;
      case "to-title": closeOverlay(); STATE.screen = "title"; render(); break;
      case "close-ov": closeOverlay(); break;
    }
  }

  function wireOverlay() {
    const ov = $("#overlay");
    if (!ov) return;
    ov.onclick = (e) => {
      const seedEl = e.target.closest("[data-seed]");
      if (seedEl) { copySeed(seedEl.getAttribute("data-seed")); return; }
      // selling from the pinned build strip beats tooltips (Balatro-style, mid-pack too)
      const stripSellEl = e.target.closest("[data-stripsell]");
      if (stripSellEl) { if (TIP) TIP.hide(); stripSellAction(stripSellEl.getAttribute("data-stripsell")); return; }
      // explainer tooltips inside overlays (deck cards' info button, dugout coach badges)
      const tipEl = tipTargetOf(e);
      if (tipEl) { if (TIP) TIP.toggle(tipEl, e.clientX, e.clientY); return; }
      if (TIP) TIP.hide();
      // tap the dimmed backdrop to dismiss simple overlays (not pickers / packs / locked screens)
      if ((e.target.id === "overlay" || e.target.classList.contains("overlay-inner")) && !STATE._pick && !STATE._pack && !STATE._charm && !ov.classList.contains("lock")) {
        closeOverlay(); return;
      }
      const act = e.target.closest("[data-act]");
      const pick = e.target.closest("[data-pick]");
      const sellEl = e.target.closest("[data-sell]");
      const mrsellEl = e.target.closest("[data-mrsell]");
      const pouchSellEl = e.target.closest("[data-pouchsell]");
      const speedEl = e.target.closest("[data-speed]");
      if (pick) { applyScouting(parseInt(pick.getAttribute("data-pick"), 10)); return; }
      if (pouchSellEl) { sellCharm(parseInt(pouchSellEl.getAttribute("data-pouchsell"), 10)); openSalamiView(); return; }
      if (mrsellEl) { makeRoomSell(mrsellEl.getAttribute("data-mrsell")); return; }
      if (sellEl) { sellCoach(parseInt(sellEl.getAttribute("data-sell"), 10)); return; }
      if (speedEl) { setSpeed(parseInt(speedEl.getAttribute("data-speed"), 10)); return; }
      if (!act) return;
      const v = act.getAttribute("data-act");
      if (v === "cancel-pick") { closeOverlay(); STATE._pick = null; return; }
      if (v === "cancel-makeroom") { closeMakeRoom(); return; }
      handleAct(v);
    };
  }

  function startFromFranchise(id) {
    openFranchisePopup(id); // seed + confirm popup (also warns if a run is in progress)
  }
  function resumeRun() {
    const r = loadRun();
    if (!r) { render(); return; }
    STATE.run = r;
    STATE._replaySeed = null; STATE._replayFranchise = null;
    // guard against version drift
    if (!r.analytics) r.analytics = { power: 0, contact: 0, patience: 0, speed: 0, rally: 0 };
    if (!r.charms) r.charms = [];
    if (r.charmSlots == null) r.charmSlots = CONFIG.charmSlots;
    if (!r.achEarned) r.achEarned = {};
    if (!r.tags) r.tags = [];
    if (r.skips == null) r.skips = 0;
    if (r.handBonusNext == null) r.handBonusNext = 0;
    if (r.rallyBonusNext == null) r.rallyBonusNext = 0;
    if (r.editionBoost == null) r.editionBoost = 0;
    if (r.lastVoucherInning == null) r.lastVoucherInning = -1;
    // resume an in-progress inning if one was saved (refresh mid-game)
    const snap = loadGameSnap();
    // uid hygiene: the uid counter resets on reload, so raise it past every saved uid
    // (otherwise the first new clone would collide with a loaded card and Salami drags
    // could buff the wrong object).
    const maxUid = (arrs) => { let m = 0; arrs.forEach((a) => (a || []).forEach((o) => { const n = o && o.uid ? parseInt(String(o.uid).split("_").pop(), 10) : 0; if (n > m) m = n; })); return m; };
    uid.bump(maxUid([r.deck, r.dugout, snap && snap.game && snap.game.deck, snap && snap.game && snap.game.hand, snap && snap.game && snap.game.discard]));
    if (snap && snap.game && !snap.game.ended && snap.gi === r.gameIndex) {
      // re-link the snapshot's cards (deep JSON copies) back to the run.deck objects by uid,
      // so Salami buffs / Prospect growth / streaks stay shared after a refresh.
      const byUid = {};
      r.deck.forEach((c) => { byUid[c.uid] = c; });
      const relink = (a) => (a || []).map((c) => (c && byUid[c.uid]) || c);
      snap.game.deck = relink(snap.game.deck);
      snap.game.hand = relink(snap.game.hand);
      snap.game.discard = relink(snap.game.discard);
      (snap.game.bases || []).forEach((b) => { if (b && b.card && byUid[b.card.uid]) b.card = byUid[b.card.uid]; });
      STATE.game = snap.game;
      STATE.rng = makeRNG(r.seed + ":game:" + r.gameIndex, snap.rng);
      STATE.atBat = null;
      STATE.screen = "game";
      render();
      return;
    }
    clearGameSave();
    STATE.screen = "map";
    render();
  }

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !STATE._pick && !STATE._pack) {
      const ov = document.getElementById("overlay");
      if (ov && ov.classList.contains("show") && !ov.classList.contains("lock")) { closeOverlay(); return; }
    }
    if (STATE.screen !== "game" || STATE.busy) return;
    if (STATE.atBat && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); commitAtBat("swing"); return; }
    if (STATE.atBat && (e.key === "Escape")) { cancelAtBat(); return; }
    if (e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < STATE.game.hand.length) selectBatter(idx);
    }
  });

  /* ============================================================
     BOOT
     ============================================================ */
  // Scale the fixed 1600x900 stage to fit the viewport (landscape, no scroll).
  const STAGE_W = 1600;
  let _lastFit = "";
  function fitStage() {
    const stage = document.getElementById("stage");
    if (!stage) return;
    // Use the *visual* viewport (true visible area, excluding the mobile URL bar)
    const vp = window.visualViewport;
    const w = vp ? vp.width : window.innerWidth;
    const h = vp ? vp.height : window.innerHeight;
    const ox = vp ? vp.offsetLeft : 0;
    const oy = vp ? vp.offsetTop : 0;
    const key = Math.round(w) + "x" + Math.round(h) + "+" + Math.round(ox) + "+" + Math.round(oy);
    if (key === _lastFit) return; // cheap no-op when nothing changed
    _lastFit = key;
    // Adaptive aspect: lock the design WIDTH and derive the height from the viewport's
    // aspect ratio, so the stage fills the screen edge-to-edge on any landscape device
    // (no letterbox bands) and the layout uses the full width.
    const aspect = w / Math.max(1, h);
    const stageH = Math.max(660, Math.min(1180, Math.round(STAGE_W / aspect)));
    const s = Math.min(w / STAGE_W, h / stageH);
    stage.style.width = STAGE_W + "px";
    stage.style.height = stageH + "px";
    stage.style.left = (ox + w / 2) + "px";
    stage.style.top = (oy + h / 2) + "px";
    stage.style.transform = "translate(-50%,-50%) scale(" + s + ")";
    // portrait gate: only for touch / small screens (never on desktop)
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const portrait = h > w && (coarse || Math.min(w, h) < 620);
    document.body.classList.toggle("portrait", portrait);
  }

  // Balatro-style explainer tooltips. Hover (desktop) auto-upgrades title hints;
  // tap-to-pin is driven from the reliable #app / #overlay click handlers via TIP.toggle.
  function initTooltips() {
    let tip = document.getElementById("tooltip");
    if (!tip) { tip = document.createElement("div"); tip.id = "tooltip"; document.body.appendChild(tip); }
    let pinned = null;
    function position(x, y) {
      const r = tip.getBoundingClientRect();
      let left = x + 14, top = y + 16;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - 16;
      tip.style.left = Math.max(6, left) + "px";
      tip.style.top = Math.max(6, top) + "px";
    }
    function contentOf(el) { return el && (el.getAttribute("data-tip") || el.getAttribute("title") || el.getAttribute("data-title")); }
    function show(el, x, y) { const c = contentOf(el); if (!c) return; tip.innerHTML = c; tip.classList.add("show"); position(x, y); }
    function hide() { tip.classList.remove("show"); pinned = null; }
    function toggle(el, x, y) {
      if (!el) { hide(); return; }
      if (pinned === el) { hide(); return; }          // second tap on same item closes it
      const c = contentOf(el); if (!c) { hide(); return; }
      pinned = el; tip.innerHTML = c; tip.classList.add("show"); position(x, y);
    }
    // a touch fires emulated mouseover/mousemove afterwards - suppress hover tips briefly
    // so tapping a card doesn't make its tooltip flash (touch shows tips only via tap-to-pin)
    let touchUntil = 0;
    document.addEventListener("pointerdown", (e) => {
      if (e.pointerType && e.pointerType !== "mouse") touchUntil = Date.now() + 800;
    }, true);
    document.addEventListener("mouseover", (e) => {
      if (pinned || Date.now() < touchUntil) return;   // ignore hover during/after a touch
      const el = e.target.closest("[title], [data-tip]");
      if (!el || el.id === "tooltip") return;
      if (el.getAttribute("title")) { el.setAttribute("data-title", el.getAttribute("title")); el.removeAttribute("title"); }
      show(el, e.clientX, e.clientY);
    });
    document.addEventListener("mousemove", (e) => { if (tip.classList.contains("show") && !pinned && Date.now() >= touchUntil) position(e.clientX, e.clientY); });
    document.addEventListener("mouseout", (e) => {
      const el = e.target.closest("[data-title], [data-tip]");
      if (el && el.getAttribute("data-title")) { el.setAttribute("title", el.getAttribute("data-title")); el.removeAttribute("data-title"); }
      if (!pinned) hide();
    });
    TIP = { toggle, hide, pinned: () => pinned };
  }
  // element that should pin a tooltip on tap (info button, coach badges, etc.)
  function tipTargetOf(e) {
    return e.target.closest("[data-cardinfo], .coach-icon, .coach-chip, .card-trait, .trait-chip, .streak-chip, .edition, .os-item:not(.empty)");
  }

  /* ============================================================
     DRAG-TO-BAT - tap a card, or drag it onto the field diamond, to send the
     batter up (Balatro-style). Pointer events unify mouse + touch.
     ============================================================ */
  let _drag = null;
  function stageScale() {
    const st = document.getElementById("stage");
    if (!st) return 1;
    const m = (getComputedStyle(st).transform || "").match(/matrix\(([^,]+)/);
    return m ? (parseFloat(m[1]) || 1) : 1;
  }
  function overDropZone(x, y) {
    const bz = $("#bat-zone");
    if (!bz) return false;
    const r = bz.getBoundingClientRect();
    return x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24;
  }
  function onCardPointerDown(e) {
    if (STATE.screen !== "game" || STATE.busy || STATE.atBat) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cardEl = e.target.closest("#hand .card[data-idx]");
    if (!cardEl) return;
    // let the info button + info badges fall through to their click handlers (tooltips)
    if (e.target.closest("[data-cardinfo], .card-trait, .trait-chip, .streak-chip, .edition")) return;
    _drag = { idx: parseInt(cardEl.getAttribute("data-idx"), 10), cardEl, x0: e.clientX, y0: e.clientY, moved: false, over: false };
    try { cardEl.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onCardPointerMove(e) {
    if (!_drag) return;
    const dx = e.clientX - _drag.x0, dy = e.clientY - _drag.y0;
    if (!_drag.moved && Math.hypot(dx, dy) > 7) {
      _drag.moved = true;
      _drag.cardEl.classList.add("dragging");
      const app = $("#app"); if (app) app.classList.add("is-dragging");
    }
    if (_drag.moved) {
      const s = stageScale();
      _drag.cardEl.style.transform = `translate(${dx / s}px, ${dy / s}px) scale(1.06) rotate(2.5deg)`;
      _drag.over = overDropZone(e.clientX, e.clientY);
      const bz = $("#bat-zone"); if (bz) bz.classList.toggle("drop-active", _drag.over);
    }
  }
  function onCardPointerUp(e) {
    if (!_drag) return;
    const d = _drag; _drag = null;
    d.cardEl.classList.remove("dragging");
    d.cardEl.style.transform = "";
    const app = $("#app"); if (app) app.classList.remove("is-dragging");
    const bz = $("#bat-zone"); if (bz) bz.classList.remove("drop-active");
    if (d.over) { selectBatter(d.idx); return; }   // dropped in the box - step up
    if (!d.moved) { hintDrag(d.cardEl); }          // a plain tap isn't enough; nudge them to drag
    // otherwise: released in open space - snap back (transform already cleared)
  }
  // a tap on a card just reminds the player to drag it into the box
  function hintDrag(cardEl) {
    if (cardEl) { cardEl.classList.remove("nudge"); void cardEl.offsetWidth; cardEl.classList.add("nudge"); }
    const bz = $("#bat-zone");
    if (bz) { bz.classList.remove("pulse"); void bz.offsetWidth; bz.classList.add("pulse"); }
    if (SFX && SFX.click) SFX.click();
  }

  /* ---------- charm drag-and-drop: drop a Salami Card onto a player or coach ---------- */
  let _cdrag = null, _suppressCharmClick = false;
  function charmZoneSelector(kind) { return kind === "coach" ? "#dugout .coach-icon[data-uid]" : "#hand .card[data-uid]"; }
  function markCharmZones(kind, on) { $$(charmZoneSelector(kind)).forEach((el) => el.classList.toggle("charm-zone", on)); }
  function charmTargetAt(x, y, kind) {
    const els = $$(charmZoneSelector(kind));
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return els[i];
    }
    return null;
  }
  function onCharmPointerDown(e) {
    _suppressCharmClick = false;
    if (STATE.screen !== "game" || STATE.busy) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".cb-sell")) return;   // the sell button is a tap, not a drag
    const badge = e.target.closest(".charm-badge[data-charm]");
    if (!badge || badge.classList.contains("empty")) return;
    const idx = parseInt(badge.getAttribute("data-charm"), 10);
    const c = getCharm(STATE.run.charms[idx]);
    if (!c || c.target === "immediate") return;     // immediate Salami cards: a tap uses them (click handler)
    _cdrag = { idx, charm: c, badge, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, target: null };
    try { badge.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onCharmPointerMove(e) {
    if (!_cdrag) return;
    const dx = e.clientX - _cdrag.x0, dy = e.clientY - _cdrag.y0;
    if (!_cdrag.moved && Math.hypot(dx, dy) > 6) {
      _cdrag.moved = true;
      const g = document.createElement("div");
      g.className = "charm-ghost rar-" + _cdrag.charm.rarity;
      g.innerHTML = `<span class="cb-glyph">${icon(_cdrag.charm.icon)}</span>`;
      document.body.appendChild(g);
      _cdrag.ghost = g;
      _cdrag.badge.classList.add("charm-dragging");
      const app = $("#app"); if (app) app.classList.add("is-charmdrag");
      markCharmZones(_cdrag.charm.target, true);
    }
    if (_cdrag.moved) {
      _cdrag.ghost.style.left = e.clientX + "px";
      _cdrag.ghost.style.top = e.clientY + "px";
      const t = charmTargetAt(e.clientX, e.clientY, _cdrag.charm.target);
      if (t !== _cdrag.target) {
        if (_cdrag.target) _cdrag.target.classList.remove("charm-hover");
        if (t) t.classList.add("charm-hover");
        _cdrag.target = t;
      }
    }
  }
  function onCharmPointerUp() {
    if (!_cdrag) return;
    const d = _cdrag; _cdrag = null;
    if (d.ghost) d.ghost.remove();
    d.badge.classList.remove("charm-dragging");
    const app = $("#app"); if (app) app.classList.remove("is-charmdrag");
    markCharmZones(d.charm.target, false);
    if (d.target) d.target.classList.remove("charm-hover");
    if (d.moved) {
      _suppressCharmClick = true;                   // a drag must not also fire the tap handler
      if (d.target) applyCharmToTarget(d.charm, d.idx, d.target);
      else if (SFX && SFX.click) SFX.click();       // released in open space: snaps back
    }
    // a plain tap (no movement) falls through to the click handler -> useCharm()
  }
  function applyCharmToTarget(c, idx, el) {
    const run = STATE.run;
    const uid = el.getAttribute("data-uid");
    let ok = true, who = "";
    if (c.target === "player") {
      const card = run.deck.find((k) => k.uid === uid) || (STATE.game && STATE.game.hand.find((k) => k.uid === uid));
      if (!card) ok = false;
      else {
        who = shortName(card.name);
        if (c.op === "bump") card[c.arg] = Math.min(140, card[c.arg] + c.amt);
        else if (c.op === "allup") ["contact", "power", "eye", "speed"].forEach((k) => { card[k] = Math.min(140, card[k] + c.amt); });
        else if (c.op === "trait") card.trait = c.arg;
        else ok = false;
      }
    } else if (c.target === "coach") {
      const coach = run.dugout.find((k) => k.uid === uid);
      if (!coach) ok = false;
      else {
        who = coach.name;
        if (c.op === "copycoach") {
          if (dugoutUsed(run) >= run.dugoutSlots) { toast("Dugout is full. Sell a coach first."); ok = false; }
          else { const base = getCoach(coach.id); if (base) run.dugout.push(cloneCoach(base)); else ok = false; }
        } else if (c.op === "aura") {
          coach.aura = +(((coach.aura || 0) + c.amt).toFixed(2));
        } else ok = false;
      }
    }
    if (ok) {
      if (SFX && SFX.coin) SFX.coin();
      toast(`${c.name} applied to ${who}.`);
      consumeCharm(idx);
      if (STATE.screen === "game") renderGame();
    } else if (SFX && SFX.error) { SFX.error(); }
  }

  /* ---------- pack stage: drag a non-player option up into its row to claim it ----------
     Coaches drop on the DUGOUT row; Salami / scouting / analytics / training drop on the
     SALAMI row. A drop is exactly a pick (same make-room flow when slots are full).
     Player cards stay tap-to-take (they join the deck, which has no slot row). */
  let _odrag = null, _suppressOptClick = false;
  function optRowSel(kind) { return kind === "coach" ? "#dugout" : "#powerups"; }
  function onOptPointerDown(e) {
    _suppressOptClick = false;
    if (!STATE._pack || STATE.screen !== "shop") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.target.closest(".pack-stage .pack-opt[data-packpick]");
    if (!el) return;
    const i = parseInt(el.getAttribute("data-packpick"), 10);
    const ctx = STATE._pack;
    const o = ctx.options[i];
    if (!o || o.kind === "card") return;                          // players: tap to add to the deck
    if (ctx.picked.indexOf(i) >= 0 || ctx.picksLeft <= 0) return;
    _odrag = { i, kind: o.kind, el, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: false };
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onOptPointerMove(e) {
    if (!_odrag) return;
    const dx = e.clientX - _odrag.x0, dy = e.clientY - _odrag.y0;
    if (!_odrag.moved && Math.hypot(dx, dy) > 7) {
      _odrag.moved = true;
      const g = _odrag.el.cloneNode(true);
      g.classList.add("opt-ghost");
      g.style.width = _odrag.el.getBoundingClientRect().width + "px";
      document.body.appendChild(g);
      _odrag.ghost = g;
      _odrag.el.classList.add("opt-dragging");
      const row = $(optRowSel(_odrag.kind));
      if (row) row.classList.add("row-armed");
    }
    if (_odrag.moved) {
      _odrag.ghost.style.left = e.clientX + "px";
      _odrag.ghost.style.top = e.clientY + "px";
      const row = $(optRowSel(_odrag.kind));
      let over = false;
      if (row) {
        const r = row.getBoundingClientRect();
        over = e.clientX >= r.left - 24 && e.clientX <= r.right + 24 && e.clientY >= r.top - 28 && e.clientY <= r.bottom + 28;
        row.classList.toggle("row-hover", over);
      }
      _odrag.over = over;
    }
  }
  function onOptPointerUp() {
    if (!_odrag) return;
    const d = _odrag; _odrag = null;
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove("opt-dragging");
    const row = $(optRowSel(d.kind));
    if (row) row.classList.remove("row-armed", "row-hover");
    if (d.moved) {
      _suppressOptClick = true;                  // a drag must not also fire the tap handler
      if (d.over) packPick(d.i);
      else if (SFX && SFX.click) SFX.click();    // released in open space: snaps back
    }
    // a plain tap (no movement) falls through to the click handler -> packPick()
  }

  /* ---------- shop: drag a sealed pack onto the open slot to open it ---------- */
  let _pdrag = null, _suppressPackClick = false;
  function packSlotHit(x, y) {
    const slot = $("#pack-slot");
    if (!slot) return false;
    const r = slot.getBoundingClientRect();
    return x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24;
  }
  function onPackPointerDown(e) {
    _suppressPackClick = false;
    if (STATE.screen !== "shop") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.target.closest(".shop-pack[data-packslot]");
    if (!el || el.classList.contains("opened") || el.classList.contains("cant")) return;
    _pdrag = { i: parseInt(el.getAttribute("data-packslot"), 10), el, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: false };
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onPackPointerMove(e) {
    if (!_pdrag) return;
    const dx = e.clientX - _pdrag.x0, dy = e.clientY - _pdrag.y0;
    if (!_pdrag.moved && Math.hypot(dx, dy) > 6) {
      _pdrag.moved = true;
      const card = _pdrag.el.querySelector(".pk-wrap");
      const g = card ? card.cloneNode(true) : document.createElement("div");
      g.classList.add("pack-ghost");
      g.classList.add("kind-" + (STATE.shop.packs[_pdrag.i].item.kind));
      document.body.appendChild(g);
      _pdrag.ghost = g;
      _pdrag.el.classList.add("pack-dragging");
      const slot = $("#pack-slot"); if (slot) slot.classList.add("slot-armed");
    }
    if (_pdrag.moved) {
      _pdrag.ghost.style.left = e.clientX + "px";
      _pdrag.ghost.style.top = e.clientY + "px";
      _pdrag.over = packSlotHit(e.clientX, e.clientY);
      const slot = $("#pack-slot"); if (slot) slot.classList.toggle("slot-hover", _pdrag.over);
    }
  }
  function onPackPointerUp() {
    if (!_pdrag) return;
    const d = _pdrag; _pdrag = null;
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove("pack-dragging");
    const slot = $("#pack-slot");
    if (slot) slot.classList.remove("slot-armed", "slot-hover");
    if (d.moved) {
      _suppressPackClick = true;                 // a drag must not also fire the tap handler
      if (d.over) {
        if (slot) { slot.classList.remove("slot-pop"); void slot.offsetWidth; slot.classList.add("slot-pop"); }
        buy("pack", d.i);                        // pay + open (reuses the existing pack flow)
      } else if (SFX && SFX.click) { SFX.click(); }
    }
    // a plain tap (no movement) falls through to the click handler -> buy("pack", i)
  }

  function setupDrag() {
    document.addEventListener("pointerdown", onCardPointerDown);
    document.addEventListener("pointermove", onCardPointerMove);
    document.addEventListener("pointerup", onCardPointerUp);
    document.addEventListener("pointercancel", onCardPointerUp);
    document.addEventListener("pointerdown", onCharmPointerDown);
    document.addEventListener("pointermove", onCharmPointerMove);
    document.addEventListener("pointerup", onCharmPointerUp);
    document.addEventListener("pointercancel", onCharmPointerUp);
    document.addEventListener("pointerdown", onPackPointerDown);
    document.addEventListener("pointermove", onPackPointerMove);
    document.addEventListener("pointerup", onPackPointerUp);
    document.addEventListener("pointercancel", onPackPointerUp);
    document.addEventListener("pointerdown", onOptPointerDown);
    document.addEventListener("pointermove", onOptPointerMove);
    document.addEventListener("pointerup", onOptPointerUp);
    document.addEventListener("pointercancel", onOptPointerUp);
  }

  function boot() {
    // last-resort soft-lock protection: an uncaught error must never leave the
    // busy latch stuck with every button dead until a refresh.
    window.addEventListener("error", () => { STATE.busy = false; });
    window.addEventListener("unhandledrejection", () => { STATE.busy = false; });
    SFX.setEnabled(META.sound);
    applySpeedVar();   // seed the CSS speed multiplier from the saved setting
    fitStage();
    window.addEventListener("resize", fitStage);
    window.addEventListener("orientationchange", fitStage);
    window.addEventListener("load", fitStage);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", fitStage);
      window.visualViewport.addEventListener("scroll", fitStage);
    }
    setTimeout(fitStage, 60);
    setTimeout(fitStage, 300);
    // catch viewport changes that don't fire a window resize (some mobile browsers, embedded views)
    if (window.ResizeObserver) { try { new ResizeObserver(fitStage).observe(document.documentElement); } catch (e) {} }
    setInterval(fitStage, 250); // safety net; near-free thanks to change-detection

    // Kill ALL page scrolling / iOS rubber-band bounce. Touch scrolling is only
    // allowed inside overlays (which manage their own contained scroll).
    document.addEventListener("touchmove", function (e) {
      if (!(e.target.closest && e.target.closest("#overlay"))) e.preventDefault();
    }, { passive: false });
    // belt-and-suspenders: if anything ever scrolls the document, snap it back
    const snapBack = function () { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); };
    window.addEventListener("scroll", snapBack, { passive: true });
    document.addEventListener("scroll", snapBack, { passive: true });
    render();
    const mb = document.getElementById("menu-btn");
    if (mb) { mb.innerHTML = icon("menu"); mb.onclick = showMenu; }
    const rh = document.getElementById("rh-icon");
    if (rh) rh.innerHTML = icon("phone");
    initTooltips();
    setupDrag();
    // animated splash - auto-dismiss after the intro, or tap to skip
    (function () {
      const sp = document.getElementById("splash");
      if (!sp) return;
      // swap the static splash wordmark for the animated marquee logo
      if (typeof logoSVG === "function") {
        const sl = sp.querySelector(".splash-logo");
        if (sl) { const d = document.createElement("div"); d.className = "logo-svg splash-logo-svg"; d.innerHTML = logoSVG(); sl.replaceWith(d); }
      }
      const go = () => { sp.classList.add("gone"); setTimeout(() => { if (sp.parentNode) sp.remove(); }, 700); };
      sp.addEventListener("pointerdown", go);
      setTimeout(go, 2600);
    })();
    // expose a small debug API for testing
    global.DD = {
      STATE, CONFIG,
      play: (i, ap) => playAB(i || 0, ap || "swing"),
      autoPlay: autoPlay,
      startFranchise: startFromFranchise,
      win: () => { STATE.game.score = STATE.game.target; },
      give: (n) => { STATE.run.payroll += (n || 50); if (STATE.screen === "shop") render(); },
      state: () => STATE,
      render: () => render(),
      renderGame: () => renderGame(),
    };
  }

  // crude AI for playtesting: pick the card most likely to help (highest power+contact, prefer big bats with RISP)
  async function autoPlay(maxPlays) {
    maxPlays = maxPlays || 999;
    let n = 0;
    while (STATE.screen === "game" && !STATE.game.ended && n < maxPlays) {
      if (STATE.busy) { await sleep(60); continue; }
      const g = STATE.game;
      const risp = g.bases[1] || g.bases[2];
      let best = 0, bestScore = -1, bestCard = null;
      g.hand.forEach((c, i) => {
        let s = c.contact * 0.5 + c.power * (risp ? 1.1 : 0.7) + c.eye * 0.4 + c.speed * 0.2;
        if (s > bestScore) { bestScore = s; best = i; bestCard = c; }
      });
      // pick an approach the way a player might: power for sluggers w/ runners, patience for high-eye
      let ap = "swing";
      if (bestCard) {
        if (bestCard.power >= 80 && (risp || g.outsRemaining > 1)) ap = "power";
        else if (bestCard.eye >= 75 && !risp) ap = "contact";
      }
      await playAB(best, ap);
      await sleep(30);
    }
    return STATE.game ? STATE.game.result : null;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.DDApp = { STATE };
})(window);
