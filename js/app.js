/* ============================================================
   Diamond Duel — App: state, screens, loop, shop, bracket
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  let TIP = null; // tooltip controller (set up in initTooltips)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SAVE_KEY = "diamondduel.run.v1";
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
    return { sound: true, wins: 0, runs: 0, bestGame: 0, bestScore: 0, unlocked: ["sandlot", "bashers", "smallball", "moneyball", "speed"] };
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch (e) {} }

  /* ---------------- top-level state ---------------- */
  const STATE = {
    screen: "title",
    run: null,
    game: null,
    rng: null,       // current game's rng
    busy: false,
    atBat: null,     // { card } — the batter who has stepped up, awaiting an approach
    shop: null,
    overlay: null,
  };

  /* ---------------- helpers: clone instances ---------------- */
  function cloneCard(tpl) {
    return {
      uid: uid("card"), id: tpl.id, name: tpl.name, nick: tpl.nick || null,
      bats: tpl.bats, contact: tpl.contact, power: tpl.power, eye: tpl.eye, speed: tpl.speed,
      tags: tpl.tags.slice(), edition: tpl.edition || null, rarity: tpl.rarity, cost: tpl.cost,
      trait: tpl.trait || null, _streak: 0,
    };
  }
  function cloneCoach(tpl) {
    return {
      uid: uid("coach"), id: tpl.id, name: tpl.name, fx: tpl.fx, trigger: tpl.trigger,
      icon: tpl.icon, text: tpl.text, rarity: tpl.rarity, cost: tpl.cost,
      state: tpl.state ? JSON.parse(JSON.stringify(tpl.state)) : undefined,
    };
  }

  /* ---------------- run setup ---------------- */
  function newRun(franchiseId, seed) {
    const fr = FRANCHISES.find((f) => f.id === franchiseId) || FRANCHISES[0];
    const run = {
      seed: seed || randomSeed(),
      franchiseId: fr.id,
      gameIndex: 0,
      payroll: CONFIG.economy.startingPayroll + (fr.startBonusPayroll || 0),
      deck: fr.deck.map((id) => cloneCard(getPlayer(id))),
      dugout: [],
      analytics: { power: 0, contact: 0, patience: 0, speed: 0, rally: 0 },
      upgradesOwned: [],
      bosses: [],
      // derived tunables (modifiable by upgrades)
      dugoutSlots: CONFIG.dugoutSlots,
      handSize: CONFIG.handSize,
      startRally: CONFIG.startingRally,
      discount: 0,
      extraCardSlots: 0,
      rerollDiscount: 0,
      interestCap: CONFIG.economy.interestCap,
      shopBuys: 0,
      stat: { gamesWon: 0, homers: 0, bestInning: 0, bestScore: 0 },
    };
    if (fr.signatureCoach) run.dugout.push(cloneCoach(getCoach(fr.signatureCoach)));
    // pre-roll all four boss rules so telegraphs match
    for (let r = 0; r < ROUNDS.length; r++) run.bosses.push(pickBoss(run, r));
    META.runs += 1; saveMeta();
    return run;
  }

  function randomSeed() {
    // deterministic-ish from time, but only used to seed; gameplay stays reproducible from this string
    const t = (performance.now() * 1000) | 0;
    return "DD" + t.toString(36).toUpperCase();
  }

  function pickBoss(run, round) {
    const rng = makeRNG(run.seed + ":bosspick:" + round);
    let pool;
    if (round <= 0) pool = BOSSES.filter((b) => b.tier === 1);
    else if (round === 1) pool = BOSSES.filter((b) => b.tier <= 2);
    else pool = BOSSES.filter((b) => b.tier === 2);
    return rng.pick(pool);
  }

  /* ---------------- pitcher factory ---------------- */
  const PFIRST = ["Cole", "Dustin", "Rafe", "Mort", "Lefty", "Cisco", "Buck", "Hoyt", "Dizzy", "Whip", "Sal", "Gus", "Cy", "Wade", "Lon"];
  const PLAST = ["Brennan", "Voss", "Carmody", "Pruitt", "Okafor", "Salazar", "Mathers", "Dolan", "Renko", "Kasprzak", "Ibarra", "Stenhouse", "Vance", "Nakai", "Quill"];

  function makePitcher(run, gameIndex) {
    const round = Math.floor(gameIndex / GAMES_PER_ROUND);
    const gir = gameIndex % GAMES_PER_ROUND;
    const isBoss = gir === GAMES_PER_ROUND - 1;
    const rng = makeRNG(run.seed + ":pitcher:" + gameIndex);
    const pc = CONFIG.pitcher;
    let stuff = pc.baseStuff + pc.stuffPerGame * gameIndex + rng.range(-4, 4);
    let command = pc.baseCommand + pc.commandPerGame * gameIndex + rng.range(-4, 4);
    let rule = null, name, boss = null;
    if (isBoss) {
      boss = run.bosses[round];
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
    const baseTarget = CONFIG.targets[gi] || CONFIG.targets[CONFIG.targets.length - 1];
    const target = Math.round(baseTarget * pitcher.targetMultiplier);

    const deck = run.deck.map((c) => c); // reference copies (prospect growth persists to run.deck)
    rng.shuffle(deck);

    const game = {
      pitcher,
      outsRemaining: outs,
      outsMax: outs,
      outsThisInning: 0,
      rally: run.startRally,
      startRally: run.startRally,
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
    Engine && null;
    for (const c of run.dugout) {
      if (c.fx === "hotStreak" && c.state) c.state.homerThisGame = false;
    }
    // draw opening hand
    STATE.game = game;
    drawToHand();
    STATE.screen = "game";
    render();
    // little intro flash
    pushLog(`${icon("chevronR")} ${roundName(gi)} · ${gameLabel(gi)} — facing ${pitcher.name}. Target ${target}.`, "neutral");
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
    while (g.hand.length < STATE.run.handSize) {
      const c = drawCard();
      if (!c) break;
      g.hand.push(c);
    }
  }

  /* ---------------- the at-bat loop ---------------- */
  // Step 1 — tap (or drag to the field) a batter: they "step up" in a popup so the
  // field diagram never shrinks; then you choose how to attack.
  function selectBatter(handIndex) {
    if (STATE.busy || !STATE.game || STATE.game.ended) return;
    const card = STATE.game.hand[handIndex];
    if (!card) return;
    SFX.resume(); SFX.deal();
    STATE.atBat = { card, idx: handIndex };
    if (TIP) TIP.hide();
    markPicking();
    showAtBatPopup();
  }
  function cancelAtBat() { STATE.atBat = null; hideAtBatPopup(); markPicking(); }

  // rough steal success % (mirrors the engine) for the Send button label
  function stealOdds(runner) {
    const burner = runner.card && runner.card.trait === "burner";
    let p = (runner.speed - 50) * 0.013 + 0.25 + (burner ? 0.22 : 0);
    return Math.round(Math.max(0.35, Math.min(0.97, p)) * 100);
  }
  // The approach popup that floats over the play area (so the field never shrinks).
  function atBatPopupHTML(card) {
    const aps = CONFIG.approaches;
    const g = STATE.game;
    const plat = Engine.platoonState(card, g.pitcher, STATE.run);
    const platTag = plat.state === "adv" ? `<span class="plat plat-adv">platoon +</span>` : plat.state === "dis" ? `<span class="plat plat-dis">platoon −</span>` : "";
    const tr = getTrait(card.trait);
    const traitTag = tr ? `<span class="trait-chip" data-tip="<b>${tr.name}</b><br>${tr.desc}">${icon(tr.icon)}</span>` : "";
    const streak = (card._streak || 0) >= 2 ? `<span class="streak-chip hot" data-tip="<b>Hot streak</b><br>Boosted hitting stats while hot.">${icon("flame")}</span>` : (card._streak || 0) <= -2 ? `<span class="streak-chip cold" data-tip="<b>Cold streak</b><br>Reduced hitting stats while cold.">${icon("snowflake")}</span>` : "";
    const btn = (a) => `<button class="approach-btn ap-${a.id}" data-approach="${a.id}"><span class="ap-icon">${icon(a.icon)}</span><span class="ap-name">${a.name}</span><span class="ap-desc">${a.desc}</span></button>`;
    const runnersOn = g.bases.some(Boolean);
    const buntBtn = runnersOn ? `<button class="tactic-btn ap-bunt" data-approach="bunt" title="Sacrifice — trade an out to push your runners up a base. Fast hitters sometimes beat it out.">${icon("chevronsDown")} Bunt</button>` : "";
    let sends = "";
    [0, 1].forEach((fb) => { const r = g.bases[fb]; if (r && !g.bases[fb + 1]) sends += `<button class="tactic-btn send-btn" data-send="${fb}" title="Steal ${fb === 0 ? "second" : "third"} — caught = an out!">${icon("arrowUpRight")} Send ${shortName(r.name)} <b>${stealOdds(r)}%</b></button>`; });
    const tactics = (buntBtn || sends) ? `<div class="tactics-row">${buntBtn}${sends}</div>` : "";
    return `<div class="atbat-pop-inner">
        <button class="atbat-cancel" data-act="cancel-atbat" aria-label="Cancel" title="Pick someone else">${icon("close")}</button>
        <div class="atbat-up"><b>${shortName(card.name)}</b> steps up ${platTag} ${traitTag} ${streak}</div>
        <div class="atbat-q">How do you swing?</div>
        <div class="approach-row">${btn(aps.swing)}${btn(aps.power)}${btn(aps.contact)}</div>
        ${tactics}
      </div>`;
  }
  function showAtBatPopup() {
    if (!STATE.atBat) return;
    let pop = document.getElementById("atbat-pop");
    if (!pop) { pop = document.createElement("div"); pop.id = "atbat-pop"; pop.className = "atbat-pop"; const app = $("#app"); if (app) app.appendChild(pop); }
    pop.innerHTML = atBatPopupHTML(STATE.atBat.card);
    pop.classList.add("show");
    pop.classList.remove("pop"); void pop.offsetWidth; pop.classList.add("pop");
  }
  function hideAtBatPopup() {
    const pop = document.getElementById("atbat-pop");
    if (pop) { pop.classList.remove("show"); pop.innerHTML = ""; }
  }

  // ACTIVE steal — the player Sends a runner. Caught = an out (precious!).
  async function sendRunner(fromBase) {
    if (STATE.busy || !STATE.game || STATE.game.ended) return;
    const g = STATE.game, run = STATE.run;
    STATE.busy = true;
    const res = Engine.attemptSteal(g, run, STATE.rng, fromBase);
    if (res && res.ok) {
      SFX.steal();
      renderDiamond();
      if (res.caught) {
        SFX.out();
        pushLog(`${icon("out")} Caught stealing — ${res.runner.name} is out!`, "bad");
        setReadout("CAUGHT STEALING", "bad", { batterName: res.runner.name, platoon: "neutral" }, "Out on the basepaths.");
      } else {
        const to = res.to === 1 ? "2nd" : res.to === 2 ? "3rd" : "home";
        pushLog(`${icon("arrowUpRight")} ${res.runner.name} steals ${to}!`, "steal");
        if (res.rallyBonus) animateRally({ rallyDelta: res.rallyBonus });
        (res.triggers || []).forEach(flashCoachByFx);
      }
      await sleep(380);
      renderGame();
      if (g.outsRemaining <= 0) {
        await sleep(220);
        return g.score >= g.target ? onWin() : onLose();
      }
    }
    STATE.busy = false;
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
    if (STATE.atBat) showAtBatPopup(); else hideAtBatPopup();
  }

  // Step 2 — choose an approach: resolve the plate appearance with that swing profile.
  async function commitAtBat(approach) {
    if (STATE.busy || !STATE.atBat || !STATE.game || STATE.game.ended) return;
    const g = STATE.game, run = STATE.run;
    const card = STATE.atBat.card;
    const idx = g.hand.indexOf(card);
    if (idx < 0) { STATE.atBat = null; renderGame(); return; }
    STATE.busy = true;
    STATE.atBat = null;
    hideAtBatPopup();
    markPicking();

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
    STATE.busy = false;
  }

  // convenience for debug/auto-play: select + commit in one shot.
  async function playAB(handIndex, approach) {
    if (STATE.busy || !STATE.game || STATE.game.ended) return;
    const card = STATE.game.hand[handIndex];
    if (!card) return;
    STATE.atBat = { card };
    return commitAtBat(approach || "swing");
  }

  function snapshotRunner(r) { return r ? { name: r.name, speed: r.speed } : null; }

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

    // sound + screen-shake juice
    if (o === "HR") { SFX.homer(); screenShake(true); flashScreen("huge"); }
    else if (o === "2B" || o === "3B") { SFX.xbh(); screenShake(false); }
    else if (o === "1B") SFX.single();
    else if (o === "BB" || o === "HBP") SFX.walk();
    else if (o === "K") SFX.strikeout();
    else SFX.out();

    // readout
    const cls = OUTCOME_CLASS[o] || "neutral";
    let math = "";
    if (ev.isSafe && ev.bagValue > 0) {
      math = `Bag ${trim(ev.bagValue)} × Rally ${ev.rallyUsed.toFixed(1)} = <b>+${ev.scoreGained}</b>`;
    } else if (ev.productiveOut && ev.runsOnPlay > 0) {
      math = `Productive out — ${ev.runsOnPlay} run scored`;
    } else if (ev.doublePlay) {
      math = `Double play — two outs!`;
    } else {
      math = ev.isSafe ? "" : (g.rally > g.startRally + 0.01 ? `Out — rally holds at ×${g.rally.toFixed(1)}` : "Out.");
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

  function screenShake(big) {
    const el = $("#app");
    if (!el) return;
    const cls = big ? "shake-big" : "shake-sm";
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 560);
  }
  function flashScreen(kind) {
    let f = $("#screen-flash");
    if (!f) { f = document.createElement("div"); f.id = "screen-flash"; const st = document.getElementById("stage"); (st || document.body).appendChild(f); }
    f.className = "show " + (kind || "");
    setTimeout(() => { f.className = ""; }, 400);
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
    const total = base + interest + frugal;
    run.payroll += total;

    // stats
    run.stat.gamesWon += 1;
    if (g.score > (run.stat.bestScore || 0)) run.stat.bestScore = g.score;
    if (g.score > (META.bestScore || 0)) META.bestScore = g.score;
    META.bestGame = Math.max(META.bestGame || 0, g.gameIndex);
    saveMeta();

    // advance bracket
    run.gameIndex += 1;
    saveRun();

    if (run.gameIndex >= ROUNDS.length * GAMES_PER_ROUND) {
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
    // the menu button only makes sense once a run is underway (title is the main menu)
    const mb = document.getElementById("menu-btn");
    if (mb) mb.style.display = STATE.screen === "title" ? "none" : "";
  }

  /* ---------- title ---------- */
  function renderTitle() {
    const hasSave = !!localStorage.getItem(SAVE_KEY);
    const fr = FRANCHISES.map((f) => franchiseCardHTML(f)).join("");
    return `
    <div class="screen title-screen">
      <div class="title-hero">
        <div class="logo">
          <span class="logo-diamond">${icon("diamond")}</span>
          <h1>DIAMOND<span>DUEL</span></h1>
        </div>
        <p class="tagline">A baseball roguelike deckbuilder. Build a lineup, stack the rally, out-score the ace.</p>
      </div>
      ${hasSave ? `<div class="continue-row"><button class="btn btn-big btn-gold" data-act="continue">Continue Run</button><button class="btn btn-ghost" data-act="abandon">Abandon</button></div>` : ""}
      <h2 class="pick-h">Choose your franchise</h2>
      <div class="seed-row">
        <input id="seed-input" class="seed-input" type="text" maxlength="32" autocomplete="off" spellcheck="false"
               placeholder="optional seed — leave blank for a random run" value="${STATE._replaySeed ? escAttr(STATE._replaySeed) : ""}" />
        ${STATE._replaySeed
        ? `<div class="seed-hint replay">${icon("replay")} Replaying <code>${escAttr(STATE._replaySeed)}</code>${STATE._replayFranchise ? ` — pick <b>${(FRANCHISES.find(f => f.id === STATE._replayFranchise) || {}).name || ""}</b> below to reproduce it exactly` : ""}</div>`
        : `<div class="seed-hint">Paste a seed to replay a specific run, or leave it blank for a fresh one.</div>`}
      </div>
      <div class="franchise-grid">${fr}</div>
      <div class="title-foot">
        <div class="foot-btns">
          <button class="btn btn-ghost" data-act="howto">${icon("help")} How to Play</button>
          <button class="btn btn-ghost" data-act="open-stats">${icon("stats")} Stats</button>
          <button class="btn btn-ghost" data-act="toggle-sound">${META.sound ? icon("soundOn") : icon("soundOff")} Sound: ${META.sound ? "On" : "Off"}</button>
        </div>
        <span class="foot-stats">${META.wins} ${META.wins === 1 ? "championship" : "championships"} · ${META.runs} runs · best ${META.bestScore || 0}</span>
        <span class="foot-version">v1.0</span>
      </div>
    </div>`;
  }

  function franchiseCardHTML(f) {
    const coach = f.signatureCoach ? getCoach(f.signatureCoach) : null;
    const ids = f.deck;
    const totals = ids.reduce((a, id) => {
      const p = getPlayer(id); a.c += p.contact; a.p += p.power; a.e += p.eye; a.s += p.speed; return a;
    }, { c: 0, p: 0, e: 0, s: 0 });
    const n = ids.length;
    const mini = (v) => Math.round(v / n);
    const isReplayTarget = STATE._replaySeed && STATE._replayFranchise === f.id;
    return `
      <button class="franchise-card${isReplayTarget ? " fr-replay-target" : ""}" data-franchise="${f.id}">
        ${isReplayTarget ? `<div class="fr-replay-badge">${icon("replay")} original</div>` : ""}
        <div class="fr-head"><h3>${f.name}</h3></div>
        <p class="fr-tag">${f.tagline}</p>
        <div class="fr-stats">
          ${miniStat("CON", mini(totals.c))}
          ${miniStat("POW", mini(totals.p))}
          ${miniStat("EYE", mini(totals.e))}
          ${miniStat("SPD", mini(totals.s))}
        </div>
        <div class="fr-bonus">${coach ? `<span class="fr-star">${icon(coach.icon)}</span> ${coach.name}` : "—"}</div>
        <div class="fr-sub">${f.bonusText}</div>
        <span class="fr-go">Start ${icon("chevronR")}</span>
      </button>`;
  }
  function miniStat(label, v) {
    return `<div class="mini-stat"><span class="ms-l">${label}</span><div class="ms-bar"><div class="ms-fill ${barClass(label)}" style="width:${v}%"></div></div><span class="ms-v">${v}</span></div>`;
  }
  function barClass(l) { return ({ CON: "b-contact", POW: "b-power", EYE: "b-eye", SPD: "b-speed", C: "b-contact", P: "b-power", E: "b-eye", S: "b-speed" })[l] || ""; }

  /* ---------- game screen ---------- */
  function renderGameScreen() {
    return `
    <div class="screen game-screen">
      <div class="scoreboard">
        <div class="sb-matchup">
          <div class="sb-round" id="sb-round"></div>
          <div class="sb-vs" id="sb-vs"></div>
          <div class="sb-pitcher" id="sb-pitcher"></div>
          <div class="sb-rule" id="sb-rule"></div>
        </div>
        <div class="sb-score">
          <div class="sb-score-num"><span id="sb-score">0</span><span class="sb-slash">/</span><span id="sb-target">0</span></div>
          <div class="sb-progress"><div class="sb-progress-fill" id="sb-progress"></div></div>
          <div class="sb-runs">Runs this game: <b id="sb-runs">0</b></div>
        </div>
        <div class="sb-rally" id="sb-rally-wrap">
          <div class="sb-rally-label">RALLY</div>
          <div class="sb-rally-num" id="sb-rally">x1.0</div>
        </div>
      </div>

      <div class="game-body">
        <div class="col-left">
          <div class="diamond-wrap">
            <div class="diamond" id="diamond">
              <div class="base base-2" data-base="2"></div>
              <div class="base base-1" data-base="1"></div>
              <div class="base base-3" data-base="3"></div>
              <div class="base base-home"></div>
              <div class="runner-layer" id="runner-layer"></div>
              <div class="run-pop-layer" id="run-pop-layer"></div>
            </div>
            <div class="drag-hint" id="drag-hint">${icon("bat")} Drag a batter here</div>
          </div>
          <div class="readout" id="readout"><div class="readout-empty">Drag a batter onto the field to step up.</div></div>
        </div>

        <div class="col-center">
          <div class="play-log" id="play-log"></div>
        </div>

        <div class="col-right">
          <div class="dugout-title">DUGOUT</div>
          <div class="dugout" id="dugout"></div>
          <div class="situation">
            <div class="sit-cell sit-outs"><div class="sit-pips" id="out-pips"></div><span>OUTS LEFT</span></div>
            <div class="sit-cell sit-inning"><b id="res-inning">1</b><span>INNING</span></div>
          </div>
          <div class="payroll-chip" id="payroll-chip">$<span id="payroll-amt">0</span></div>
        </div>
      </div>

      <div class="hand-row">
        <div class="hand" id="hand"></div>
        <div class="hand-actions">
          <div class="hand-hint">Drag a batter onto the field to send them up. Keys 1–8.</div>
        </div>
      </div>
    </div>`;
  }

  function renderGame() {
    if (STATE.screen !== "game") return;
    const g = STATE.game, run = STATE.run;
    const gi = g.gameIndex;
    setText("sb-round", `${roundName(gi)} · ${gameLabel(gi)}`);
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
    setText("res-inning", gi + 1);
    setRally(g.rally, false);
    setText("payroll-amt", run.payroll);
    renderDiamond();
    renderHand();
    renderDugout();
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
      tok._stepTimer = setTimeout(step, LEG_MS);
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
        tok.classList.add("leaving"); // scored — round the remaining bases to home, then fade
        animateTokenTo(tok, 4, () => {
          tok.classList.add("crossed");
          setTimeout(() => { if (tok.parentNode) tok.parentNode.removeChild(tok); }, 260);
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

  function cardHTML(c, idx, opts) {
    opts = opts || {};
    const ed = c.edition ? `<div class="edition ed-${c.edition}">${editionLabel(c.edition)}</div>` : "";
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
      <div class="card rar-${c.rarity} ${c.edition ? "has-ed ed-bg-" + c.edition : ""}${st >= 2 ? " is-hot" : st <= -2 ? " is-cold" : ""}" ${idxAttr} data-uid="${c.uid}" data-tip="${cardTip(c)}">
        <div class="card-top">
          <div class="bats bats-${c.bats}">${c.bats}</div>
          <div class="card-name">${shortName(c.name)}</div>
          ${traitBadge}
          <div class="card-pos">${pos}</div>
          ${infoBtn}
        </div>
        ${ed}${streakBadge}
        <div class="card-stats">
          ${statBar("C", c.contact, "b-contact")}
          ${statBar("P", c.power, "b-power")}
          ${statBar("E", c.eye, "b-eye")}
          ${statBar("S", c.speed, "b-speed")}
        </div>
        <div class="card-tags">${tagHTML}</div>
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
    const hand = c.bats === "S" ? "switch-hitter — never platoon-disadvantaged" : (c.bats === "L" ? "bats left" : "bats right");
    return `<b>${c.name}</b> · ${hand}`
      + `<br><b class='t-c'>Contact ${Math.round(c.contact)}</b> · ${statWord(c.contact)} — singles &amp; avoids strikeouts`
      + `<br><b class='t-p'>Power ${Math.round(c.power)}</b> · ${statWord(c.power)} — extra-base hits &amp; home runs`
      + `<br><b class='t-e'>Eye ${Math.round(c.eye)}</b> · ${statWord(c.eye)} — draws walks`
      + `<br><b class='t-s'>Speed ${Math.round(c.speed)}</b> · ${statWord(c.speed)} — steals &amp; extra bases`
      + (tr ? `<br><span class='tip-trait'>${tr.name} — ${tr.desc}</span>` : "");
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
      if (c) slots.push(coachIconHTML(c));
      else slots.push(`<div class="coach-icon empty">+</div>`);
    }
    d.innerHTML = slots.join("");
  }
  // Compact dugout badge — just the coach's icon; the full rule lives in the tap/hover tooltip.
  function coachIconHTML(c) {
    const glyph = c.icon ? icon(c.icon) : icon("star");
    const scale = (c.state && c.state.bonus) ? `<span class="coach-badge">+${c.state.bonus.toFixed(1)}</span>` : "";
    return `<div class="coach-icon rar-${c.rarity}" data-coach="${c.id}" data-uid="${c.uid}" data-tip="<b>${c.name}</b><br>${c.text}"><span class="ci-glyph">${glyph}</span>${scale}</div>`;
  }
  function coachChipHTML(c, opts) {
    opts = opts || {};
    let sub = "";
    if (c.state && c.state.bonus) sub = `<span class="coach-scale">+${c.state.bonus.toFixed(1)}</span>`;
    const glyph = c.icon ? `<span class="coach-chip-ico">${icon(c.icon)}</span>` : "";
    return `<div class="coach-chip rar-${c.rarity}" data-coach="${c.id}" data-uid="${c.uid}" title="${c.text}">
      ${glyph}<div class="coach-chip-body"><div class="coach-name">${c.name}${sub}</div>
      <div class="coach-text">${c.text}</div></div>
    </div>`;
  }

  /* ---------- readout + animations ---------- */
  function setReadout(label, cls, ev, math) {
    const r = $("#readout");
    if (!r) return;
    const plat = ev.platoon === "adv" ? `<span class="plat plat-adv">platoon +</span>` : ev.platoon === "dis" ? `<span class="plat plat-dis">platoon −</span>` : "";
    r.innerHTML = `
      <div class="ro-card ro-${cls}">
        <div class="ro-label">${label}</div>
        <div class="ro-batter">${ev.batterName} ${plat}</div>
        <div class="ro-math">${math || ""}</div>
      </div>`;
    const card = $(".ro-card", r);
    if (card) { card.classList.remove("pop"); void card.offsetWidth; card.classList.add("pop"); }
  }

  function bumpScore(amt) {
    const g = STATE.game;
    setText("sb-score", g.score);
    const pct = Math.min(100, (g.score / g.target) * 100);
    const pf = $("#sb-progress"); if (pf) pf.style.width = pct + "%";
    if (amt > 0) {
      const el = $("#sb-score");
      if (el) { el.classList.remove("score-bump"); void el.offsetWidth; el.classList.add("score-bump"); }
      floatText($("#sb-rally-wrap") ? $(".sb-score") : null, `+${amt}`, "float-score");
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
      setRally(g.rally, false); // no change (an out) — sync without a pulse
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
    setTimeout(() => d.remove(), 1100);
  }

  function floatText(anchorEl, text, cls) {
    const host = $(".scoreboard");
    if (!host) return;
    const d = document.createElement("div");
    d.className = "float-text " + (cls || "");
    d.textContent = text;
    host.appendChild(d);
    setTimeout(() => d.remove(), 900);
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
    let txt = `<b>${OUTCOME_LABEL[o] || o}</b> — ${ev.batterName}`;
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
        <div class="ov-sub">You beat ${g.pitcher.name} — <b>${g.score}</b> vs ${g.target}.</div>
        <div class="brk">${rows}<div class="brk-row brk-total"><span>Total earned</span><b>+$${total}</b></div></div>
        <div class="ov-pay">Payroll: <b>$${STATE.run.payroll}</b></div>
        <button class="btn btn-big btn-gold" data-act="to-shop">Visit the Shop ${icon("chevronR")}</button>
      </div>`);
  }

  function showGameOver(g) {
    overlay(`
      <div class="ov-card lose-ov">
        <h2>GAME OVER</h2>
        <div class="ov-sub">You came up short against ${g.pitcher.name}.<br>Eliminated in the <b>${ordinal(g.gameIndex + 1)} inning</b> — ${g.score} / ${g.target}.</div>
        <div class="ov-stat">Best game score this run: ${STATE.run.stat.bestScore || g.score}</div>
        <div class="ov-actions">
          <button class="btn btn-big btn-gold" data-act="replay-seed">${icon("replay")} Replay Seed</button>
          <button class="btn btn-secondary" data-act="retry-run">New Run</button>
          <button class="btn btn-ghost" data-act="to-title">Main Menu</button>
        </div>
      </div>`, true);
  }

  function showVictory() {
    META.wins += 1; saveMeta();
    clearSave();
    SFX.win();
    overlay(`
      <div class="ov-card victory-ov">
        <div class="ov-burst big">${icon("trophy")}</div>
        <h2>WORLD SERIES CHAMPIONS</h2>
        <div class="ov-sub">You ran the entire gauntlet with ${FRANCHISES.find(f => f.id === STATE.run.franchiseId).name}.<br>Seed: ${seedChip(STATE.run.seed)}</div>
        <div class="ov-stat">Games won: ${STATE.run.stat.gamesWon} · Best game score: ${STATE.run.stat.bestScore}</div>
        <div class="ov-actions">
          <button class="btn btn-secondary" data-act="replay-seed">${icon("replay")} Replay Seed</button>
          <button class="btn btn-big btn-gold" data-act="retry-run">New Run</button>
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
          ${tile("open-stats", icon("stats"), "Stats", "career &amp; run")}
          ${tile("howto", icon("help"), "How to Play", "the rules")}
          ${tile("toggle-sound-menu", META.sound ? icon("soundOn") : icon("soundOff"), "Sound: " + (META.sound ? "On" : "Off"), "toggle audio")}
          ${inRun ? tile("to-menu", icon("chevronL"), "Main Menu", "keeps your run") : ""}
          ${inRun ? tile("abandon-run", icon("close"), "Abandon Run", "quit &amp; discard", "tile-danger") : ""}
        </div>
        ${inRun ? "" : `<button class="btn btn-ghost" data-act="close-ov">Close</button>`}
      </div>`);
  }

  function confirmAbandon() {
    overlay(`
      <div class="ov-card confirm-card">
        <h2>Abandon this run?</h2>
        <div class="ov-sub">Your current run will end and its progress is lost for good. (Your career stats are kept.)</div>
        <div class="ov-actions">
          <button class="btn btn-danger" data-act="abandon-confirm">Abandon Run</button>
          <button class="btn btn-ghost" data-act="back-to-menu">Cancel</button>
        </div>
      </div>`);
  }

  function showStats() {
    const m = META;
    const furthest = (m.bestGame != null && m.bestGame >= 0)
      ? `${ROUNDS[Math.floor(m.bestGame / GAMES_PER_ROUND)].name} · ${gameLabel(m.bestGame)}`
      : "—";
    let runHTML = "";
    if (STATE.run) {
      const r = STATE.run;
      const fr = FRANCHISES.find((f) => f.id === r.franchiseId);
      runHTML = `
        <h3>Current run</h3>
        <div class="stat-grid">
          ${statCell("Franchise", fr ? fr.name : "—")}
          ${statCell("Now playing", `${roundName(r.gameIndex)} · ${gameLabel(r.gameIndex)}`)}
          ${statCell("Games won", r.stat.gamesWon)}
          ${statCell("Payroll", "$" + r.payroll)}
          ${statCell("Deck size", r.deck.length + " cards")}
          ${statCell("Dugout", r.dugout.length + " / " + r.dugoutSlots)}
          ${statCell("Best game (run)", r.stat.bestScore || 0)}
          ${statCell("Seed", seedChip(r.seed))}
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

  /* ---------- seeds: copy + replay ---------- */
  function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function seedChip(seed) { return `<code class="seed-copy" data-seed="${escAttr(seed)}" title="Click to copy this seed">${seed} ${icon("copy", "ico-sm")}</code>`; }
  function copySeed(seed) {
    const done = () => { toast("Seed copied — " + seed); if (SFX && SFX.coin) SFX.coin(); };
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
    } catch (e) { toast("Couldn't copy — seed is " + text); }
  }
  function replaySeed(seed, franchiseId) {
    STATE._replaySeed = seed || null;
    STATE._replayFranchise = franchiseId || null;
    closeOverlay();
    STATE.screen = "title";
    render();
    setTimeout(() => { const el = document.getElementById("seed-input"); if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); } }, 40);
  }

  /* ---------- new run (with overwrite guard) ---------- */
  function doStartRun(id) {
    SFX.resume();
    let seed = null;
    const el = document.getElementById("seed-input");
    if (el && el.value.trim()) seed = el.value.trim().toUpperCase();
    STATE.run = newRun(id, seed);
    STATE.game = null;
    STATE._replaySeed = null; STATE._replayFranchise = null;
    saveRun();
    closeOverlay();
    STATE.screen = "map";
    render();
  }
  function confirmNewRun(id) {
    STATE._pendingFranchise = id;
    const fr = FRANCHISES.find((f) => f.id === id);
    overlay(`
      <div class="ov-card confirm-card">
        <h2>Start a new run?</h2>
        <div class="ov-sub">You have a run in progress. Starting <b>${fr ? fr.name : "a new run"}</b> replaces it — the current run will be lost.</div>
        <div class="ov-actions">
          <button class="btn btn-gold" data-act="confirm-newrun">Start New Run</button>
          <button class="btn btn-ghost" data-act="close-ov">Cancel</button>
        </div>
      </div>`);
  }

  const HOWTO_SECTIONS = [
    `<section><h3>The goal</h3><p>A run is one <b>9-inning game</b>. Each inning, pile up <b>Score</b> to beat that inning's <b>Target</b> before you make your <b>3rd out</b>. Clear all nine innings to win — the third inning of every three is a tougher <b>Boss</b>. Come up short in any inning and the run is over.</p></section>`,
    `<section><h3>Sending a batter up</h3><p>Your hand is your lineup. <b>Drag a card onto the field</b> to send that batter to the plate (or press <b>1–8</b>) — a glowing zone shows where to drop. Once they step up, a popup asks how they'll swing. You draw back up after every at-bat.</p></section>`,
    `<section><h3>Choosing a swing</h3><ul><li><b>Swing Away</b> — balanced; your natural swing.</li><li><b>Power Swing</b> — more homers &amp; extra-base hits, but more strikeouts.</li><li><b>Work the Count</b> — lots of walks, few strikeouts, little power.</li></ul><p>With runners on, you can also <b>Bunt</b> or <b>Send</b> a runner from the same popup.</p></section>`,
    `<section class="howto-rally"><h3>The Rally — the heart of it</h3><p>Every scoring play is worth <b>Bag value × Rally</b>.</p><ul><li><b>Bag value:</b> Walk 1, Single 2, Double 3, Triple 4, Home Run 5 — plus <b>+1</b> for every runner who scores.</li><li><b>Rally</b> starts at <b>×1.0</b> and climbs <b>+0.5</b> each time you reach base safely — but an <b>out resets it to ×1.0</b>.</li></ul><p>Land your big bats while the rally is high.</p></section>`,
    `<section><h3>Reading a card</h3><p>Four stats (0–100): <b class='s-c'>Contact</b> (singles, fewer strikeouts), <b class='s-p'>Power</b> (extra-base hits &amp; homers), <b class='s-e'>Eye</b> (walks), <b class='s-s'>Speed</b> (steals &amp; extra bases). The <b>L / R / S</b> badge is handedness — opposite hands earn a <b>platoon</b> boost; switch-hitters never lose it. Tap the <b>?</b> on any card for a full readout.</p></section>`,
    `<section><h3>Baserunning</h3><p>Hits move runners around the diamond, and a runner on 2nd or 3rd is <b>in scoring position</b> (each drives in +1 bag value). When the path is clear you can <b>Send</b> a runner to steal the next base — but getting caught costs a precious out. A <b>Bunt</b> trades an out to push your runners up.</p></section>`,
    `<section><h3>Traits &amp; streaks</h3><p>Star players carry a <b>trait</b> — the icon on their card. Burners steal at will, sluggers launch homers risk-free, eagle-eyes draw walks, and more. Players also run <b>hot</b> (boosted after back-to-back hits) or <b>cold</b> (slumping after outs). Tap a trait icon to read it.</p></section>`,
    `<section><h3>Coaches &amp; the dugout</h3><p>Coaches are your <b>build</b> (think Balatro's Jokers). They fill your <b>dugout</b> (8 slots) and trigger passively or in the right spot — bag boosts, rally bonuses, payoffs for sluggers or speedsters, and scaling coaches that grow all run. <b>Tap a coach icon</b> to see what it does; sell any for half its cost.</p></section>`,
    `<section><h3>Innings &amp; bosses</h3><p>Nine innings across three phases — <b>Early</b>, <b>Middle</b>, <b>Late</b> — and the third of each is a <b>Boss</b> with a nasty rule, telegraphed on the linescore so you can prepare for it. Beat the boss to move on to the next phase.</p></section>`,
    `<section><h3>The shop</h3><p>Between innings, spend <b>Payroll ($)</b> on <b>Players</b> and <b>Coaches</b>, on <b>Analytics &amp; Scouting</b> (permanent buffs and card upgrades), on <b>Booster Packs</b>, and on <b>Front Office</b> vouchers. Reroll for fresh stock. <em>You can't clear the late innings with your starting deck — building is the point.</em></p></section>`,
    `<section class="howto-tips"><h3>${icon("sparkle")} Quick tips</h3><ul><li>Don't waste your slugger leading off — hold it until runners are on and the rally is built.</li><li>Thin your deck: fewer, better cards means you draw your bombs more often.</li><li>Two or three coaches pointing the same way beat a pile of random ones.</li></ul></section>`,
  ];
  const HOWTO_PAGES = [[0], [1], [2], [3], [4], [5], [6], [7], [8], [9], [10]];
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
    const rounds = ROUNDS.map((rd, ri) => {
      const games = [];
      for (let gj = 0; gj < GAMES_PER_ROUND; gj++) {
        const idx = ri * GAMES_PER_ROUND + gj;
        const isBossGame = gj === GAMES_PER_ROUND - 1;
        let cls = "bracket-game";
        if (idx < gi) cls += " done";
        else if (idx === gi) cls += " current";
        else cls += " future";
        if (isBossGame) cls += " boss";
        const label = "Inn " + (idx + 1) + (isBossGame ? " " + icon("diamond", "ico-boss") : "");
        const tgt = Math.round((CONFIG.targets[idx] || 0) * (isBossGame && run.bosses[ri].rule === "ace" ? (CONFIG.aceTargetMult || 1.25) : 1));
        games.push(`<div class="${cls}" title="Target ${tgt}"><span class="bg-label">${label}</span><span class="bg-target">${tgt}</span></div>`);
      }
      return `<div class="bracket-round"><div class="br-name">${rd.name}</div><div class="br-games">${games.join("")}</div></div>`;
    }).join("");

    const pitcher = makePitcher(run, gi);
    const isBoss = pitcher.isBoss;
    const target = Math.round((CONFIG.targets[gi] || 0) * pitcher.targetMultiplier);
    const telegraph = isBoss
      ? `<div class="boss-telegraph"><div class="bt-tag">BOSS PITCHER</div><h3>${pitcher.name}</h3><p>${pitcher.boss.text}</p><div class="bt-stats">Stuff ${pitcher.stuff} · Command ${pitcher.command} · Target ${target}</div></div>`
      : `<div class="match-telegraph"><h3>${pitcher.name}</h3><p>Ordinary starter — ${pitcher.bats}HP.</p><div class="bt-stats">Stuff ${pitcher.stuff} · Command ${pitcher.command} · Target ${target}</div></div>`;

    return `
    <div class="screen map-screen">
      <div class="map-head">
        <h2>The Linescore</h2>
        <div class="map-sub">${FRANCHISES.find(f => f.id === run.franchiseId).name} · Payroll <b>$${run.payroll}</b> · Seed ${seedChip(run.seed)}</div>
      </div>
      <div class="bracket">${rounds}</div>
      <div class="map-next">
        <div class="mn-left">
          <div class="mn-round">${roundName(gi)} · ${gameLabel(gi)}</div>
          ${telegraph}
        </div>
        <div class="mn-right">
          <button class="btn btn-secondary" data-act="open-deck">View Deck (${run.deck.length})</button>
          <button class="btn btn-big btn-gold" data-act="play-game">Play Ball ${icon("chevronR")}</button>
        </div>
      </div>
    </div>`;
  }

  /* ============================================================
     SHOP
     ============================================================ */
  function enterShop() {
    STATE.shop = { reroll: 0, freeUsed: false };
    rollShop();
    STATE.screen = "shop";
    render();
  }

  function rollShop() {
    const run = STATE.run;
    const sh = STATE.shop;
    const rng = makeRNG(run.seed + ":shop:" + run.gameIndex + ":" + sh.reroll);
    const round = Math.floor(run.gameIndex / GAMES_PER_ROUND);

    // coaches not already owned
    const ownedFx = new Set(run.dugout.map((c) => c.fx));
    const coachPool = COACHES.filter((c) => !ownedFx.has(c.fx));
    sh.coaches = rng.sample(coachPool, CONFIG.shop.coachSlots).map((c) => ({ kind: "coach", item: c, cost: priceOf(c.cost) }));

    // player cards by rarity gate
    let rar = ["common", "star"];
    if (round >= 1) rar.push("allstar");
    if (round >= 2) rar.push("legend");
    const cardPool = PLAYERS.filter((p) => rar.indexOf(p.rarity) >= 0);
    const nCards = CONFIG.shop.cardSlots + run.extraCardSlots;
    sh.cards = rng.sample(cardPool, nCards).map((p) => ({ kind: "card", item: p, cost: priceOf(p.cost) }));

    // consumables: analytics + scouting mix
    const consPool = ANALYTICS.concat(SCOUTING);
    sh.consumables = rng.sample(consPool, CONFIG.shop.consumableSlots).map((c) => ({ kind: c.kind, item: c, cost: priceOf(c.cost) }));

    // one upgrade (vouchers) not owned
    const upPool = UPGRADES.filter((u) => run.upgradesOwned.indexOf(u.fx) < 0);
    sh.upgrades = rng.sample(upPool, 1).map((u) => ({ kind: "upgrade", item: u, cost: priceOf(u.cost) }));

    // packs
    sh.packs = rng.sample(PACKS, CONFIG.shop.packSlots).map((p) => ({ kind: "pack", item: p, cost: priceOf(p.cost) }));

    sh.bought = sh.bought || {}; // uid-ish keys of consumed slots
  }
  function priceOf(base) { return Math.max(1, base - (STATE.run.discount || 0)); }
  function rerollCost() {
    const eco = CONFIG.economy;
    return Math.max(1, eco.rerollBase + eco.rerollStep * STATE.shop.reroll - (STATE.run.rerollDiscount || 0));
  }

  function renderShop() {
    const run = STATE.run, sh = STATE.shop;
    const slotHTML = (slot, i, group) => {
      const owned = sh.bought[group + i];
      const it = slot.item;
      const aff = run.payroll >= slot.cost && !owned;
      let body = "";
      if (slot.kind === "card") body = cardHTML(cloneCardPreview(it), null);
      else if (slot.kind === "coach") body = `<div class="shop-coach">${it.icon ? `<span class="sc-ico">${icon(it.icon)}</span>` : ""}<div class="sc-name">${it.name}</div><div class="sc-text">${it.text}</div></div>`;
      else body = `<div class="shop-misc shop-${slot.kind}"><div class="sm-name">${it.name}</div><div class="sm-text">${it.text}</div></div>`;
      return `
        <div class="shop-item ${owned ? "sold" : ""} ${aff ? "" : "cant"}" data-group="${group}" data-i="${i}">
          <div class="shop-item-body">${body}</div>
          <button class="btn buy-btn ${aff ? "" : "disabled"}" data-buy="${group}:${i}" ${owned ? "disabled" : ""}>${owned ? "Sold" : "$" + slot.cost}</button>
        </div>`;
    };

    const coaches = sh.coaches.map((s, i) => slotHTML(s, i, "coach")).join("") || emptyRow();
    const cards = sh.cards.map((s, i) => slotHTML(s, i, "card")).join("");
    const cons = sh.consumables.map((s, i) => slotHTML(s, i, "cons")).join("");
    const ups = sh.upgrades.map((s, i) => slotHTML(s, i, "up")).join("") || emptyRow();
    const packs = sh.packs.map((s, i) => slotHTML(s, i, "pack")).join("");

    const dugFull = run.dugout.length >= run.dugoutSlots;

    return `
    <div class="screen shop-screen">
      <div class="shop-head">
        <div class="shop-title">The Shop <span class="shop-round">${roundName(run.gameIndex)} · before ${gameLabel(run.gameIndex)}</span></div>
        <div class="shop-money">
          <div class="payroll-big">$<span id="shop-payroll">${run.payroll}</span></div>
          <button class="btn btn-reroll" data-act="reroll">Reroll ($${rerollCost()})</button>
          <button class="btn btn-secondary" data-act="open-deck">Deck (${run.deck.length})</button>
          <button class="btn btn-secondary" data-act="open-dugout">Dugout (${run.dugout.length}/${run.dugoutSlots})</button>
          <button class="btn btn-big btn-gold" data-act="leave-shop">Proceed ${icon("chevronR")}</button>
        </div>
      </div>
      ${dugFull ? `<div class="shop-warn">Dugout full (${run.dugout.length}/${run.dugoutSlots}). Sell a coach in the Dugout view to make room.</div>` : ""}
      <div class="shop-grid">
        <div class="shop-rowgrp shop-rowgrp-top">
          <div class="shop-section sec-coaches"><h3>Coaches</h3><div class="shop-row">${coaches}</div></div>
          <div class="shop-section sec-players"><h3>Players</h3><div class="shop-row">${cards}</div></div>
        </div>
        <div class="shop-rowgrp shop-rowgrp-bottom">
          <div class="shop-section"><h3>Analytics &amp; Scouting</h3><div class="shop-row">${cons}</div></div>
          <div class="shop-section"><h3>Booster Packs</h3><div class="shop-row">${packs}</div></div>
          <div class="shop-section"><h3>Front Office</h3><div class="shop-row">${ups}</div></div>
        </div>
      </div>
    </div>`;
  }
  function emptyRow() { return `<div class="shop-empty">— sold out —</div>`; }
  function cloneCardPreview(tpl) { const c = cloneCard(tpl); return c; }

  /* ---------- buying ---------- */
  function buy(group, i) {
    const run = STATE.run, sh = STATE.shop;
    const key = group + i;
    if (sh.bought[key]) return;
    let slot;
    if (group === "coach") slot = sh.coaches[i];
    else if (group === "card") slot = sh.cards[i];
    else if (group === "cons") slot = sh.consumables[i];
    else if (group === "up") slot = sh.upgrades[i];
    else if (group === "pack") slot = sh.packs[i];
    if (!slot) return;
    if (run.payroll < slot.cost) { SFX.error(); shake(`.shop-item[data-group="${group}"][data-i="${i}"]`); return; }

    if (group === "coach") {
      if (run.dugout.length >= run.dugoutSlots) { SFX.error(); toast("Dugout is full — sell a coach first."); return; }
      run.dugout.push(cloneCoach(slot.item));
      finishBuy(slot, key); render();
    } else if (group === "card") {
      run.deck.push(cloneCard(slot.item));
      finishBuy(slot, key); render();
    } else if (group === "up") {
      applyUpgrade(slot.item);
      run.upgradesOwned.push(slot.item.fx);
      finishBuy(slot, key); render();
    } else if (group === "cons") {
      const it = slot.item;
      if (it.kind === "analytics") {
        run.analytics[it.key] = (run.analytics[it.key] || 0) + 1;
        finishBuy(slot, key); toast(`${it.name} applied.`); render();
      } else {
        // scouting — needs a target (except none?) open picker
        openScoutingPicker(it, () => { finishBuy(slot, key); render(); });
      }
    } else if (group === "pack") {
      openPack(slot.item, () => { finishBuy(slot, key); render(); });
    }
  }
  function finishBuy(slot, key) {
    STATE.run.payroll -= slot.cost;
    STATE.shop.bought[key] = true;
    STATE.run.shopBuys += 1;
    SFX.buy();
    setText("shop-payroll", STATE.run.payroll);
    saveRun();
  }

  function applyUpgrade(u) {
    const run = STATE.run;
    switch (u.fx) {
      case "dugoutSlot": run.dugoutSlots += 1; break;
      case "handSize": run.handSize += 1; break;
      case "discount": run.discount += 1; break;
      case "shopSlot": run.extraCardSlots += 1; rollShopKeepBought(); break;
      case "rerollCheap": run.rerollDiscount += 1; break;
      case "startRally": run.startRally = 1.5; break;
      case "interest": run.interestCap = 8; break;
    }
    toast(`${u.name} acquired.`);
  }
  function rollShopKeepBought() {
    const bought = STATE.shop.bought;
    rollShop();
    STATE.shop.bought = bought;
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
    const rng = makeRNG(run.seed + ":pack:" + run.gameIndex + ":" + run.shopBuys);
    let options = [];
    if (pack.kind === "player") {
      const round = Math.floor(run.gameIndex / GAMES_PER_ROUND);
      let rar = ["common", "star"];
      if (pack.id === "pk_player_big") rar = ["star", "allstar"];
      if (round >= 2) rar.push("legend");
      const pool = PLAYERS.filter((p) => rar.indexOf(p.rarity) >= 0);
      options = rng.sample(pool, pack.count).map((p) => ({ kind: "card", item: p }));
    } else if (pack.kind === "coach") {
      const ownedFx = new Set(run.dugout.map((c) => c.fx));
      const pool = COACHES.filter((c) => !ownedFx.has(c.fx));
      options = rng.sample(pool, pack.count).map((c) => ({ kind: "coach", item: c }));
    } else if (pack.kind === "scouting") {
      options = rng.sample(SCOUTING, pack.count).map((c) => ({ kind: "scouting", item: c }));
    }
    STATE._pack = { pack, options, picksLeft: pack.choose, onDone, picked: [] };
    renderPackOverlay();
  }
  function renderPackOverlay() {
    const ctx = STATE._pack;
    if (!ctx) return;
    const opts = ctx.options.map((o, i) => {
      const picked = ctx.picked.indexOf(i) >= 0;
      let body;
      if (o.kind === "card") body = cardHTML(cloneCardPreview(o.item), null);
      else body = `<div class="shop-coach">${o.item.icon ? `<span class="sc-ico">${icon(o.item.icon)}</span>` : ""}<div class="sc-name">${o.item.name}</div><div class="sc-text">${o.item.text}</div></div>`;
      return `<div class="pack-opt ${picked ? "picked" : ""}" data-packpick="${i}">${body}${picked ? '<div class="pick-check">' + icon("check") + '</div>' : ""}</div>`;
    }).join("");
    overlay(`
      <div class="ov-card pack-ov">
        <h2>${ctx.pack.name}</h2>
        <div class="ov-sub">Choose ${ctx.pack.choose} of ${ctx.options.length}. (${ctx.picksLeft} left)</div>
        <div class="pack-grid">${opts}</div>
        <button class="btn ${ctx.picksLeft === 0 ? "btn-gold" : "btn-ghost"}" data-act="pack-done">${ctx.picksLeft === 0 ? "Done" : "Skip rest"}</button>
      </div>`);
  }
  function packPick(i) {
    const ctx = STATE._pack;
    if (!ctx || ctx.picksLeft <= 0) return;
    if (ctx.picked.indexOf(i) >= 0) return;
    const o = ctx.options[i];
    const run = STATE.run;
    if (o.kind === "card") run.deck.push(cloneCard(o.item));
    else if (o.kind === "coach") {
      if (run.dugout.length >= run.dugoutSlots) { toast("Dugout full — can't take this coach."); return; }
      run.dugout.push(cloneCoach(o.item));
    } else if (o.kind === "scouting") {
      // immediate apply via picker after closing pack — simpler: add as if a bump on random? Instead apply directly with picker
      // For simplicity in packs, scouting reports auto-apply to a chosen card after pack closes:
      STATE._pendingScout = STATE._pendingScout || [];
      STATE._pendingScout.push(o.item);
    }
    ctx.picked.push(i);
    ctx.picksLeft -= 1;
    SFX.buy();
    renderPackOverlay();
    if (ctx.picksLeft === 0) {
      setTimeout(() => packDone(), 350);
    }
  }
  function packDone() {
    const ctx = STATE._pack;
    if (!ctx) return;
    const cb = ctx.onDone;
    STATE._pack = null;
    closeOverlay();
    // resolve any pending scouting reports from the pack, one at a time
    if (STATE._pendingScout && STATE._pendingScout.length) {
      const next = STATE._pendingScout.shift();
      openScoutingPicker(next, () => { if (STATE._pendingScout.length) { const n = STATE._pendingScout.shift(); openScoutingPicker(n, finalize); } else finalize(); });
      function finalize() { if (cb) cb(); render(); }
    } else {
      if (cb) cb();
    }
  }

  /* ---------- deck / dugout inspectors ---------- */
  function openDeckView() {
    const run = STATE.run;
    const sorted = run.deck.slice().sort((a, b) => (RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]) || (b.power - a.power));
    const cards = sorted.map((c) => `<div class="deck-card">${cardHTML(c, null)}</div>`).join("");
    overlay(`
      <div class="ov-card deck-view">
        <h2>Your Deck (${run.deck.length})</h2>
        <div class="deck-grid">${cards}</div>
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
        <h2>Dugout (${run.dugout.length}/${run.dugoutSlots})</h2>
        <div class="ov-sub">Tap a coach to see what it does · sell any for half its cost.</div>
        <div class="dug-list">${cells}</div>
        <button class="btn btn-gold" data-act="close-ov">Close</button>
      </div>`);
  }
  function sellCoach(i) {
    const run = STATE.run;
    const c = run.dugout[i];
    if (!c) return;
    run.payroll += Math.max(1, Math.floor(c.cost / 2));
    run.dugout.splice(i, 1);
    SFX.coin();
    saveRun();
    openDugoutView();
    if (STATE.screen === "shop") render();
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
  function roundName(gi) { return ROUNDS[Math.floor(gi / GAMES_PER_ROUND)].name; }
  function isBossInning(gi) { return (gi % GAMES_PER_ROUND) === GAMES_PER_ROUND - 1; }
  function gameLabel(gi) { return "Inning " + (gi + 1) + (isBossInning(gi) ? " · Boss" : ""); }
  function ordinal(n) { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ============================================================
     SAVE / LOAD
     ============================================================ */
  function saveRun() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(STATE.run)); } catch (e) {}
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function loadRun() {
    try {
      const r = JSON.parse(localStorage.getItem(SAVE_KEY));
      return r || null;
    } catch (e) { return null; }
  }

  /* ============================================================
     EVENT WIRING
     ============================================================ */
  function wireScreen() {
    const root = $("#app");
    if (!root) return;

    root.onclick = (e) => {
      // explainer tooltips (info button + coach/trait badges) — pin on tap, toggle off
      const tipEl = tipTargetOf(e);
      if (tipEl) { if (TIP) TIP.toggle(tipEl, e.clientX, e.clientY); return; }
      if (TIP) TIP.hide();

      const seedEl = e.target.closest("[data-seed]");
      if (seedEl) { copySeed(seedEl.getAttribute("data-seed")); return; }
      const act = e.target.closest("[data-act]");
      const fr = e.target.closest("[data-franchise]");
      const buyEl = e.target.closest("[data-buy]");
      const apEl = e.target.closest("[data-approach]");
      const sellEl = e.target.closest("[data-sell]");
      const sendEl = e.target.closest("[data-send]");

      if (fr) { startFromFranchise(fr.getAttribute("data-franchise")); return; }
      if (buyEl) { const [g, i] = buyEl.getAttribute("data-buy").split(":"); buy(g, parseInt(i, 10)); return; }
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
      case "abandon": clearSave(); STATE.run = null; STATE.game = null; render(); break;
      case "toggle-sound": META.sound = !META.sound; SFX.setEnabled(META.sound); saveMeta(); render(); break;
      case "toggle-sound-menu": META.sound = !META.sound; SFX.setEnabled(META.sound); saveMeta(); showMenu(); break;
      case "play-game": startGame(); break;
      case "cancel-atbat": cancelAtBat(); break;
      case "open-deck": openDeckView(); break;
      case "open-dugout": openDugoutView(); break;
      case "reroll": doReroll(); break;
      case "leave-shop": STATE.screen = "map"; saveRun(); render(); break;
      case "to-shop": closeOverlay(); enterShop(); break;
      // menu system
      case "open-menu": showMenu(); break;
      case "menu-resume": closeOverlay(); break;
      case "back-to-menu": showMenu(); break;
      case "open-stats": showStats(); break;
      case "howto": showHowTo(0); break;
      case "howto-next": showHowTo((STATE._howtoPage || 0) + 1); break;
      case "howto-prev": showHowTo((STATE._howtoPage || 0) - 1); break;
      case "to-menu": closeOverlay(); if (STATE.run) saveRun(); STATE.screen = "title"; render(); break;
      case "abandon-run": confirmAbandon(); break;
      case "replay-seed": if (STATE.run) replaySeed(STATE.run.seed, STATE.run.franchiseId); break;
      case "abandon-confirm": clearSave(); STATE.run = null; STATE.game = null; closeOverlay(); STATE.screen = "title"; render(); break;
      case "confirm-newrun": { const id = STATE._pendingFranchise; STATE._pendingFranchise = null; if (id) doStartRun(id); break; }
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
      // explainer tooltips inside overlays (deck cards' info button, dugout coach badges)
      const tipEl = tipTargetOf(e);
      if (tipEl) { if (TIP) TIP.toggle(tipEl, e.clientX, e.clientY); return; }
      if (TIP) TIP.hide();
      // tap the dimmed backdrop to dismiss simple overlays (not pickers / packs / locked screens)
      if ((e.target.id === "overlay" || e.target.classList.contains("overlay-inner")) && !STATE._pick && !STATE._pack && !ov.classList.contains("lock")) {
        closeOverlay(); return;
      }
      const act = e.target.closest("[data-act]");
      const pick = e.target.closest("[data-pick]");
      const packpick = e.target.closest("[data-packpick]");
      const sellEl = e.target.closest("[data-sell]");
      if (pick) { applyScouting(parseInt(pick.getAttribute("data-pick"), 10)); return; }
      if (packpick) { packPick(parseInt(packpick.getAttribute("data-packpick"), 10)); return; }
      if (sellEl) { sellCoach(parseInt(sellEl.getAttribute("data-sell"), 10)); return; }
      if (!act) return;
      const v = act.getAttribute("data-act");
      if (v === "cancel-pick") { closeOverlay(); STATE._pick = null; return; }
      if (v === "pack-done") { packDone(); return; }
      handleAct(v);
    };
  }

  function startFromFranchise(id) {
    // guard against wiping an in-progress run by mis-clicking a franchise
    if (localStorage.getItem(SAVE_KEY)) { confirmNewRun(id); return; }
    doStartRun(id);
  }
  function resumeRun() {
    const r = loadRun();
    if (!r) { render(); return; }
    STATE.run = r;
    STATE._replaySeed = null; STATE._replayFranchise = null;
    // guard against version drift
    if (!r.analytics) r.analytics = { power: 0, contact: 0, patience: 0, speed: 0, rally: 0 };
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
    if (e.key >= "1" && e.key <= "8") {
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
    // a touch fires emulated mouseover/mousemove afterwards — suppress hover tips briefly
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
    return e.target.closest("[data-cardinfo], .coach-icon, .coach-chip, .card-trait, .trait-chip, .streak-chip, .edition");
  }

  /* ============================================================
     DRAG-TO-BAT — tap a card, or drag it onto the field diamond, to send the
     batter up (Balatro-style). Pointer events unify mouse + touch.
     ============================================================ */
  let _drag = null;
  function stageScale() {
    const st = document.getElementById("stage");
    if (!st) return 1;
    const m = (getComputedStyle(st).transform || "").match(/matrix\(([^,]+)/);
    return m ? (parseFloat(m[1]) || 1) : 1;
  }
  function overDiamond(x, y) {
    const dw = $(".diamond-wrap");
    if (!dw) return false;
    const r = dw.getBoundingClientRect();
    return x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10;
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
      _drag.over = overDiamond(e.clientX, e.clientY);
      const dw = $(".diamond-wrap"); if (dw) dw.classList.toggle("drop-active", _drag.over);
    }
  }
  function onCardPointerUp(e) {
    if (!_drag) return;
    const d = _drag; _drag = null;
    d.cardEl.classList.remove("dragging");
    d.cardEl.style.transform = "";
    const app = $("#app"); if (app) app.classList.remove("is-dragging");
    const dw = $(".diamond-wrap"); if (dw) dw.classList.remove("drop-active");
    if (d.over) { selectBatter(d.idx); return; }   // dropped on the field — step up
    if (!d.moved) { hintDrag(d.cardEl); }          // a plain tap isn't enough; nudge them to drag
    // otherwise: released in open space — snap back (transform already cleared)
  }
  // a tap on a card just reminds the player to drag it to the field
  function hintDrag(cardEl) {
    if (cardEl) { cardEl.classList.remove("nudge"); void cardEl.offsetWidth; cardEl.classList.add("nudge"); }
    const note = $("#drag-hint");
    if (note) { note.classList.remove("pulse"); void note.offsetWidth; note.classList.add("pulse"); }
    if (SFX && SFX.click) SFX.click();
  }
  function setupDrag() {
    document.addEventListener("pointerdown", onCardPointerDown);
    document.addEventListener("pointermove", onCardPointerMove);
    document.addEventListener("pointerup", onCardPointerUp);
    document.addEventListener("pointercancel", onCardPointerUp);
  }

  function boot() {
    SFX.setEnabled(META.sound);
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
