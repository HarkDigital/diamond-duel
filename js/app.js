/* ============================================================
   Diamond Duel — App: state, screens, loop, shop, bracket
   ============================================================ */
(function (global) {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
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
    pinchMode: false,
    shop: null,
    overlay: null,
  };

  /* ---------------- helpers: clone instances ---------------- */
  function cloneCard(tpl) {
    return {
      uid: uid("card"), id: tpl.id, name: tpl.name, nick: tpl.nick || null,
      bats: tpl.bats, contact: tpl.contact, power: tpl.power, eye: tpl.eye, speed: tpl.speed,
      tags: tpl.tags.slice(), edition: tpl.edition || null, rarity: tpl.rarity, cost: tpl.cost,
    };
  }
  function cloneCoach(tpl) {
    return {
      uid: uid("coach"), id: tpl.id, name: tpl.name, fx: tpl.fx, trigger: tpl.trigger,
      text: tpl.text, rarity: tpl.rarity, cost: tpl.cost,
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
      pinchHits: CONFIG.pinchHits,
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
    if (pitcher.rule === "closer") outs = 18;
    const baseTarget = CONFIG.targets[gi] || CONFIG.targets[CONFIG.targets.length - 1];
    const target = Math.round(baseTarget * pitcher.targetMultiplier);

    const deck = run.deck.map((c) => c); // reference copies (prospect growth persists to run.deck)
    rng.shuffle(deck);

    const game = {
      pitcher,
      outsRemaining: outs,
      outsThisInning: 0,
      pinchHitsRemaining: run.pinchHits,
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
    STATE.pinchMode = false;
    render();
    // little intro flash
    pushLog(`▶ ${roundName(gi)} · ${gameLabel(gi)} — facing ${pitcher.name}. Target ${target}.`, "neutral");
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
  async function playCard(handIndex) {
    if (STATE.busy || STATE.game.ended) return;
    const g = STATE.game, run = STATE.run;
    if (STATE.pinchMode) return pinchHit(handIndex);
    const card = g.hand[handIndex];
    if (!card) return;
    STATE.busy = true;
    SFX.resume();

    // visually lift the played card
    const cardEl = $(`.card[data-idx="${handIndex}"]`);
    if (cardEl) { cardEl.classList.add("playing"); }

    // remove from hand -> discard
    g.hand.splice(handIndex, 1);
    g.discard.push(card);

    // steal phase
    const stealEv = { triggers: [], steals: [] };
    const beforeBases = g.bases.map(snapshotRunner);
    Engine.runSteals(g, run, STATE.rng, stealEv);
    if (stealEv.steals.length) {
      renderDiamond();
      stealEv.triggers.forEach(flashCoachByFx);
      pushLog(`↗ Stolen base! (${stealEv.steals.join(", ")})`, "steal");
      await sleep(320);
    }

    await sleep(120);

    // resolve
    const ev = Engine.resolveAtBat(card, g.pitcher, g, run, STATE.rng);

    // animate result
    await animateResult(ev, card);

    // refill hand + inning bookkeeping
    drawToHand();
    const advanced = Engine.maybeAdvanceInning(g);
    if (advanced) {
      // clear runner stole flags for the new inning is implicit (new runners)
      renderDiamond();
      pushLog(`— End of inning ${g.inning - 1}. Bases cleared.`, "neutral");
    }

    renderGame();

    // end checks
    if (g.score >= g.target) {
      await sleep(250);
      return onWin();
    }
    if (g.outsRemaining <= 0) {
      await sleep(250);
      return onLose();
    }
    STATE.busy = false;
  }

  function snapshotRunner(r) { return r ? { name: r.name, speed: r.speed } : null; }

  async function pinchHit(handIndex) {
    const g = STATE.game;
    if (g.pinchHitsRemaining <= 0) { SFX.error(); return; }
    const card = g.hand[handIndex];
    if (!card) return;
    STATE.busy = true;
    g.hand.splice(handIndex, 1);
    g.discard.push(card);
    g.pinchHitsRemaining -= 1;
    const repl = drawCard();
    if (repl) g.hand.push(repl);
    SFX.deal();
    pushLog(`⇄ Pinch hit: ${card.name} out, ${repl ? repl.name : "(no card)"} in.`, "neutral");
    STATE.pinchMode = false;
    renderGame();
    STATE.busy = false;
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

    // sound
    if (o === "HR") SFX.homer();
    else if (o === "2B" || o === "3B") SFX.xbh();
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
      math = `Double play! Two outs.`;
    } else {
      math = ev.isSafe ? "" : "Rally cleared.";
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
    // the ☰ menu button only makes sense once a run is underway (title is the main menu)
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
          <span class="logo-diamond">◆</span>
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
        ? `<div class="seed-hint replay">↻ Replaying <code>${escAttr(STATE._replaySeed)}</code>${STATE._replayFranchise ? ` — pick <b>${(FRANCHISES.find(f => f.id === STATE._replayFranchise) || {}).name || ""}</b> below to reproduce it exactly` : ""}</div>`
        : `<div class="seed-hint">Paste a seed to replay a specific run, or leave it blank for a fresh one.</div>`}
      </div>
      <div class="franchise-grid">${fr}</div>
      <div class="title-foot">
        <div class="foot-btns">
          <button class="btn btn-ghost" data-act="open-stats">📊 Stats</button>
          <button class="btn btn-ghost" data-act="toggle-sound">${META.sound ? "🔊" : "🔇"} Sound: ${META.sound ? "On" : "Off"}</button>
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
        ${isReplayTarget ? `<div class="fr-replay-badge">↻ original</div>` : ""}
        <div class="fr-head"><h3>${f.name}</h3></div>
        <p class="fr-tag">${f.tagline}</p>
        <div class="fr-stats">
          ${miniStat("CON", mini(totals.c))}
          ${miniStat("POW", mini(totals.p))}
          ${miniStat("EYE", mini(totals.e))}
          ${miniStat("SPD", mini(totals.s))}
        </div>
        <div class="fr-bonus">${coach ? `★ ${coach.name}` : "—"}</div>
        <div class="fr-sub">${f.bonusText}</div>
        <span class="fr-go">Start ▸</span>
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
          <div class="resources">
            <div class="res"><b id="res-outs">0</b><span>OUTS</span></div>
            <div class="res"><b id="res-pinch">0</b><span>PINCH</span></div>
            <div class="res"><b id="res-inning">1</b><span>INNING</span></div>
          </div>
          <div class="diamond-wrap">
            <div class="diamond" id="diamond">
              <div class="base base-2" data-base="2"></div>
              <div class="base base-1" data-base="1"></div>
              <div class="base base-3" data-base="3"></div>
              <div class="base base-home"></div>
              <div class="run-pop-layer" id="run-pop-layer"></div>
            </div>
          </div>
          <div class="readout" id="readout"><div class="readout-empty">Play a card to begin the at-bat.</div></div>
        </div>

        <div class="col-center">
          <div class="play-log" id="play-log"></div>
        </div>

        <div class="col-right">
          <div class="dugout-title">DUGOUT</div>
          <div class="dugout" id="dugout"></div>
          <div class="payroll-chip" id="payroll-chip">$<span id="payroll-amt">0</span></div>
        </div>
      </div>

      <div class="hand-row">
        <div class="hand" id="hand"></div>
        <div class="hand-actions">
          <button class="btn btn-pinch" id="btn-pinch">Pinch Hit</button>
          <div class="hand-hint">Click a card to send the batter up. Keys 1–8.</div>
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
    setText("res-outs", g.outsRemaining);
    setText("res-pinch", g.pinchHitsRemaining);
    setText("res-inning", g.inning);
    setRally(g.rally, false);
    setText("payroll-amt", run.payroll);
    renderDiamond();
    renderHand();
    renderDugout();
    const pinchBtn = $("#btn-pinch");
    if (pinchBtn) {
      pinchBtn.textContent = `Pinch Hit (${g.pinchHitsRemaining})`;
      pinchBtn.classList.toggle("active", STATE.pinchMode);
      pinchBtn.disabled = g.pinchHitsRemaining <= 0;
    }
  }

  function renderDiamond() {
    const g = STATE.game;
    for (let i = 0; i < 3; i++) {
      const el = $(`.base[data-base="${i + 1}"]`);
      if (!el) continue;
      const runner = g.bases[i];
      el.classList.toggle("occupied", !!runner);
      el.innerHTML = runner ? `<div class="runner ${speedClass(runner.speed)}" title="${runner.name} · SPD ${Math.round(runner.speed)}"></div>` : "";
    }
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
    return `
      <div class="card rar-${c.rarity} ${c.edition ? "has-ed ed-bg-" + c.edition : ""}" ${idxAttr} data-uid="${c.uid}">
        <div class="card-top">
          <div class="bats bats-${c.bats}">${c.bats}</div>
          <div class="card-name" title="${c.name}">${c.nick || shortName(c.name)}</div>
          <div class="card-pos">${pos}</div>
        </div>
        ${ed}
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
  function shortName(n) { const p = n.split(" "); return p.length > 1 ? p[0][0] + ". " + p.slice(1).join(" ") : n; }
  function editionLabel(e) { return ({ gold: "GOLD", clutch: "CLUTCH", prospect: "PROSPECT", foil: "FOIL", veteran: "VET" })[e] || e.toUpperCase(); }

  function renderDugout() {
    const run = STATE.run;
    const d = $("#dugout");
    if (!d) return;
    const slots = [];
    for (let i = 0; i < run.dugoutSlots; i++) {
      const c = run.dugout[i];
      if (c) slots.push(coachChipHTML(c));
      else slots.push(`<div class="coach-chip empty"><span>empty</span></div>`);
    }
    d.innerHTML = slots.join("");
  }
  function coachChipHTML(c, opts) {
    opts = opts || {};
    let sub = "";
    if (c.state && c.state.bonus) sub = `<span class="coach-scale">+${c.state.bonus.toFixed(1)}</span>`;
    return `<div class="coach-chip rar-${c.rarity}" data-coach="${c.id}" data-uid="${c.uid}" title="${c.text}">
      <div class="coach-name">${c.name}${sub}</div>
      <div class="coach-text">${c.text}</div>
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
      // reset / shatter
      setRally(g.rally, false);
      const w = $("#sb-rally-wrap");
      if (w) { w.classList.remove("rally-reset"); void w.offsetWidth; w.classList.add("rally-reset"); }
    } else {
      setRally(g.rally, true);
      if (ev.isSafe) SFX.rally(g.rally);
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
    const el = $(`.coach-chip[data-coach="${id}"]`);
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
        <div class="ov-burst">✦</div>
        <h2>GAME WON</h2>
        <div class="ov-sub">You beat ${g.pitcher.name} — ${g.score} vs ${g.target}.</div>
        <div class="brk">${rows}<div class="brk-row brk-total"><span>Total earned</span><b>+$${total}</b></div></div>
        <div class="ov-pay">Payroll: <b>$${STATE.run.payroll}</b></div>
        <button class="btn btn-big btn-gold" data-act="to-shop">Visit the Shop ▸</button>
      </div>`);
  }

  function showGameOver(g) {
    overlay(`
      <div class="ov-card lose-ov">
        <h2>ELIMINATED</h2>
        <div class="ov-sub">You came up short against ${g.pitcher.name}.<br>Final: ${g.score} / ${g.target} · reached ${roundName(g.gameIndex)} (${gameLabel(g.gameIndex)}).</div>
        <div class="ov-stat">Best game score this run: ${STATE.run.stat.bestScore || g.score}</div>
        <div class="ov-actions">
          <button class="btn btn-big btn-gold" data-act="replay-seed">↻ Replay Seed</button>
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
        <div class="ov-burst big">🏆</div>
        <h2>WORLD SERIES CHAMPIONS</h2>
        <div class="ov-sub">You ran the entire gauntlet with ${FRANCHISES.find(f => f.id === STATE.run.franchiseId).name}.<br>Seed: ${seedChip(STATE.run.seed)}</div>
        <div class="ov-stat">Games won: ${STATE.run.stat.gamesWon} · Best game score: ${STATE.run.stat.bestScore}</div>
        <div class="ov-actions">
          <button class="btn btn-secondary" data-act="replay-seed">↻ Replay Seed</button>
          <button class="btn btn-big btn-gold" data-act="retry-run">New Run</button>
          <button class="btn btn-ghost" data-act="to-title">Main Menu</button>
        </div>
      </div>`, true);
  }

  /* ---------- pause / main menu ---------- */
  function showMenu() {
    if (SFX && SFX.click) SFX.click();
    const inRun = !!STATE.run;
    overlay(`
      <div class="ov-card menu-card">
        <h2>Menu</h2>
        <div class="menu-list">
          ${inRun ? `<button class="btn btn-gold menu-item" data-act="menu-resume">▸ Resume</button>` : ""}
          <button class="btn menu-item" data-act="open-stats">📊 View Stats</button>
          <button class="btn menu-item" data-act="howto">❔ How to Play</button>
          <button class="btn menu-item" data-act="toggle-sound-menu">${META.sound ? "🔊" : "🔇"} Sound: ${META.sound ? "On" : "Off"}</button>
          ${inRun ? `<button class="btn menu-item" data-act="to-menu">↩ Return to Main Menu<span class="menu-note">keeps your run — resume later</span></button>` : ""}
          ${inRun ? `<button class="btn btn-danger menu-item" data-act="abandon-run">✕ Abandon Run<span class="menu-note">quit and discard this run</span></button>` : ""}
        </div>
        <button class="btn btn-ghost" data-act="close-ov">Close</button>
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
        <h2>📊 Stats</h2>
        <h3>Career</h3>
        <div class="stat-grid">
          ${statCell("Championships", m.wins)}
          ${statCell("Runs played", m.runs)}
          ${statCell("Best game score", m.bestScore || 0)}
          ${statCell("Furthest reached", furthest)}
        </div>
        ${runHTML}
        <div class="stats-actions">
          ${STATE.run ? `<button class="btn btn-secondary" data-act="replay-seed">↻ Replay this seed</button>` : ""}
          <button class="btn ${STATE.run ? "" : "btn-gold"}" data-act="${STATE.run ? "back-to-menu" : "close-ov"}">${STATE.run ? "◂ Back" : "Close"}</button>
        </div>
      </div>`);
  }
  function statCell(label, val) {
    return `<div class="stat-cell"><div class="stat-val">${val}</div><div class="stat-label">${label}</div></div>`;
  }

  /* ---------- seeds: copy + replay ---------- */
  function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function seedChip(seed) { return `<code class="seed-copy" data-seed="${escAttr(seed)}" title="Click to copy this seed">${seed} ⧉</code>`; }
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

  function showHowTo() {
    if (SFX && SFX.click) SFX.click();
    overlay(`
      <div class="ov-card howto">
        <h2>How to Play <span class="howto-sub">Diamond Duel</span></h2>
        <div class="howto-body">
          <section>
            <h3>① The goal</h3>
            <p>You're running a postseason gauntlet. Each game, pile up <b>Score</b> to beat the opposing pitcher's <b>Target</b> before you run out of <b>Outs</b>. Win all 12 games — Wild Card through the World Series — to take the crown. Lose a single game and the run is over.</p>
          </section>
          <section>
            <h3>② Each at-bat</h3>
            <p>Your hand is your lineup. <b>Click a card</b> (or press <b>1–8</b>) to send that batter to the plate. The at-bat instantly resolves to one outcome — strikeout, walk, single, homer… — from the batter's stats versus the pitcher. Then you draw back up and pick the next batter. <em>The order you bat them is the puzzle.</em></p>
          </section>
          <section class="howto-rally">
            <h3>③ The Rally — this is the whole game</h3>
            <p>Every scoring play is worth <b>Bag value × Rally</b>.</p>
            <ul>
              <li><b>Bag value</b> is the event's raw worth: Walk <b>1</b>, Single <b>2</b>, Double <b>3</b>, Triple <b>4</b>, Home Run <b>5</b> — plus <b>+1</b> for every runner who scores on the play.</li>
              <li><b>Rally</b> is your multiplier. It starts at <b>×1.0</b> and climbs <b>+0.5</b> every time you reach base safely… but an <b>OUT resets it straight back to ×1.0</b>.</li>
            </ul>
            <p>A three-run homer (bag 8) at <b>×3.0</b> scores <b>24</b> — the same swing leading off at ×1.0 scores just 8. <b>String hits together and time your big bats to land while the rally is high.</b></p>
          </section>
          <section>
            <h3>④ Your resources</h3>
            <ul>
              <li><b>Outs</b> — your budget, 27 per game (some bosses give fewer). Reach zero below the Target and you're eliminated.</li>
              <li><b>Pinch Hit</b> — swap an unwanted card for a fresh draw. Click <b>Pinch Hit</b> (or press <b>P</b>), then click the card to replace it. Limited per game.</li>
              <li><b>Innings</b> — every 3 outs starts a new inning and clears the bases.</li>
            </ul>
          </section>
          <section>
            <h3>⑤ Reading a card</h3>
            <p>Four stats (0–100): <b class="s-c">Contact</b> (singles, fewer strikeouts), <b class="s-p">Power</b> (extra-base hits &amp; homers), <b class="s-e">Eye</b> (walks), <b class="s-s">Speed</b> (steals, extra bases, beating the double play). The <b>L / R / S</b> badge is handedness — a lefty batter facing a righty pitcher (or vice-versa) gets a <b>platoon</b> boost; switch-hitters (S) are never at a disadvantage.</p>
          </section>
          <section>
            <h3>⑥ Runners</h3>
            <p>Hits advance runners around the diamond. A runner on 2nd or 3rd is <b>in scoring position</b> — drive them home for +1 bag value each, and several coaches pay out heavily when runners are aboard.</p>
          </section>
          <section>
            <h3>⑦ Coaches &amp; the dugout</h3>
            <p>Coaches are your <b>build</b> (think Balatro's Jokers). They sit in dugout slots and trigger passively or in the right situation — flat bag boosts, rally bonuses, payoffs for sluggers or speedsters, and scaling coaches that grow all run long. Buy them in the shop and lean into a synergy.</p>
          </section>
          <section>
            <h3>⑧ The gauntlet &amp; the shop</h3>
            <p>Four rounds (Wild Card → Division → Championship → World Series), each with two ordinary games and a <b>Boss</b>. Boss pitchers carry a nasty rule (Power halved, strikeouts cost two outs…) — it's telegraphed on the map, so shop for it. Between games you spend <b>Payroll ($)</b> on players, coaches, analytics, scouting reports, front-office upgrades, and booster packs. <em>You can't win the late rounds with your starting deck — building is the whole point.</em></p>
          </section>
          <section class="howto-tips">
            <h3>★ Quick tips</h3>
            <ul>
              <li>Don't waste your slugger leading off — hold it until runners are on and the rally is built.</li>
              <li>Thin your deck: fewer, better cards means you draw your bombs more often.</li>
              <li>Two or three coaches pointing the same direction beats a pile of random ones.</li>
            </ul>
          </section>
        </div>
        <button class="btn btn-gold" data-act="close-ov">Got it — play ball ▸</button>
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
        const label = isBossGame ? "BOSS" : "G" + (gj + 1);
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
        <h2>The Gauntlet</h2>
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
          <button class="btn btn-big btn-gold" data-act="play-game">Play Ball ▸</button>
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
      else if (slot.kind === "coach") body = `<div class="shop-coach"><div class="sc-name">${it.name}</div><div class="sc-text">${it.text}</div></div>`;
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
          <button class="btn btn-big btn-gold" data-act="leave-shop">Proceed ▸</button>
        </div>
      </div>
      ${dugFull ? `<div class="shop-warn">Dugout full (${run.dugout.length}/${run.dugoutSlots}). Sell a coach in the Dugout view to make room.</div>` : ""}
      <div class="shop-grid">
        <div class="shop-section"><h3>Coaches</h3><div class="shop-row">${coaches}</div></div>
        <div class="shop-section"><h3>Players</h3><div class="shop-row">${cards}</div></div>
        <div class="shop-section"><h3>Analytics &amp; Scouting</h3><div class="shop-row">${cons}</div></div>
        <div class="shop-section"><h3>Front Office</h3><div class="shop-row">${ups}</div></div>
        <div class="shop-section"><h3>Booster Packs</h3><div class="shop-row">${packs}</div></div>
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
      case "pinchHit": run.pinchHits += 1; break;
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
      else body = `<div class="shop-coach"><div class="sc-name">${o.item.name}</div><div class="sc-text">${o.item.text}</div></div>`;
      return `<div class="pack-opt ${picked ? "picked" : ""}" data-packpick="${i}">${body}${picked ? '<div class="pick-check">✓</div>' : ""}</div>`;
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
    const chips = run.dugout.map((c, i) => `
      <div class="dug-row">
        ${coachChipHTML(c)}
        <button class="btn btn-sell" data-sell="${i}">Sell +$${Math.max(1, Math.floor(c.cost / 2))}</button>
      </div>`).join("") || `<div class="shop-empty">No coaches yet.</div>`;
    overlay(`
      <div class="ov-card dugout-view">
        <h2>Dugout (${run.dugout.length}/${run.dugoutSlots})</h2>
        <div class="dug-list">${chips}</div>
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
  function gameLabel(gi) {
    const g = gi % GAMES_PER_ROUND;
    return g === GAMES_PER_ROUND - 1 ? "Boss Game" : "Game " + (g + 1);
  }

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
      const seedEl = e.target.closest("[data-seed]");
      if (seedEl) { copySeed(seedEl.getAttribute("data-seed")); return; }
      const act = e.target.closest("[data-act]");
      const fr = e.target.closest("[data-franchise]");
      const buyEl = e.target.closest("[data-buy]");
      const cardEl = e.target.closest(".card[data-idx]");
      const coachShop = null;
      const sellEl = e.target.closest("[data-sell]");

      if (fr) { startFromFranchise(fr.getAttribute("data-franchise")); return; }
      if (buyEl) { const [g, i] = buyEl.getAttribute("data-buy").split(":"); buy(g, parseInt(i, 10)); return; }
      if (STATE.screen === "game" && cardEl && !STATE.busy) { playCard(parseInt(cardEl.getAttribute("data-idx"), 10)); return; }
      if (sellEl) { sellCoach(parseInt(sellEl.getAttribute("data-sell"), 10)); return; }

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
      case "open-deck": openDeckView(); break;
      case "open-dugout": openDugoutView(); break;
      case "reroll": doReroll(); break;
      case "leave-shop": STATE.screen = "map"; saveRun(); render(); break;
      case "to-shop": closeOverlay(); enterShop(); break;
      case "btn-pinch": break;
      // menu system
      case "open-menu": showMenu(); break;
      case "menu-resume": closeOverlay(); break;
      case "back-to-menu": showMenu(); break;
      case "open-stats": showStats(); break;
      case "howto": showHowTo(); break;
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

  // pinch toggle (separate because button has no data-act conflict)
  document.addEventListener("click", (e) => {
    const p = e.target.closest("#btn-pinch");
    if (p && STATE.screen === "game") {
      if (STATE.game.pinchHitsRemaining <= 0) { SFX.error(); return; }
      STATE.pinchMode = !STATE.pinchMode;
      renderGame();
    }
  });

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !STATE._pick && !STATE._pack) {
      const ov = document.getElementById("overlay");
      if (ov && ov.classList.contains("show") && !ov.classList.contains("lock")) { closeOverlay(); return; }
    }
    if (STATE.screen !== "game" || STATE.busy) return;
    if (e.key >= "1" && e.key <= "8") {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < STATE.game.hand.length) playCard(idx);
    } else if (e.key === "p" || e.key === "P") {
      if (STATE.game.pinchHitsRemaining > 0) { STATE.pinchMode = !STATE.pinchMode; renderGame(); }
    }
  });

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    SFX.setEnabled(META.sound);
    render();
    const hb = document.getElementById("howto-btn");
    if (hb) hb.onclick = showHowTo;
    const mb = document.getElementById("menu-btn");
    if (mb) mb.onclick = showMenu;
    // expose a small debug API for testing
    global.DD = {
      STATE, CONFIG,
      play: (i) => playCard(i || 0),
      autoPlay: autoPlay,
      startFranchise: startFromFranchise,
      win: () => { STATE.game.score = STATE.game.target; },
      give: (n) => { STATE.run.payroll += (n || 50); if (STATE.screen === "shop") render(); },
      state: () => STATE,
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
      let best = 0, bestScore = -1;
      g.hand.forEach((c, i) => {
        let s = c.contact * 0.5 + c.power * (risp ? 1.1 : 0.7) + c.eye * 0.4 + c.speed * 0.2;
        if (s > bestScore) { bestScore = s; best = i; }
      });
      await playCard(best);
      await sleep(30);
    }
    return STATE.game ? STATE.game.result : null;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.DDApp = { STATE };
})(window);
