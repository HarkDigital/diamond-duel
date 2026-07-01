/* ============================================================
   Diamond Duel - At-bat engine
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

    // at-bat approach reshapes the swing profile (Contact Swing / Power / Work the Count)
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

  /* ---------- steals ---------- */
  // ACTIVE steal - the player chooses to Send a runner. Real risk: caught = an out.
  // fromBase 2 is a straight steal of HOME: long odds, but it scores a literal run.
  function attemptSteal(game, run, rng, fromBase) {
    const b = game.bases;
    const runner = b[fromBase];
    if (!runner || fromBase > 2 || (fromBase < 2 && b[fromBase + 1] != null)) return { ok: false };
    const burner = runner.card && runner.card.trait === "burner";
    const home = fromBase === 2;
    const p = home
      ? clamp(stealChance(runner.speed, run) - 0.42 + (burner ? 0.18 : 0), 0.05, 0.55)
      : clamp(stealChance(runner.speed, run) + (burner ? 0.22 : 0), 0.35, 0.97);
    const res = { ok: true, runner, from: fromBase, rallyBonus: 0, triggers: [], runs: 0 };
    if (rng.chance(p)) {
      b[fromBase] = null;
      if (home) { res.to = 3; res.runs = 1; game.runsScored += 1; }
      else { b[fromBase + 1] = runner; res.to = fromBase + 1; }
      runner.stoleThisInning = true;
      res.caught = false;
      if (hasCoach(run, "smallBall")) { game.rally += 0.5; res.rallyBonus = 0.5; res.triggers.push("coach:small_ball"); }
      if (run.actionLevels && run.actionLevels.steal > 1) { const sl = (run.actionLevels.steal - 1) * (CONFIG.actionLevelRally || 0.3); game.rally += sl; res.rallyBonus += sl; res.triggers.push("action:steal"); }
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

    // BUNT approach - a sacrifice that overrides the rolled outcome.
    if (approach === "bunt") {
      ev.bunt = true;
      ev.buntSafe = rng.chance(clamp((CONFIG.buntSafeBase || 0.06) + (es.speed - 60) * 0.005, 0.02, 0.45));
    }

    if (ev.bunt && ev.buntSafe) {
      // beaten out for a bunt single - batter safe at first, runners advance one
      const r = runnersAdvance(game.bases, [1, 1, 1], 0, batterRunner);
      newBases = r.newBases; runsOnPlay = r.runs; outsAdded = 0; finalOutcome = "1B";
    } else if (ev.bunt) {
      // sacrifice - batter out, the lead runner advances one (no double play)
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
    // Cascade log: every scoring contribution, in order, with the RUNNING totals.
    // Pure data for the app's sequential presentation; no math or RNG happens here.
    ev.steps = [];
    const noteBag = (src, id, d) => { if (d) ev.steps.push({ t: "bag", src, id: id || null, d, bag }); };
    const noteRally = (src, id, d, rally) => { if (d) ev.steps.push({ t: "rally", src, id: id || null, d, rally }); };
    if (finalOutcome === "BB" || finalOutcome === "HBP") bag = C.bag.BB;
    else if (HITS[finalOutcome]) bag = C.bag[finalOutcome];
    noteBag("base", null, bag);
    bag += runsOnPlay; // +1 per run
    noteBag("runs", null, runsOnPlay);

    // sabermetrician: walks count as singles
    if ((finalOutcome === "BB" || finalOutcome === "HBP") && hasCoach(run, "sabermetrician")) {
      const wasBag = bag;
      bag = C.bag["1B"] + runsOnPlay;
      noteBag("coach", "sabermetrician", bag - wasBag);
      ev.triggers.push("coach:sabermetrician");
    }

    // passive bag bonuses (only on offense-producing outcomes)
    if (bag > 0) {
      eachCoach(run, "launchAngle", () => { if (finalOutcome === "HR") { bag += 2; noteBag("coach", "launch_angle", 2); ev.triggers.push("coach:launch_angle"); } });
      eachCoach(run, "contactInstructor", () => { if (finalOutcome === "1B") { bag += 1; noteBag("coach", "contact_instructor", 1); ev.triggers.push("coach:contact_instructor"); } });
      eachCoach(run, "gapCoach", () => { if (finalOutcome === "2B" || finalOutcome === "3B") { bag += 2; noteBag("coach", "gap_coach", 2); ev.triggers.push("coach:gap_coach"); } });
      eachCoach(run, "bashBrothers", () => { if (isHit && tagCount(run, "slugger") >= 4) { bag += 1; noteBag("coach", "bash_brothers", 1); ev.triggers.push("coach:bash_brothers"); } });
      eachCoach(run, "rispSpecialist", () => { if (rispBefore && runsOnPlay > 0) { bag += runsOnPlay; noteBag("coach", "risp_specialist", runsOnPlay); ev.triggers.push("coach:risp_specialist"); } });
      // analytics
      if (run.analytics) {
        if (finalOutcome === "HR" && run.analytics.power) { bag += run.analytics.power * 1; noteBag("analytics", "power", run.analytics.power * 1); }
        if (finalOutcome === "2B" && run.analytics.power) { bag += run.analytics.power * 0.5; noteBag("analytics", "power", run.analytics.power * 0.5); }
        if (finalOutcome === "1B" && run.analytics.contact) { bag += run.analytics.contact * 0.5; noteBag("analytics", "contact", run.analytics.contact * 0.5); }
      }
      // Ace Killer trait: +1 bag vs boss pitchers
      if (batter.trait === "acekiller" && pitcher.isBoss) { bag += 1; noteBag("trait", "acekiller", 1); }
      // deluxe edition: extra Bag value (All-Star / Hall of Fame / Legendary)
      if (batter.deluxe && C.editionFx[batter.deluxe] && C.editionFx[batter.deluxe].bag) { bag += C.editionFx[batter.deluxe].bag; noteBag("edition", batter.deluxe, C.editionFx[batter.deluxe].bag); ev.triggers.push("deluxe:" + batter.deluxe); }
      // generic coaches: data-driven Bag bonuses (`gen.at === "bag"`)
      for (let _gi = 0; _gi < run.dugout.length; _gi++) {
        const _c = run.dugout[_gi], gg = _c.gen;
        if (!gg || gg.at !== "bag") continue;
        let ok = false;
        if (gg.out) ok = gg.out === "hit" ? isHit : gg.out === "xbh" ? (finalOutcome === "2B" || finalOutcome === "3B" || finalOutcome === "HR") : gg.out === "walk" ? (finalOutcome === "BB" || finalOutcome === "HBP") : finalOutcome === gg.out;
        else if (gg.tag) ok = isHit && batter.tags.indexOf(gg.tag) >= 0;
        else if (gg.deck) ok = isHit && tagCount(run, gg.deck) >= (gg.min || 1);
        if (ok) { bag += gg.amt; noteBag("coach", _c.id, gg.amt); ev.triggers.push("coach:" + _c.id); }
      }
    }

    /* ---------- event rally bonus (applies to scoring THIS event only) ---------- */
    let eventRallyBonus = 0;
    if (isSafe) {
      noteRally("base", null, game.rally, game.rally);
      eachCoach(run, "twoOutMagic", () => { if (outsThisInning === 2) { eventRallyBonus += 1.0; noteRally("coach", "two_out_magic", 1.0, game.rally + eventRallyBonus); ev.triggers.push("coach:two_out_magic"); } });
      eachCoach(run, "prospectPipeline", (c) => { if (c.state.bonus) { eventRallyBonus += c.state.bonus; noteRally("coach", c.id, c.state.bonus, game.rally + eventRallyBonus); } });
      eachCoach(run, "hotStreak", (c) => { if (c.state.bonus) { eventRallyBonus += c.state.bonus; noteRally("coach", c.id, c.state.bonus, game.rally + eventRallyBonus); } });
      eachCoach(run, "veteranPresence", (c) => { if (c.state.bonus) { eventRallyBonus += c.state.bonus; noteRally("coach", c.id, c.state.bonus, game.rally + eventRallyBonus); } });
      eachCoach(run, "rallyCap", () => { if ((consecBefore + 1) % 3 === 0) { eventRallyBonus += 1.5; noteRally("coach", "rally_cap", 1.5, game.rally + eventRallyBonus); ev.triggers.push("coach:rally_cap"); } });
      if (batter.edition === "clutch" && rispBefore) { eventRallyBonus += C.edition.clutchRallyBonus; noteRally("edition", "clutch", C.edition.clutchRallyBonus, game.rally + eventRallyBonus); ev.triggers.push("edition:clutch"); }
      if (batter.edition === "veteran") { eventRallyBonus += C.edition.veteranRallyBonus; noteRally("edition", "veteran", C.edition.veteranRallyBonus, game.rally + eventRallyBonus); }
      // signature traits
      if (batter.trait === "clutch" && (outsThisInning === 2 || rispBefore)) { eventRallyBonus += 1.0; noteRally("trait", "clutch", 1.0, game.rally + eventRallyBonus); ev.triggers.push("trait:clutch"); }
      if (batter.trait === "acekiller" && pitcher.isBoss) { eventRallyBonus += 1.0; noteRally("trait", "acekiller", 1.0, game.rally + eventRallyBonus); ev.triggers.push("trait:acekiller"); }
      // deluxe edition: extra Rally (Silver Slugger / Hall of Fame / Legendary)
      if (batter.deluxe && C.editionFx[batter.deluxe] && C.editionFx[batter.deluxe].rally) { eventRallyBonus += C.editionFx[batter.deluxe].rally; noteRally("edition", batter.deluxe, C.editionFx[batter.deluxe].rally, game.rally + eventRallyBonus); }
      // generic coaches: data-driven event Rally bonuses (`gen.at === "rally"`)
      for (let _gi = 0; _gi < run.dugout.length; _gi++) {
        const _c = run.dugout[_gi], gg = _c.gen;
        if (!gg || gg.at !== "rally") continue;
        let ok;
        if (gg.out) ok = gg.out === "hit" ? isHit : gg.out === "xbh" ? (finalOutcome === "2B" || finalOutcome === "3B" || finalOutcome === "HR") : gg.out === "walk" ? (finalOutcome === "BB" || finalOutcome === "HBP") : gg.out === "safe" ? true : finalOutcome === gg.out;
        else if (gg.tag) ok = batter.tags.indexOf(gg.tag) >= 0;
        else if (gg.cond) ok = gg.cond === "risp" ? rispBefore : gg.cond === "twoout" ? outsThisInning === 2 : gg.cond === "leadoff" ? (game.inningPA === 0) : gg.cond === "firston" ? runnerOnFirst : false;
        else ok = true; // flat aura
        if (ok) { eventRallyBonus += gg.amt; noteRally("coach", _c.id, gg.amt, game.rally + eventRallyBonus); ev.triggers.push("coach:" + _c.id); }
      }
    }

    // Scale the finished bag (base + every coach/edition bonus) so on-screen numbers are
    // grand. Applied last, so all relative contributions are preserved; targets scale to match.
    bag = Math.round(bag * (C.scoreScale || 1));

    /* ---------- score the event ---------- */
    let rallyUsed = game.rally + eventRallyBonus;
    // Gold Glove edition: this scoring play is worth a Rally multiple
    if (isSafe && batter.deluxe && C.editionFx[batter.deluxe] && C.editionFx[batter.deluxe].mult) {
      rallyUsed *= C.editionFx[batter.deluxe].mult;
      ev.steps.push({ t: "mult", src: "edition", id: batter.deluxe, d: C.editionFx[batter.deluxe].mult, rally: rallyUsed });
    }
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
      // Coaching Clinic seed + deluxe coaches: each coach aura adds a flat Rally per scoring play
      for (let _ci = 0; _ci < run.dugout.length; _ci++) { const _co = run.dugout[_ci]; if (_co && _co.aura) { bonus += _co.aura; ev.triggers.push("charm:mentor"); } }
      // action leveling (Spring Training): the chosen approach scores hotter per level
      if (run.actionLevels && run.actionLevels[approach] > 1) { bonus += (run.actionLevels[approach] - 1) * (C.actionLevelRally || 0.3); ev.triggers.push("action:" + approach); }

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
        rallyDelta = 0; // rally persists across outs - only the inning's end resets it
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
    // generic coaches: data-driven economy (`gen.at === "econ"`), any matching outcome
    for (let _gi = 0; _gi < run.dugout.length; _gi++) {
      const _c = run.dugout[_gi], gg = _c.gen;
      if (!gg || gg.at !== "econ") continue;
      const ok = !gg.out ? true
        : gg.out === "hit" ? isHit
        : gg.out === "xbh" ? (finalOutcome === "2B" || finalOutcome === "3B" || finalOutcome === "HR")
        : gg.out === "walk" ? (finalOutcome === "BB" || finalOutcome === "HBP")
        : finalOutcome === gg.out;
      if (ok) { ev.payrollGained += gg.amt; ev.triggers.push("coach:" + _c.id); }
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
    attemptSteal,
    maybeAdvanceInning,
    effectiveBatterStats,
    platoonState,
    buildDistribution,
    tagCount,
    hasCoach,
  };
})(window);
