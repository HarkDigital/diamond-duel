/* ============================================================
   Diamond Duel — At-bat engine
   resolveAtBat() is the single, heavily-testable resolver.
   It mutates game state (bases/rally/score/outs) and returns a
   rich event object for animation + the play log.
   ============================================================ */
(function (global) {
  "use strict";

  const HITS = { "1B": 1, "2B": 1, "3B": 1, HR: 1 };
  const SAFE = { BB: 1, HBP: 1, "1B": 1, "2B": 1, "3B": 1, HR: 1 };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(stat) { return (stat - 50) / 50; } // -> [-1, 1]

  /* ---------- deck composition helpers ---------- */
  function tagCount(run, tag) {
    let n = 0;
    for (const c of run.deck) if (c.tags.indexOf(tag) >= 0) n++;
    return n;
  }
  function hasCoach(run, fx) { return run.dugout.some((c) => c.fx === fx); }
  function eachCoach(run, fx, cb) { for (const c of run.dugout) if (c.fx === fx) cb(c); }

  function whiteyBonus(run) {
    return hasCoach(run, "whiteyBall") && tagCount(run, "speedster") >= 3 ? 18 : 0;
  }
  function speedMult(run) {
    const lvl = (run.analytics && run.analytics.speed) || 0;
    return 1 + lvl * 0.12;
  }

  /* ---------- effective stats (transient game modifiers) ---------- */
  function effectiveBatterStats(card, pitcher, game, run) {
    let c = card.contact, p = card.power, e = card.eye, s = card.speed;
    let debuffed = false;
    if (pitcher.rule === "knuckleballer") p = p / 2;
    if (pitcher.rule === "junkballer" && game.inningPA === 0) {
      c -= 22; p -= 22; e -= 22; s -= 22; debuffed = true;
    }
    // hot/cold streaks shift hitting stats (Ice Veins immune to cold; Streaky doubles the swing)
    const sc = CONFIG.streak || { hotAt: 2, coldAt: 2, perLevel: 7, maxLevel: 3 };
    let st = card._streak || 0;
    if (card.trait === "ice" && st < 0) st = 0;
    let mod = 0;
    if (st >= sc.hotAt) mod = Math.min(sc.maxLevel, st) * sc.perLevel;
    else if (st <= -sc.coldAt) mod = Math.max(-sc.maxLevel, st) * sc.perLevel;
    if (card.trait === "streaky") mod *= 2;
    c += mod; p += mod; e += mod * 0.5;
    return {
      contact: clamp(c, 0, 140),
      power: clamp(p, 0, 140),
      eye: clamp(e, 0, 140),
      speed: clamp(s, 0, 140),
      debuffed,
      hot: st >= sc.hotAt, cold: st <= -sc.coldAt, streak: st,
    };
  }

  /* ---------- platoon ---------- */
  // returns { mult, state: 'adv'|'dis'|'neutral' }
  function platoonState(card, pitcher, run) {
    const bats = card.bats;
    const throws = pitcher.bats;
    let state = "neutral";
    if (bats === "S") state = "adv";
    else if ((bats === "L" && throws === "R") || (bats === "R" && throws === "L")) state = "adv";
    else if (bats === throws) state = "dis";

    // Boss: lefty specialist removes the bonus & adds a penalty for L bats
    if (pitcher.rule === "leftySpecialist" && bats === "L") state = "dis";

    let mult = 1;
    if (state === "adv") {
      let bonus = CONFIG.platoonAdvantage - 1;
      if (hasCoach(run, "platoonManager")) bonus *= 2;
      mult = 1 + bonus;
    } else if (state === "dis") {
      mult = CONFIG.platoonDisadvantage;
    }
    return { mult, state };
  }

  /* ---------- outcome distribution ---------- */
  function buildDistribution(es, pitcher, plat, run, approach, batter) {
    const w = Object.assign({}, CONFIG.baseWeights);
    const co = CONFIG.coeff;
    const nc = norm(es.contact), np = norm(es.power), ne = norm(es.eye);
    const ns = norm(pitcher.stuff), ncmd = norm(pitcher.command);

    // batter
    for (const k in co.contact) w[k] += co.contact[k] * nc;
    for (const k in co.power) w[k] += co.power[k] * np;
    for (const k in co.eye) w[k] += co.eye[k] * ne;
    // pitcher
    for (const k in co.stuff) w[k] += co.stuff[k] * ns;
    for (const k in co.command) w[k] += co.command[k] * ncmd;

    // platoon multiplies hit weights
    if (plat.mult !== 1) {
      w["1B"] *= plat.mult; w["2B"] *= plat.mult; w["3B"] *= plat.mult; w["HR"] *= plat.mult;
    }

    // at-bat approach reshapes the swing profile (Swing Away / Power / Work the Count)
    const ap = approach && CONFIG.approaches && CONFIG.approaches[approach];
    if (ap && ap.w) { for (const k in ap.w) if (w[k] != null) w[k] *= ap.w[k]; }

    // signature traits reshape the swing
    const tr = batter && batter.trait;
    if (tr === "launch" && approach === "power") w.K /= ((CONFIG.approaches.power.w.K) || 1); // sell out, no extra Ks
    if (tr === "eagle") { w.BB *= 1.45; w.K *= 0.5; }
    if (tr === "mistake" && pitcher.command < 42) { w["1B"] *= 1.25; w["2B"] *= 1.4; w["3B"] *= 1.3; w.HR *= 1.45; }

    // floors
    for (const k in w) w[k] = Math.max(0, w[k]);
    // never let strikeout/out collapse to literally nothing of a category we need
    if (w.OUT < 1) w.OUT = 1;
    return w;
  }

  /* ---------- base running ---------- */
  function takeExtraChance(speed, run) {
    let p = (CONFIG.extraBaseBase + (speed + whiteyBonus(run) - 50) * 0.009) * speedMult(run);
    return clamp(p, 0.02, 0.92);
  }
  function stealChance(speed, run) {
    let p = ((speed + whiteyBonus(run) - 50) * 0.013 + 0.25) * speedMult(run);
    return clamp(p, 0, 0.95);
  }
  function dpChance(batterSpeed) {
    return clamp(CONFIG.dpBaseChance - (batterSpeed - 50) * 0.006, 0.05, 0.85);
  }

  // Generic runner advancement with downward collision resolution.
  // advances[i] = bases the runner at base i should try to move. batterBase 0..2 or 3(home).
  function runnersAdvance(bases, advances, batterBase, batter) {
    let runs = 0;
    const nb = [null, null, null];
    for (let i = 2; i >= 0; i--) {
      if (!bases[i]) continue;
      let t = i + advances[i];
      if (t >= 3) { runs++; continue; }
      while (t > i && nb[t] != null) t--;
      nb[t] = bases[i];
    }
    if (batterBase >= 3) { runs++; }
    else { let t = batterBase; while (t > 0 && nb[t] != null) t--; nb[t] = batter; }
    return { newBases: nb, runs };
  }

  function forceWalk(bases, batter) {
    let runs = 0;
    const nb = bases.slice();
    if (nb[0]) {
      if (nb[1]) {
        if (nb[2]) runs++;
        nb[2] = nb[1];
      }
      nb[1] = nb[0];
    }
    nb[0] = batter;
    return { newBases: nb, runs };
  }

  /* ---------- steals (positive-only: succeed or stay, no caught stealing in v1) ---------- */
  function runSteals(game, run, rng, ev) {
    if (!CONFIG.stealEnabled) return;
    const b = game.bases;
    // 2nd -> 3rd
    if (b[1] && !b[2] && (b[1].speed + whiteyBonus(run)) >= CONFIG.stealSpeedFloor && !b[1].stoleThisInning) {
      if (rng.chance(stealChance(b[1].speed, run))) {
        b[2] = b[1]; b[1] = null; b[2].stoleThisInning = true;
        registerSteal(game, run, ev, "3rd");
      }
    }
    // 1st -> 2nd
    if (b[0] && !b[1] && (b[0].speed + whiteyBonus(run)) >= CONFIG.stealSpeedFloor && !b[0].stoleThisInning) {
      if (rng.chance(stealChance(b[0].speed, run))) {
        b[1] = b[0]; b[0] = null; b[1].stoleThisInning = true;
        registerSteal(game, run, ev, "2nd");
      }
    }
  }
  function registerSteal(game, run, ev, toBase) {
    ev.steals = ev.steals || [];
    ev.steals.push(toBase);
    if (hasCoach(run, "smallBall")) {
      game.rally += 0.5;
      ev.triggers.push("coach:small_ball");
    }
    if (SFX) SFX.steal();
  }

  // ACTIVE steal — the player chooses to Send a runner. Real risk: caught = an out.
  function attemptSteal(game, run, rng, fromBase) {
    const b = game.bases;
    const runner = b[fromBase];
    if (!runner || fromBase >= 2 || b[fromBase + 1] != null) return { ok: false };
    const burner = runner.card && runner.card.trait === "burner";
    const p = clamp(stealChance(runner.speed, run) + (burner ? 0.22 : 0), 0.35, 0.97);
    const res = { ok: true, runner, from: fromBase, rallyBonus: 0, triggers: [] };
    if (rng.chance(p)) {
      b[fromBase + 1] = runner; b[fromBase] = null; runner.stoleThisInning = true;
      res.caught = false; res.to = fromBase + 1;
      if (hasCoach(run, "smallBall")) { game.rally += 0.5; res.rallyBonus = 0.5; res.triggers.push("coach:small_ball"); }
    } else {
      b[fromBase] = null;
      game.outsRemaining -= 1; game.outsThisInning += 1;
      res.caught = true;
    }
    return res;
  }

  /* ---------- the resolver ---------- */
  function resolveAtBat(batter, pitcher, game, run, rng, approach) {
    const C = CONFIG;
    const ev = {
      batterName: batter.name,
      approach: approach || "swing",
      triggers: [],
      payrollGained: 0,
      steals: [],
    };

    // Snapshot pre-play context (coaches read this)
    const preBases = game.bases.slice();
    const runnerOnFirst = !!preBases[0];
    const rispBefore = !!preBases[1] || !!preBases[2];
    const outsThisInning = game.outsThisInning;
    const consecBefore = game.consecutiveSafe;
    const wasSluggerLast = game.lastWasSlugger;
    const inningLeadActive = game.inningLeadReached;

    const es = effectiveBatterStats(batter, pitcher, game, run);
    if (es.debuffed) ev.triggers.push("boss:junkballer");
    const plat = platoonState(batter, pitcher, run);
    ev.platoon = plat.state;

    // roll outcome (the chosen approach + the batter's trait reshape the odds)
    const w = buildDistribution(es, pitcher, plat, run, approach, batter);
    let outcome = rng.weighted(Object.keys(w).map((k) => ({ v: k, w: w[k] })));

    // boss: ground-ball specialist downgrades doubles
    if (pitcher.rule === "groundball" && outcome === "2B") {
      outcome = "1B"; ev.triggers.push("boss:groundball");
    }

    // split OUT into GB / FB
    let finalOutcome = outcome;
    if (outcome === "OUT") {
      const pGround = clamp(0.5 - (pitcher.groundFlyLean || 0) * 0.25, 0.15, 0.85);
      finalOutcome = rng.chance(pGround) ? "OUT_GB" : "OUT_FB";
    }

    // resolve bases / outs / runs
    let outsAdded = 1;
    let runsOnPlay = 0;
    let productiveOut = false;
    let newBases = game.bases.slice();
    const batterRunner = { name: batter.name, nick: batter.nick, speed: es.speed, card: batter };

    // BUNT approach — a sacrifice that overrides the rolled outcome.
    if (approach === "bunt") {
      ev.bunt = true;
      ev.buntSafe = rng.chance(clamp((CONFIG.buntSafeBase || 0.06) + (es.speed - 60) * 0.005, 0.02, 0.45));
    }

    if (ev.bunt && ev.buntSafe) {
      // beaten out for a bunt single — batter safe at first, runners advance one
      const r = runnersAdvance(game.bases, [1, 1, 1], 0, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0; finalOutcome = "1B";
    } else if (ev.bunt) {
      // sacrifice — batter out, the lead runner advances one (no double play)
      newBases = game.bases.slice();
      if (newBases[2]) { runsOnPlay++; newBases[2] = null; }
      else if (newBases[1]) { newBases[2] = newBases[1]; newBases[1] = null; }
      else if (newBases[0]) { newBases[1] = newBases[0]; newBases[0] = null; }
      outsAdded = 1; productiveOut = true; finalOutcome = "OUT_GB";
    } else if (finalOutcome === "BB" || finalOutcome === "HBP") {
      const r = forceWalk(game.bases, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0;
    } else if (finalOutcome === "1B") {
      const adv = [0, 1, 2].map((i) => (game.bases[i] && rng.chance(takeExtraChance(game.bases[i].speed, run))) ? 2 : 1);
      const r = runnersAdvance(game.bases, adv, 0, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0;
    } else if (finalOutcome === "2B") {
      const adv = [0, 1, 2].map((i) => {
        if (!game.bases[i]) return 2;
        if (i === 0 && rng.chance(takeExtraChance(game.bases[0].speed, run))) return 3; // first scores
        return 2;
      });
      const r = runnersAdvance(game.bases, adv, 1, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0;
    } else if (finalOutcome === "3B") {
      const r = runnersAdvance(game.bases, [3, 3, 3], 2, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0;
    } else if (finalOutcome === "HR") {
      const r = runnersAdvance(game.bases, [3, 3, 3], 3, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0;
    } else if (finalOutcome === "K") {
      outsAdded = pitcher.rule === "flamethrower" ? 2 : 1;
      if (pitcher.rule === "flamethrower") ev.triggers.push("boss:flamethrower");
      newBases = game.bases.slice();
    } else if (finalOutcome === "OUT_GB") {
      const canDP = runnerOnFirst && outsThisInning < 2;
      if (canDP && rng.chance(dpChance(es.speed))) {
        // double play: lead force at second + batter
        newBases = game.bases.slice();
        newBases[0] = null;
        outsAdded = 2;
        ev.doublePlay = true;
        ev.triggers.push("dp");
      } else if (rng.chance(C.productiveOutChance) && (game.bases[2] || game.bases[1] || game.bases[0])) {
        // productive out: advance lead runner one base
        newBases = game.bases.slice();
        if (newBases[2]) { runsOnPlay++; newBases[2] = null; }
        else if (newBases[1]) { newBases[2] = newBases[1]; newBases[1] = null; }
        else if (newBases[0]) { newBases[1] = newBases[0]; newBases[0] = null; }
        outsAdded = 1; productiveOut = true;
        ev.productiveOut = true;
      } else {
        newBases = game.bases.slice(); outsAdded = 1;
      }
    } else if (finalOutcome === "OUT_FB") {
      if (game.bases[2] && outsThisInning < 2 && rng.chance(C.sacFlyBaseChance)) {
        newBases = game.bases.slice();
        newBases[2] = null; runsOnPlay++;
        outsAdded = 1; productiveOut = true;
        ev.sacFly = true; ev.productiveOut = true;
      } else {
        newBases = game.bases.slice(); outsAdded = 1;
      }
    }

    const isHit = !!HITS[finalOutcome];
    const reachedBase = outsAdded === 0; // BB/HBP/hits
    const isSafe = reachedBase;

    /* ---------- bag value ---------- */
    let bag = 0;
    if (finalOutcome === "BB" || finalOutcome === "HBP") bag = C.bag.BB;
    else if (HITS[finalOutcome]) bag = C.bag[finalOutcome];
    bag += runsOnPlay; // +1 per run

    // sabermetrician: walks count as singles
    if ((finalOutcome === "BB" || finalOutcome === "HBP") && hasCoach(run, "sabermetrician")) {
      bag = C.bag["1B"] + runsOnPlay;
      ev.triggers.push("coach:sabermetrician");
    }

    // passive bag bonuses (only on offense-producing outcomes)
    if (bag > 0) {
      eachCoach(run, "launchAngle", () => { if (finalOutcome === "HR") { bag += 2; ev.triggers.push("coach:launch_angle"); } });
      eachCoach(run, "contactInstructor", () => { if (finalOutcome === "1B") { bag += 1; ev.triggers.push("coach:contact_instructor"); } });
      eachCoach(run, "gapCoach", () => { if (finalOutcome === "2B" || finalOutcome === "3B") { bag += 2; ev.triggers.push("coach:gap_coach"); } });
      eachCoach(run, "bashBrothers", () => { if (isHit && tagCount(run, "slugger") >= 4) { bag += 1; ev.triggers.push("coach:bash_brothers"); } });
      eachCoach(run, "rispSpecialist", () => { if (rispBefore && runsOnPlay > 0) { bag += runsOnPlay; ev.triggers.push("coach:risp_specialist"); } });
      // analytics
      if (run.analytics) {
        if (finalOutcome === "HR" && run.analytics.power) bag += run.analytics.power * 1;
        if (finalOutcome === "2B" && run.analytics.power) bag += run.analytics.power * 0.5;
        if (finalOutcome === "1B" && run.analytics.contact) bag += run.analytics.contact * 0.5;
      }
      // Ace Killer trait: +1 bag vs boss pitchers
      if (batter.trait === "acekiller" && pitcher.isBoss) bag += 1;
    }

    /* ---------- event rally bonus (applies to scoring THIS event only) ---------- */
    let eventRallyBonus = 0;
    if (isSafe) {
      eachCoach(run, "twoOutMagic", () => { if (outsThisInning === 2) { eventRallyBonus += 1.0; ev.triggers.push("coach:two_out_magic"); } });
      eachCoach(run, "prospectPipeline", (c) => { if (c.state.bonus) eventRallyBonus += c.state.bonus; });
      eachCoach(run, "hotStreak", (c) => { if (c.state.bonus) eventRallyBonus += c.state.bonus; });
      eachCoach(run, "veteranPresence", (c) => { if (c.state.bonus) eventRallyBonus += c.state.bonus; });
      eachCoach(run, "rallyCap", () => { if ((consecBefore + 1) % 3 === 0) { eventRallyBonus += 1.5; ev.triggers.push("coach:rally_cap"); } });
      if (batter.edition === "clutch" && rispBefore) { eventRallyBonus += C.edition.clutchRallyBonus; ev.triggers.push("edition:clutch"); }
      if (batter.edition === "veteran") eventRallyBonus += C.edition.veteranRallyBonus;
      // signature traits
      if (batter.trait === "clutch" && (outsThisInning === 2 || rispBefore)) { eventRallyBonus += 1.0; ev.triggers.push("trait:clutch"); }
      if (batter.trait === "acekiller" && pitcher.isBoss) { eventRallyBonus += 1.0; ev.triggers.push("trait:acekiller"); }
    }

    /* ---------- score the event ---------- */
    const rallyUsed = game.rally + eventRallyBonus;
    let scoreGained = 0;
    if (bag > 0 && isSafe) {
      scoreGained = Math.round(bag * rallyUsed);
      game.score += scoreGained;
    }

    /* ---------- update rally ---------- */
    let rallyDelta = 0;
    if (isSafe) {
      let inc = (finalOutcome === "BB" || finalOutcome === "HBP")
        ? (hasCoach(run, "patienceGuru") ? 1.0 : C.walkRallyIncrement)
        : C.rallyIncrement;
      if (hasCoach(run, "patienceGuru") && (finalOutcome === "BB" || finalOutcome === "HBP")) ev.triggers.push("coach:patience_guru");

      let bonus = 0;
      eachCoach(run, "tableSetter", () => { if (inningLeadActive) { bonus += 0.5; ev.triggers.push("coach:table_setter"); } });
      eachCoach(run, "hitAndRun", () => { if (batter.tags.indexOf("contact") >= 0 && runnerOnFirst) { bonus += 0.5; ev.triggers.push("coach:hit_and_run"); } });
      eachCoach(run, "backToBack", () => { if (batter.tags.indexOf("slugger") >= 0 && wasSluggerLast) { bonus += 1.0; ev.triggers.push("coach:back_to_back"); } });
      if (run.analytics && run.analytics.rally) bonus += run.analytics.rally * 0.1;
      if (run.analytics && run.analytics.patience && (finalOutcome === "BB" || finalOutcome === "HBP")) bonus += run.analytics.patience * 0.25;
      if (game.sparkBonus) bonus += game.sparkBonus; // Sparkplug trait active this inning

      let total = inc + bonus;
      if (pitcher.rule === "workhorse") { total *= 0.5; ev.triggers.push("boss:workhorse"); }
      rallyDelta = total;
      game.rally += total;
    } else {
      // an out
      if (productiveOut && hasCoach(run, "smallBall")) {
        game.rally += 0.5; rallyDelta = 0.5;
        ev.triggers.push("coach:small_ball");
      } else if (CONFIG.rallyResetsOnOut) {
        game.rally = game.startRally;
        rallyDelta = -999; // sentinel: reset (legacy hot-hand mode)
      } else {
        rallyDelta = 0; // rally persists across outs — only the inning's end resets it
      }
    }

    /* ---------- consecutive-safe tracker ---------- */
    if (isSafe) game.consecutiveSafe += 1;
    else if (!(productiveOut && hasCoach(run, "smallBall"))) game.consecutiveSafe = 0;

    /* ---------- table-setter / sparkplug: did the leadoff batter reach? ---------- */
    if (game.inningPA === 0 && isSafe) {
      game.inningLeadReached = true;
      if (batter.trait === "sparkplug") { game.sparkBonus = 0.5; ev.triggers.push("trait:sparkplug"); }
    }

    /* ---------- editions / scaling state (on a hit) ---------- */
    if (isHit) {
      // gold -> payroll
      if (batter.edition === "gold") { ev.payrollGained += C.edition.goldPayroll; ev.triggers.push("edition:gold"); }
      // prospect -> grow a stat
      if (batter.edition === "prospect") {
        const g = C.edition.prospectStatGain;
        if (batter.power >= batter.contact) batter.power = clamp(batter.power + g, 0, 130);
        else batter.contact = clamp(batter.contact + g, 0, 130);
        ev.triggers.push("edition:prospect");
      }
      // prospect pipeline coach (rookie hit)
      if (batter.tags.indexOf("rookie") >= 0) eachCoach(run, "prospectPipeline", (c) => { c.state.bonus += 0.2; ev.triggers.push("coach:prospect_pipeline"); });
      // veteran presence coach (veteran hit)
      if (batter.tags.indexOf("veteran") >= 0) eachCoach(run, "veteranPresence", (c) => { c.state.bonus += 0.1; ev.triggers.push("coach:veteran_presence"); });
    }
    // hot streak / gold glove on home run
    if (finalOutcome === "HR") {
      eachCoach(run, "hotStreak", (c) => { c.state.homerThisGame = true; });
      eachCoach(run, "goldGloveAgent", () => { ev.payrollGained += 1; ev.triggers.push("coach:gold_glove_agent"); });
    }

    // per-batter hot/cold streak (hits heat up, outs cool down; walks are neutral)
    if (isHit) batter._streak = (batter._streak >= 0 ? (batter._streak || 0) + 1 : 1);
    else if (!isSafe) batter._streak = (batter._streak <= 0 ? (batter._streak || 0) - 1 : -1);
    if (batter.trait === "ice" && batter._streak < 0) batter._streak = 0; // Ice Veins
    ev.streakAfter = batter._streak;
    ev.wasHot = es.hot; ev.wasCold = es.cold;

    /* ---------- apply outs / runs / book-keeping ---------- */
    game.bases = newBases;
    game.outsRemaining -= outsAdded;
    game.outsThisInning += outsAdded;
    game.runsScored += runsOnPlay;
    game.inningPA += 1;
    game.lastWasSlugger = batter.tags.indexOf("slugger") >= 0;
    run.payroll += ev.payrollGained;

    // assemble event
    ev.outcome = finalOutcome;
    ev.runsOnPlay = runsOnPlay;
    ev.bagValue = bag;
    ev.rallyUsed = rallyUsed;
    ev.scoreGained = scoreGained;
    ev.rallyAfter = game.rally;
    ev.rallyDelta = rallyDelta;
    ev.outsAdded = outsAdded;
    ev.newBases = newBases;
    ev.isHit = isHit;
    ev.isSafe = isSafe;
    ev.productiveOut = productiveOut;
    ev.rispBefore = rispBefore;
    return ev;
  }

  /* ---------- end-of-inning bookkeeping ---------- */
  function maybeAdvanceInning(game) {
    if (game.outsThisInning >= 3 && game.outsRemaining > 0) {
      game.inning += 1;
      game.outsThisInning = 0;
      game.inningPA = 0;
      game.inningLeadReached = false;
      // clear bases between innings
      game.bases = [null, null, null];
      return true;
    }
    return false;
  }

  global.Engine = {
    resolveAtBat,
    runSteals,
    attemptSteal,
    maybeAdvanceInning,
    effectiveBatterStats,
    platoonState,
    buildDistribution,
    tagCount,
    hasCoach,
  };
})(window);
