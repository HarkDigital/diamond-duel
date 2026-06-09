/* ============================================================
   Diamond Duel - Config + Content
   All tuning lives in CONFIG so balancing is a data edit.
   All randomness elsewhere is seeded; this file is static data.
   ============================================================ */
(function (global) {
  "use strict";

  /* -------------------------------------------------------- */
  /* CONFIG - every tuning lever in one place                 */
  /* -------------------------------------------------------- */
  const CONFIG = {
    // Resources per game
    // A run = one 9-inning game. Each inning is a "round" with its own target and
    // a budget of 3 outs (every out is precious). Reach the inning's target -> advance.
    outsPerGame: 3,        // outs per INNING (var name kept for minimal churn)
    handSize: 6,
    startingRally: 1.0,

    // Rally - builds across the whole inning (snowball) and resets at the inning's end,
    // NOT on every out. Your 3 outs are the limited resource; the rally is your multiplier.
    rallyResetsOnOut: false,
    rallyIncrement: 0.5, // per safe outcome
    walkRallyIncrement: 0.5, // overridden by Patience Guru
    rallyResetValue: 1.0,

    // Base outcome weights. Higher reach-base (vs a real league) keeps innings from
    // busting on a fluke with only 3 outs; a contact/patience build tames it further.
    baseWeights: {
      K: 8,
      BB: 11,
      HBP: 1,
      OUT: 18,
      "1B": 19,
      "2B": 6.5,
      "3B": 0.8,
      HR: 7.5,
    },

    // Stat coefficients. Stats are 0..100; we normalize to (stat-50)/50 in [-1,1].
    coeff: {
      contact: { K: -15, OUT: -9, "1B": 13, "2B": 2 },
      power: { OUT: -7, "1B": -5, "2B": 5.5, "3B": 0.6, HR: 9 },
      eye: { BB: 9, K: -6, HBP: 0.6 },
      // pitcher
      stuff: { K: 13, OUT: 6, "1B": -7, "2B": -3.2, "3B": -0.3, HR: -5.5 },
      command: { BB: -8, HBP: -1.1 },
    },

    // Platoon multipliers applied to hit weights (1B,2B,3B,HR)
    platoonAdvantage: 1.12,
    platoonDisadvantage: 0.9,

    // Sub-roll tuning
    dpBaseChance: 0.5, // ground out w/ runner on first, before speed
    sacFlyBaseChance: 0.6, // fly out, runner on 3rd, < 2 outs
    extraBaseBase: 0.18, // base chance to take extra base; scaled by speed
    stealEnabled: true,
    stealSpeedFloor: 62, // only runners this fast even try
    productiveOutChance: 0.35, // ground out advancing a trailing runner

    // Bag values
    bag: { BB: 1, HBP: 1, "1B": 2, "2B": 3, "3B": 4, HR: 5 },

    // Target curve. Each frame's target = round(base * inningGrowth^inning * frameMult[frame]),
    // where inning is 0-based and frame is 0(Top)/1(Middle)/2(Boss). This ramps the 24 frames of
    // the main run and keeps escalating forever into Extra Innings. Early frames are clearable
    // with the starting deck; later frames demand a real build.
    target: { base: 7, inningGrowth: 1.46, frameMult: [1, 1.35, 1.8] },

    // Pitcher scaling. Stuff/Command grow per inning, with a small bump per frame inside an
    // inning (Top < Middle < Boss) and a flat boss bonus on top.
    pitcher: {
      baseStuff: 32,
      baseCommand: 36,
      stuffPerInning: 3.1,
      commandPerInning: 2.7,
      framePenalty: 2.0,
      bossStuffBonus: 6,
      bossCommandBonus: 5,
    },

    // Ace boss target multiplier
    aceTargetMult: 1.25,

    // Hot/cold streaks - consecutive hits/outs shift a player's effective hitting stats.
    streak: { hotAt: 2, coldAt: 2, perLevel: 7, maxLevel: 3 },

    // Active baserunning
    stealCaughtBase: 0.18, // base caught-stealing risk when you Send a runner (reduced by Speed/Burner)
    buntSafeBase: 0.06,    // base chance a bunt is beaten out for a single (raised by Speed)

    // At-bat APPROACHES - the per-plate-appearance decision. Each scales outcome weights.
    approaches: {
      swing:  { id: "swing",  name: "Swing Away",     icon: "bat", desc: "Balanced - your natural swing.", w: {} },
      power:  { id: "power",  name: "Power Swing",    icon: "muscle", desc: "Sell out for the big fly. More HR & extra-base hits, but more strikeouts.",
        w: { HR: 1.65, "2B": 1.45, "3B": 1.4, "1B": 0.7, BB: 0.55, K: 1.3, OUT: 1.0 } },
      contact:{ id: "contact",name: "Work the Count", icon: "eye", desc: "Patient & protective. Many more walks, far fewer strikeouts - but little power.",
        w: { BB: 2.1, HBP: 1.3, K: 0.5, "1B": 1.2, "2B": 0.7, "3B": 0.6, HR: 0.5, OUT: 0.95 } },
    },

    // Economy
    economy: {
      winRewardBase: 4,
      winRewardPerRound: 1,
      bossBonus: 2,
      perLeftoverOut: 1,
      interestRate: 0.2, // 20% of banked payroll...
      interestPer: 5, // ...granted as $1 per $5 banked
      interestCap: 5, // up to $5 interest
      startingPayroll: 4,
      rerollBase: 2,
      rerollStep: 1, // +$1 each reroll within a visit
      sellRefundCard: 1,
    },

    // Shop offerings per visit
    shop: {
      coachSlots: 2,
      cardSlots: 3,
      consumableSlots: 2,
      packSlots: 2,
    },

    // Dugout
    dugoutSlots: 8,
    // Salami Cards (consumable powerups, Balatro-Arcana style)
    charmSlots: 4,
    // Roster: each franchise's deck is padded to this many cards
    startingDeckSize: 30,

    // Card-treatment effects (applied by Scouting reports)
    edition: {
      goldPayroll: 2,
      clutchRallyBonus: 1.0,
      prospectStatGain: 3,
      veteranRallyBonus: 0.2,
      foilStatBump: 6,
    },

    // Deluxe editions (Balatro-style, on the `deluxe` field of a card/coach). A scoring
    // play by a deluxe card adds bag / rally / a rally multiplier. On a coach they instead
    // grant a flat Rally aura (DELUXE_COACH_AURA in app), and Legendary takes no dugout slot.
    editionFx: {
      allstar:   { bag: 2 },
      slugger:   { rally: 1.0 },
      goldglove: { mult: 1.5 },
      hof:       { bag: 2, rally: 0.5 },
      legendary: { bag: 3, rally: 1.0 },
    },
    editionSpawnChance: 0.15,   // chance a pack card/coach rolls a deluxe edition

    // Action leveling (Balatro Celestial-style). Each level above 1 adds this much Rally
    // to a safe play made with that action (Swing Away / Power Swing / Work the Count / Bunt / Steal).
    actionLevelRally: 0.3,
  };

  /* -------------------------------------------------------- */
  /* PLAYERS - fictional roster (avoids licensing).           */
  /* P(id,name,bats,contact,power,eye,speed,tags,rarity,cost) */
  /* -------------------------------------------------------- */
  function P(id, name, bats, c, p, e, s, tags, rarity, cost, nick) {
    return { id, name, nick: nick || null, bats, contact: c, power: p, eye: e, speed: s, tags: tags.slice(), rarity, cost, edition: null };
  }

  const PLAYERS = [
    // --- Speedsters / table-setters ---
    P("rocket_ruiz", "Rocket Ruiz", "S", 64, 28, 58, 95, ["speedster", "table-setter", "switch", "CF"], "star", 5, "Rocket"),
    P("dash_okafor", "Dash Okafor", "L", 58, 24, 62, 92, ["speedster", "table-setter", "lefty", "2B"], "star", 5, "Dash"),
    P("slick_bonner", "Slick Bonner", "R", 55, 20, 60, 88, ["speedster", "table-setter", "SS"], "common", 3, "Slick"),
    P("flash_tomlin", "Flash Tomlin", "L", 52, 18, 54, 90, ["speedster", "rookie", "lefty", "CF"], "common", 3, "Flash"),
    P("turbo_vance", "Turbo Vance", "R", 60, 30, 50, 84, ["speedster", "OF"], "common", 3, "Turbo"),

    // --- Contact specialists ---
    P("ziggy_park", "Ziggy Park", "L", 90, 35, 55, 60, ["contact", "lefty", "2B"], "star", 5, "Ziggy"),
    P("marty_soto", "Marty Soto", "R", 86, 40, 48, 52, ["contact", "veteran", "3B"], "star", 5),
    P("pete_almonte", "Pete Almonte", "S", 82, 30, 60, 58, ["contact", "switch", "SS"], "common", 4, "Pistol Pete"),
    P("gabe_whitfield", "Gabe Whitfield", "R", 84, 44, 44, 50, ["contact", "1B"], "common", 4),
    P("sunny_okada", "Sunny Okada", "L", 88, 28, 58, 66, ["contact", "table-setter", "lefty", "rookie", "2B"], "star", 5, "Sunny"),

    // --- Sluggers ---
    P("mack_thunderton", "Mack Thunderton", "R", 50, 94, 46, 30, ["slugger", "1B"], "allstar", 7, "Mack"),
    P("bruno_vargas", "Bruno Vargas", "R", 46, 90, 40, 36, ["slugger", "veteran", "DH"], "star", 6, "Bruno"),
    P("cy_bigsby", "Cy Bigsby", "L", 48, 88, 52, 28, ["slugger", "lefty", "OF"], "star", 6),
    P("duke_hammond", "Duke Hammond", "R", 44, 92, 38, 24, ["slugger", "1B"], "star", 6, "Duke"),
    P("rex_stoneman", "Rex Stoneman", "L", 52, 86, 44, 40, ["slugger", "lefty", "3B"], "star", 6, "Rex"),
    P("tank_mercer", "Tank Mercer", "R", 40, 96, 34, 20, ["slugger", "rookie", "DH"], "star", 6, "Tank"),

    // --- Eye / Moneyball ---
    P("walt_pemberton", "Walt Pemberton", "L", 70, 50, 92, 48, ["contact", "veteran", "lefty", "RF"], "star", 6, "The Professor"),
    P("sherman_boyle", "Sherman Boyle", "R", 66, 58, 88, 42, ["slugger", "1B"], "star", 5),
    P("ozzie_klein", "Ozzie Klein", "S", 72, 44, 90, 56, ["contact", "switch", "table-setter", "2B"], "star", 6, "Ozzie"),
    P("desmond_pratt", "Desmond Pratt", "L", 64, 62, 84, 44, ["slugger", "lefty", "DH"], "common", 4),

    // --- Balanced / utility ---
    P("hank_delgado", "Hank Delgado", "R", 70, 66, 60, 58, ["utility", "veteran", "3B"], "star", 5, "Hank"),
    P("joey_marsh", "Joey Marsh", "L", 68, 60, 58, 64, ["utility", "lefty", "OF"], "common", 4),
    P("vic_castellano", "Vic Castellano", "R", 72, 64, 54, 50, ["utility", "C"], "common", 4, "Vic"),
    P("nico_reyburn", "Nico Reyburn", "S", 66, 58, 62, 62, ["utility", "switch", "SS"], "common", 4),
    P("chip_donnelly", "Chip Donnelly", "R", 60, 52, 56, 60, ["utility", "rookie", "2B"], "common", 3, "Chip"),

    // --- Catchers / corner bats ---
    P("buster_kray", "Buster Kray", "R", 74, 70, 62, 34, ["contact", "veteran", "C"], "star", 5, "Buster"),
    P("milo_fenn", "Milo Fenn", "L", 62, 74, 50, 38, ["slugger", "lefty", "C"], "common", 4),

    // --- Commons / filler ---
    P("eddie_lux", "Eddie Lux", "R", 58, 48, 50, 54, ["utility", "OF"], "common", 3),
    P("rusty_blanco", "Rusty Blanco", "L", 56, 54, 46, 48, ["utility", "lefty", "1B"], "common", 3),
    P("gil_hatcher", "Gil Hatcher", "R", 54, 44, 52, 58, ["contact", "OF"], "common", 3),
    P("benny_alvarez", "Benny Alvarez", "S", 60, 40, 54, 70, ["speedster", "switch", "2B"], "common", 3, "Benny"),

    // --- Legends (rare, high totals, unique flavor) ---
    P("el_toro_mendez", "El Toro Mendez", "R", 58, 99, 60, 40, ["slugger", "legend", "veteran", "DH"], "legend", 9, "El Toro"),
    P("lionel_frye", "Lionel Frye", "L", 86, 64, 99, 52, ["contact", "legend", "veteran", "lefty", "RF"], "legend", 9, "The Eye"),
    P("jackrabbit_jones", "Jackrabbit Jones", "S", 80, 40, 70, 99, ["speedster", "legend", "switch", "CF"], "legend", 9, "Jackrabbit"),
    P("otis_lane", "Otis Lane", "L", 99, 56, 72, 64, ["contact", "legend", "lefty", "2B"], "legend", 9, "Smooth"),
    P("cannon_dupree", "Cannon Dupree", "R", 66, 95, 78, 30, ["slugger", "legend", "1B"], "legend", 10, "Cannon"),

    /* --- Wave 2: a deeper free-agent pool --- */
    // Speedsters / table-setters
    P("zip_calloway", "Zip Calloway", "L", 62, 26, 56, 91, ["speedster", "table-setter", "lefty", "CF"], "star", 5, "Zip"),
    P("comet_reyes", "Comet Reyes", "S", 58, 30, 52, 93, ["speedster", "switch", "SS"], "common", 3, "Comet"),
    P("breeze_holloway", "Breeze Holloway", "R", 60, 22, 58, 86, ["speedster", "OF"], "common", 3, "Breeze"),
    P("scooter_pace", "Scooter Pace", "S", 60, 38, 56, 72, ["speedster", "switch", "rookie", "2B"], "common", 3, "Scooter"),
    // Contact
    P("dink_harper", "Dink Harper", "L", 89, 30, 62, 58, ["contact", "table-setter", "lefty", "2B"], "star", 5, "Dink"),
    P("spray_okafor", "Marcus Okafor", "S", 85, 34, 54, 64, ["contact", "switch", "CF"], "common", 4, "Spray"),
    P("punch_lavoie", "Pierre Lavoie", "R", 87, 38, 50, 48, ["contact", "veteran", "1B"], "star", 5, "Punch"),
    // Sluggers
    P("boom_castillo", "Boom Castillo", "R", 48, 93, 44, 28, ["slugger", "1B"], "star", 6, "Boom"),
    P("moose_kowalski", "Moose Kowalski", "R", 44, 95, 40, 22, ["slugger", "veteran", "DH"], "allstar", 7, "Moose"),
    P("blast_jennings", "Blast Jennings", "L", 50, 89, 52, 34, ["slugger", "lefty", "RF"], "star", 6, "Blast"),
    P("crusher_voss", "Crusher Voss", "R", 42, 91, 38, 26, ["slugger", "rookie", "3B"], "star", 6, "Crusher"),
    // Eye / Moneyball
    P("elias_pike", "Elias Pike", "L", 68, 52, 90, 46, ["contact", "lefty", "RF"], "star", 6, "The Vault"),
    P("roy_mcgill", "Roy McGill", "R", 64, 60, 86, 40, ["slugger", "1B"], "star", 5),
    P("andre_delacroix", "Andre Delacroix", "S", 70, 48, 88, 54, ["contact", "switch", "2B"], "star", 6, "The Count"),
    // Balanced / utility
    P("dusty_quintero", "Dusty Quintero", "R", 68, 64, 58, 56, ["utility", "veteran", "SS"], "star", 5, "Dusty"),
    P("ace_brannigan", "Ace Brannigan", "L", 66, 62, 60, 60, ["utility", "lefty", "OF"], "common", 4, "Ace"),
    P("rudy_falk", "Rudy Falk", "S", 64, 56, 64, 58, ["utility", "switch", "3B"], "common", 4),
    // Catchers / corner bats
    P("wally_brennan", "Wally Brennan", "R", 72, 68, 64, 32, ["contact", "veteran", "C"], "star", 5, "Wally"),
    P("gunnar_polk", "Gunnar Polk", "L", 60, 76, 48, 36, ["slugger", "lefty", "C"], "common", 4, "Gunnar"),
    // Commons / filler
    P("pip_sandoval", "Pip Sandoval", "R", 56, 46, 52, 56, ["utility", "OF"], "common", 3, "Pip"),
    P("cole_morrow", "Cole Morrow", "L", 58, 52, 48, 50, ["utility", "lefty", "1B"], "common", 3),
    P("doc_ellwood", "Doc Ellwood", "R", 54, 48, 54, 54, ["contact", "OF"], "common", 3, "Doc"),
    // Legends
    P("sully_byrne", "Sully Byrne", "L", 92, 80, 70, 60, ["slugger", "legend", "lefty", "RF"], "legend", 11, "The Natural"),
    P("kid_zamora", "Kid Zamora", "S", 84, 62, 80, 88, ["speedster", "legend", "switch", "CF"], "legend", 10, "Kid"),
  ];

  /* -------------------------------------------------------- */
  /* TRAITS - signature player abilities (read by the engine)  */
  /* -------------------------------------------------------- */
  const TRAITS = {
    launch:      { id: "launch",      name: "Launch",      icon: "launch",    desc: "Power Swing never adds strikeouts for this hitter - sell out risk-free." },
    eagle:       { id: "eagle",       name: "Eagle Eye",   icon: "eagle",     desc: "Work the Count draws even more walks and never strikes out." },
    burner:      { id: "burner",      name: "Burner",      icon: "burner",    desc: "Steals almost always succeed and takes the extra base far more often." },
    clutch:      { id: "clutch",      name: "Clutch",      icon: "clutch",    desc: "With 2 outs or a runner in scoring position, this at-bat scores at +1.0 Rally." },
    mistake:     { id: "mistake",     name: "Mistake Hitter", icon: "mistake", desc: "Big hit bonus against pitchers with weak Command." },
    acekiller:   { id: "acekiller",   name: "Ace Killer",  icon: "acekiller", desc: "+1.0 Rally and +1 Bag value against Boss pitchers." },
    sparkplug:   { id: "sparkplug",   name: "Sparkplug",   icon: "sparkplug", desc: "If this hitter leads off an inning and reaches base, +0.5 Rally for the rest of the inning." },
    streaky:     { id: "streaky",     name: "Streaky",     icon: "streaky",   desc: "Hot and cold streaks hit twice as hard." },
    ice:         { id: "ice",         name: "Ice Veins",   icon: "ice",       desc: "Never goes cold - immune to slumps." },
  };
  // assign signature traits to key players (others have none)
  const TRAIT_ASSIGN = {
    el_toro_mendez: "launch", mack_thunderton: "launch", tank_mercer: "launch", duke_hammond: "launch",
    lionel_frye: "eagle", walt_pemberton: "eagle", sherman_boyle: "eagle",
    jackrabbit_jones: "burner", rocket_ruiz: "burner", dash_okafor: "burner",
    otis_lane: "clutch", buster_kray: "clutch", cy_bigsby: "clutch",
    cannon_dupree: "mistake", bruno_vargas: "mistake",
    hank_delgado: "acekiller", marty_soto: "ice", desmond_pratt: "streaky",
    ozzie_klein: "sparkplug", sunny_okada: "sparkplug", rex_stoneman: "streaky",
    // wave 2
    boom_castillo: "launch", crusher_voss: "launch", moose_kowalski: "acekiller",
    elias_pike: "eagle", roy_mcgill: "eagle", andre_delacroix: "eagle",
    zip_calloway: "burner", comet_reyes: "burner", kid_zamora: "burner",
    wally_brennan: "clutch", gunnar_polk: "clutch",
    sully_byrne: "mistake", blast_jennings: "streaky", ace_brannigan: "streaky",
    dusty_quintero: "ice", punch_lavoie: "ice",
    scooter_pace: "sparkplug", dink_harper: "sparkplug",
  };
  PLAYERS.forEach((p) => { p.trait = TRAIT_ASSIGN[p.id] || null; });

  function getPlayer(id) {
    return PLAYERS.find((p) => p.id === id);
  }
  function getTrait(id) { return id ? TRAITS[id] : null; }

  /* -------------------------------------------------------- */
  /* COACHES (the jokers). fx id is read by the engine.       */
  /* -------------------------------------------------------- */
  const COACHES = [
    // Flat boosters
    { id: "launch_angle", name: "Launch Angle Coordinator", fx: "launchAngle", icon: "rocket", trigger: "passive", rarity: "common", cost: 4, text: "All home runs gain +2 Bag value." },
    { id: "contact_instructor", name: "Contact Hitting Instructor", fx: "contactInstructor", icon: "target", trigger: "passive", rarity: "common", cost: 4, text: "All singles gain +1 Bag value." },
    { id: "gap_coach", name: "Gap-to-Gap Coach", fx: "gapCoach", icon: "moveX", trigger: "passive", rarity: "common", cost: 4, text: "All doubles & triples gain +2 Bag value." },
    { id: "patience_guru", name: "Patience Guru", fx: "patienceGuru", icon: "hourglass", trigger: "passive", rarity: "common", cost: 4, text: "Walks & HBP grant +1.0 Rally (instead of +0.5)." },

    // Sequence / situational
    { id: "hit_and_run", name: "Hit-and-Run", fx: "hitAndRun", icon: "footprints", trigger: "situational", rarity: "common", cost: 5, text: "Playing a Contact card with a runner on first grants +0.5 Rally." },
    { id: "table_setter", name: "Table-Setter", fx: "tableSetter", icon: "layers", trigger: "situational", rarity: "star", cost: 6, text: "If the first batter of an inning reaches base, +0.5 Rally on every safe play for the rest of that inning." },
    { id: "two_out_magic", name: "Two-Out Magic", fx: "twoOutMagic", icon: "sparkle", trigger: "situational", rarity: "star", cost: 6, text: "Events recorded with two outs score at +1.0 Rally." },
    { id: "risp_specialist", name: "RISP Specialist", fx: "rispSpecialist", icon: "home", trigger: "situational", rarity: "star", cost: 6, text: "With a runner in scoring position, +1 Bag value per run driven in." },
    { id: "back_to_back", name: "Back-to-Back", fx: "backToBack", icon: "repeat", trigger: "situational", rarity: "star", cost: 6, text: "Playing two Slugger cards in a row grants +1.0 Rally on the second." },
    { id: "small_ball", name: "Small Ball", fx: "smallBall", icon: "gauge", trigger: "situational", rarity: "star", cost: 6, text: "Productive outs and stolen bases grant +0.5 Rally (and a productive out won't reset your Rally)." },
    { id: "rally_cap", name: "Rally Caps", fx: "rallyCap", icon: "cap", trigger: "situational", rarity: "star", cost: 6, text: "Every 3rd consecutive safe outcome scores with an extra +1.5 Rally." },

    // Roster-composition (tag readers)
    { id: "bash_brothers", name: "Bash Brothers", fx: "bashBrothers", icon: "muscle", trigger: "passive", rarity: "star", cost: 6, text: "While 4+ Sluggers are in your deck, all hits gain +1 Bag value." },
    { id: "whitey_ball", name: "Whitey Ball", fx: "whiteyBall", icon: "wind", trigger: "passive", rarity: "star", cost: 6, text: "While 3+ Speedsters are in your deck, all runners gain +18 Speed." },
    { id: "platoon_manager", name: "Platoon Manager", fx: "platoonManager", icon: "shuffle", trigger: "passive", rarity: "common", cost: 5, text: "Your platoon advantage bonus is doubled." },
    { id: "sabermetrician", name: "Sabermetrician", fx: "sabermetrician", icon: "barChart", trigger: "passive", rarity: "star", cost: 6, text: "Walks count as singles for Bag value (Bag 2)." },

    // Scaling
    { id: "prospect_pipeline", name: "Prospect Pipeline", fx: "prospectPipeline", icon: "sprout", trigger: "scaling", rarity: "star", cost: 6, text: "Gains +0.2 Rally (applied to every event) each time a Rookie records a hit.", state: { bonus: 0 } },
    { id: "hot_streak", name: "Hot Streak", fx: "hotStreak", icon: "flame", trigger: "scaling", rarity: "star", cost: 6, text: "Gains +0.5 Rally per game in which you hit a home run. Resets after a game with no homer.", state: { bonus: 0, homerThisGame: false } },
    { id: "veteran_presence", name: "Veteran Presence", fx: "veteranPresence", icon: "medal", trigger: "scaling", rarity: "star", cost: 6, text: "Gains +0.1 Rally (applied to every event) each time a Veteran records a hit.", state: { bonus: 0 } },

    // Economy
    { id: "frugal_fo", name: "Frugal Front Office", fx: "frugalFO", icon: "coin", trigger: "economy", rarity: "common", cost: 5, text: "Earn +1 Payroll per leftover out when you win a game." },
    { id: "sign_stealer", name: "Sign Stealer", fx: "signStealer", icon: "eyeOff", trigger: "economy", rarity: "common", cost: 5, text: "Your first shop reroll each visit is free." },
    { id: "gold_glove_agent", name: "Gold Glove Agent", fx: "goldGloveAgent", icon: "shield", trigger: "economy", rarity: "common", cost: 5, text: "Earn +1 Payroll every time you hit a home run." },
  ];

  function getCoach(id) {
    return COACHES.find((c) => c.id === id);
  }

  /* -------------------------------------------------------- */
  /* BOSS PITCHER RULES                                        */
  /* -------------------------------------------------------- */
  const BOSSES = [
    { id: "knuckleballer", name: "The Knuckleballer", rule: "knuckleballer", text: "Your Power is halved this game.", tier: 1 },
    { id: "flamethrower", name: "The Flamethrower", rule: "flamethrower", text: "Strikeouts cost two outs instead of one.", tier: 1 },
    { id: "groundball", name: "The Ground-Ball Specialist", rule: "groundball", text: "Your doubles are downgraded to singles.", tier: 1 },
    { id: "lefty_specialist", name: "The Lefty Specialist", rule: "leftySpecialist", text: "Left-handed batters get no platoon bonus and a penalty.", tier: 1 },
    { id: "junkballer", name: "The Junkballer", rule: "junkballer", text: "The first batter of every inning is debuffed (-22 all stats).", tier: 2 },
    { id: "workhorse", name: "The Workhorse", rule: "workhorse", text: "Your Rally increment is reduced by half.", tier: 2 },
    { id: "closer", name: "The Closer", rule: "closer", text: "You get only 18 outs (six innings). A race.", tier: 2 },
    { id: "ace", name: "The Ace", rule: "ace", text: "Target is increased by 50%. No other rule - a raw check.", tier: 2 },
  ];

  function getBoss(id) {
    return BOSSES.find((b) => b.id === id);
  }

  /* -------------------------------------------------------- */
  /* CONSUMABLES - analytics (planets) + scouting (tarots)    */
  /* -------------------------------------------------------- */
  const ANALYTICS = [
    { id: "an_power", name: "Power Analytics", kind: "analytics", key: "power", rarity: "common", cost: 4, text: "Permanently: home runs +1 Bag, doubles +0.5 Bag (this run)." },
    { id: "an_contact", name: "Contact Analytics", kind: "analytics", key: "contact", rarity: "common", cost: 4, text: "Permanently: singles +0.5 Bag (this run)." },
    { id: "an_patience", name: "Patience Analytics", kind: "analytics", key: "patience", rarity: "common", cost: 4, text: "Permanently: walks grant +0.25 extra Rally (this run)." },
    { id: "an_speed", name: "Speed Analytics", kind: "analytics", key: "speed", rarity: "common", cost: 4, text: "Permanently: +12% steal & extra-base success (this run)." },
    { id: "an_rally", name: "Momentum Analytics", kind: "analytics", key: "rally", rarity: "star", cost: 6, text: "Permanently: every safe outcome grants +0.1 extra Rally (this run)." },
  ];

  const SCOUTING = [
    { id: "sc_gold", name: "Endorsement Deal", kind: "scouting", op: "edition", arg: "gold", rarity: "common", cost: 3, text: "Add the Gold edition to a card (+$ when played)." },
    { id: "sc_clutch", name: "Clutch Gene", kind: "scouting", op: "edition", arg: "clutch", rarity: "common", cost: 3, text: "Add the Clutch edition to a card (+Rally with RISP)." },
    { id: "sc_prospect", name: "Prospect Tag", kind: "scouting", op: "edition", arg: "prospect", rarity: "star", cost: 4, text: "Add the Prospect edition (card grows on every hit)." },
    { id: "sc_foil", name: "Refractor Coat", kind: "scouting", op: "edition", arg: "foil", rarity: "common", cost: 3, text: "Add the Foil edition (+6 to two stats, shiny)." },
    { id: "sc_switch", name: "Switch Lessons", kind: "scouting", op: "switch", rarity: "common", cost: 3, text: "Turn a card into a switch hitter (never platoon-disadvantaged)." },
    { id: "sc_bump_contact", name: "Hitting Clinic", kind: "scouting", op: "bump", arg: "contact", rarity: "common", cost: 3, text: "+12 Contact to a card." },
    { id: "sc_bump_power", name: "Weight Room", kind: "scouting", op: "bump", arg: "power", rarity: "common", cost: 3, text: "+12 Power to a card." },
    { id: "sc_bump_eye", name: "Film Study", kind: "scouting", op: "bump", arg: "eye", rarity: "common", cost: 3, text: "+12 Eye to a card." },
    { id: "sc_bump_speed", name: "Track Work", kind: "scouting", op: "bump", arg: "speed", rarity: "common", cost: 3, text: "+12 Speed to a card." },
    { id: "sc_copy", name: "Clone Project", kind: "scouting", op: "copy", rarity: "star", cost: 5, text: "Create a copy of a card in your deck." },
    { id: "sc_release", name: "Release Player", kind: "scouting", op: "destroy", rarity: "common", cost: 2, text: "Remove a card from your deck and refund a little Payroll (deck thinning)." },
  ];

  /* -------------------------------------------------------- */
  /* CHARMS - consumable powerups (Balatro's Arcana, baseball  */
  /* superstitions). Held in your charm pouch, used any time   */
  /* during a game. target: player | coach | immediate.        */
  /* -------------------------------------------------------- */
  const CHARMS = [
    // --- applied to a player card (permanent, this run) ---
    { id: "ch_pinetar", name: "Pine Tar", icon: "target", kind: "charm", target: "player", op: "bump", arg: "contact", amt: 24, rarity: "common", cost: 4, text: "Rub on +24 Contact for one of your players." },
    { id: "ch_cork", name: "Corked Bat", icon: "muscle", kind: "charm", target: "player", op: "bump", arg: "power", amt: 24, rarity: "common", cost: 4, text: "Sneak +24 Power onto one of your players." },
    { id: "ch_eyeblack", name: "Eye Black", icon: "eye", kind: "charm", target: "player", op: "bump", arg: "eye", amt: 24, rarity: "common", cost: 4, text: "Smear on +24 Eye for one of your players." },
    { id: "ch_spikes", name: "Track Spikes", icon: "wind", kind: "charm", target: "player", op: "bump", arg: "speed", amt: 24, rarity: "common", cost: 4, text: "Lace up +24 Speed for one of your players." },
    { id: "ch_allstar", name: "All-Star Nod", icon: "star", kind: "charm", target: "player", op: "allup", amt: 9, rarity: "star", cost: 6, text: "+9 to all four stats of one of your players." },
    { id: "ch_clutch", name: "Clutch Gene", icon: "sparkle", kind: "charm", target: "player", op: "trait", arg: "clutch", rarity: "star", cost: 6, text: "Give a player the Clutch trait - scores at +1.0 Rally with 2 outs or a runner in scoring position." },
    { id: "ch_burner", name: "Lead-off Legs", icon: "burner", kind: "charm", target: "player", op: "trait", arg: "burner", rarity: "star", cost: 6, text: "Give a player the Burner trait - steals almost always succeed." },
    // --- applied to a coach badge ---
    { id: "ch_copy", name: "Carbon Copy", icon: "copy", kind: "charm", target: "coach", op: "copycoach", rarity: "allstar", cost: 8, text: "Duplicate one of your coaches into an open dugout slot." },
    { id: "ch_mentor", name: "Coaching Clinic", icon: "medal", kind: "charm", target: "coach", op: "aura", amt: 0.3, rarity: "star", cost: 6, text: "Mentor a coach. That coach adds +0.3 Rally to every scoring play for the rest of the run." },
    // --- immediate, affect the current at-bat / inning ---
    { id: "ch_ibb", name: "Intentional Walk", icon: "arrowUpRight", kind: "charm", target: "immediate", op: "freewalk", rarity: "common", cost: 5, text: "Take a free base - put a runner on first (forces runners up) and bump your Rally. No out used." },
    { id: "ch_momentum", name: "Momentum Shift", icon: "zap", kind: "charm", target: "immediate", op: "rally", amt: 1.5, rarity: "star", cost: 6, text: "Swing the game your way: +1.5 Rally right now." },
    { id: "ch_secondwind", name: "Second Wind", icon: "shield", kind: "charm", target: "immediate", op: "extraout", rarity: "star", cost: 7, text: "Catch your breath - gain one extra out this inning." },
  ];

  function getCharm(id) { return CHARMS.find((c) => c.id === id); }

  /* -------------------------------------------------------- */
  /* ACHIEVEMENTS - 49 feats & milestones. `seed:true` ones    */
  /* also gift a Salami Card the moment you pull them off.   */
  /* -------------------------------------------------------- */
  const ACHIEVEMENTS = [
    // --- in-inning feats (also gift a Salami Card) ---
    { id: "grand_slam",     cat: "Power",    name: "Grand Slam",       text: "Hit a home run with the bases loaded.", seed: true },
    { id: "long_ball",      cat: "Power",    name: "Going Yard",       text: "Hit two home runs in one inning.", seed: true },
    { id: "three_hr",       cat: "Power",    name: "Murderers' Row",   text: "Hit three home runs in one inning.", seed: true },
    { id: "the_cycle",      cat: "Contact",  name: "Hit for the Cycle", text: "Single, double, triple and homer in one inning.", seed: true },
    { id: "five_hits",      cat: "Contact",  name: "Hit Parade",       text: "Collect five hits in one inning.", seed: true },
    { id: "patient_eye",    cat: "Patience", name: "Take Your Base",   text: "Draw three walks in one inning.", seed: true },
    { id: "thief",          cat: "Speed",    name: "Highway Robbery",  text: "Steal three bases in one inning.", seed: true },
    { id: "perfect_inning", cat: "Winning",  name: "Perfect Inning",   text: "Clear an inning without making a single out.", seed: true },
    { id: "comeback",       cat: "Winning",  name: "Down to the Wire", text: "Clear an inning on your final out.", seed: true },
    { id: "walkoff",        cat: "Winning",  name: "Walk-Off",         text: "Clear an inning on a home run.", seed: true },
    { id: "big_swing",      cat: "Scoring",  name: "One Big Swing",    text: "Score 15+ from a single at-bat.", seed: true },
    { id: "boss_sweep",     cat: "Bosses",   name: "Giant Killer",     text: "Beat all three bosses in one run.", seed: true },
    // --- power milestones ---
    { id: "first_dinger",   cat: "Power",    name: "First Dinger",     text: "Hit your first home run." },
    { id: "dingers_25",     cat: "Power",    name: "Slugger",          text: "Hit 25 career home runs." },
    { id: "dingers_100",    cat: "Power",    name: "Bash Brother",     text: "Hit 100 career home runs." },
    { id: "dingers_300",    cat: "Power",    name: "Home Run King",    text: "Hit 300 career home runs." },
    // --- contact ---
    { id: "first_hit",      cat: "Contact",  name: "First Knock",      text: "Get your first hit." },
    { id: "hits_100",       cat: "Contact",  name: "Contact Hitter",   text: "Collect 100 career hits." },
    { id: "hits_500",       cat: "Contact",  name: "Pure Hitter",      text: "Collect 500 career hits." },
    { id: "hits_1500",      cat: "Contact",  name: "Hit Machine",      text: "Collect 1,500 career hits." },
    // --- patience ---
    { id: "first_walk",     cat: "Patience", name: "Good Eye",         text: "Draw your first walk." },
    { id: "walks_100",      cat: "Patience", name: "Moneyball",        text: "Draw 100 career walks." },
    { id: "walks_400",      cat: "Patience", name: "On-Base Machine",  text: "Draw 400 career walks." },
    // --- speed ---
    { id: "first_steal",    cat: "Speed",    name: "Stolen Base",      text: "Steal your first base." },
    { id: "steal_home",     cat: "Speed",    name: "Steal of Home",    text: "Steal home plate." },
    { id: "steals_50",      cat: "Speed",    name: "Burglar",          text: "Steal 50 career bases." },
    { id: "steals_200",     cat: "Speed",    name: "Rabbit",           text: "Steal 200 career bases." },
    // --- rally ---
    { id: "rally_3",        cat: "Rally",    name: "Rally Time",       text: "Reach a ×3 Rally." },
    { id: "rally_5",        cat: "Rally",    name: "On Fire",          text: "Reach a ×5 Rally." },
    { id: "rally_10",       cat: "Rally",    name: "Unstoppable",      text: "Reach a ×10 Rally." },
    { id: "rally_20",       cat: "Rally",    name: "Inferno",          text: "Reach a ×20 Rally." },
    // --- scoring ---
    { id: "inning_50",      cat: "Scoring",  name: "Half-Century",     text: "Score 50+ in a single inning." },
    { id: "inning_100",     cat: "Scoring",  name: "Triple Digits",    text: "Score 100+ in a single inning." },
    // --- winning ---
    { id: "first_win",      cat: "Winning",  name: "Play Ball",        text: "Clear your first inning." },
    { id: "first_champ",    cat: "Winning",  name: "Champion",         text: "Win a full nine-inning run." },
    { id: "champ_5",        cat: "Winning",  name: "Dynasty",          text: "Win five full runs." },
    // --- bosses ---
    { id: "first_boss",     cat: "Bosses",   name: "Ace Beater",       text: "Beat a boss inning." },
    { id: "boss_10",        cat: "Bosses",   name: "Boss Hunter",      text: "Beat 10 boss innings." },
    { id: "boss_30",        cat: "Bosses",   name: "Boss Slayer",      text: "Beat 30 boss innings." },
    // --- building ---
    { id: "full_dugout",    cat: "Building",  name: "Brain Trust",     text: "Fill all eight dugout slots with coaches." },
    { id: "got_legend",     cat: "Building",  name: "Sign a Legend",   text: "Add a Legend to your deck." },
    { id: "thin_deck",      cat: "Building",  name: "Lean & Mean",     text: "Trim your deck to 12 cards or fewer." },
    { id: "deep_pockets",   cat: "Building",  name: "Deep Pockets",    text: "Hold $40 at once." },
    // --- sunflower seeds ---
    { id: "first_seed",     cat: "Salami",    name: "First Slice",     text: "Use your first Salami Card." },
    { id: "seeds_20",       cat: "Salami",    name: "Deli Regular",    text: "Use 20 Salami Cards." },
    { id: "free_runner",    cat: "Salami",    name: "Free Pass",       text: "Use an Intentional Walk Salami Card." },
    // --- franchises & meta ---
    { id: "all_franchises", cat: "Franchise", name: "Globetrotter",    text: "Play a run with every franchise." },
    { id: "win_variety",    cat: "Franchise", name: "Versatile",       text: "Win a run with five different franchises." },
    { id: "runs_50",        cat: "Meta",      name: "Grinder",         text: "Play 50 runs." },
  ];
  function getAchievement(id) { return ACHIEVEMENTS.find((a) => a.id === id); }

  /* -------------------------------------------------------- */
  /* FRONT OFFICE UPGRADES (vouchers)                          */
  /* -------------------------------------------------------- */
  const UPGRADES = [
    { id: "up_dugout", name: "Expanded Dugout", fx: "dugoutSlot", icon: "home", rarity: "star", cost: 8, text: "+1 dugout slot (more coaches)." },
    { id: "up_hand", name: "Bigger Lineup Card", fx: "handSize", icon: "layers", rarity: "common", cost: 6, text: "+1 hand size." },
    { id: "up_discount", name: "Analytics Department", fx: "discount", icon: "barChart", rarity: "star", cost: 7, text: "Shop prices reduced by $1 (min $1)." },
    { id: "up_shopslot", name: "Scouting Network", fx: "shopSlot", icon: "eye", rarity: "star", cost: 7, text: "+1 card slot in the shop." },
    { id: "up_reroll", name: "Front Office Interns", fx: "rerollCheap", icon: "shuffle", rarity: "common", cost: 6, text: "Rerolls cost $1 less." },
    { id: "up_startrally", name: "Home Field Advantage", fx: "startRally", icon: "zap", rarity: "allstar", cost: 9, text: "Start every game at x1.5 Rally instead of x1.0." },
    { id: "up_interest", name: "Smart Investments", fx: "interest", icon: "coin", rarity: "star", cost: 7, text: "Interest cap raised to $8." },
  ];

  /* -------------------------------------------------------- */
  /* BOOSTER PACKS                                             */
  /* -------------------------------------------------------- */
  // Packs come in three sizes (Balatro-style): Normal (3, pick 1), Jumbo (5, pick 1),
  // Mega (5, pick 2). One family per card kind: Prospect (players), Scouting (analytics +
  // scouting reports), Salami, Coaching.
  const PACKS = [
    // Prospect (player cards)
    { id: "pk_prospect",       name: "Prospect Pack",       kind: "player",   size: "",      choose: 1, count: 3, rarity: "common",  cost: 4,  text: "Choose 1 of 3 Prospect cards." },
    { id: "pk_prospect_jumbo", name: "Jumbo Prospect Pack", kind: "player",   size: "jumbo", choose: 1, count: 5, rarity: "star",    cost: 6,  text: "Choose 1 of 5 Prospect cards." },
    { id: "pk_prospect_mega",  name: "Mega Prospect Pack",  kind: "player",   size: "mega",  choose: 2, count: 5, rarity: "allstar", cost: 8,  text: "Choose 2 of 5 Prospect cards." },
    // Scouting (analytics + scouting reports)
    { id: "pk_scout",          name: "Scouting Pack",       kind: "scouting", size: "",      choose: 1, count: 3, rarity: "common",  cost: 4,  text: "Choose 1 of 3 Scouting cards." },
    { id: "pk_scout_jumbo",    name: "Jumbo Scouting Pack", kind: "scouting", size: "jumbo", choose: 1, count: 5, rarity: "star",    cost: 6,  text: "Choose 1 of 5 Scouting cards." },
    { id: "pk_scout_mega",     name: "Mega Scouting Pack",  kind: "scouting", size: "mega",  choose: 2, count: 5, rarity: "allstar", cost: 8,  text: "Choose 2 of 5 Scouting cards." },
    // Salami
    { id: "pk_salami",         name: "Salami Pack",         kind: "charm",    size: "",      choose: 1, count: 3, rarity: "star",    cost: 5,  text: "Choose 1 of 3 Salami cards." },
    { id: "pk_salami_jumbo",   name: "Jumbo Salami Pack",   kind: "charm",    size: "jumbo", choose: 1, count: 5, rarity: "star",    cost: 7,  text: "Choose 1 of 5 Salami cards." },
    { id: "pk_salami_mega",    name: "Mega Salami Pack",    kind: "charm",    size: "mega",  choose: 2, count: 5, rarity: "allstar", cost: 9,  text: "Choose 2 of 5 Salami cards." },
    // Coaching
    { id: "pk_coach",          name: "Coaching Pack",       kind: "coach",    size: "",      choose: 1, count: 3, rarity: "star",    cost: 6,  text: "Choose 1 of 3 coaches." },
    { id: "pk_coach_jumbo",    name: "Jumbo Coaching Pack", kind: "coach",    size: "jumbo", choose: 1, count: 5, rarity: "star",    cost: 8,  text: "Choose 1 of 5 coaches." },
    { id: "pk_coach_mega",     name: "Mega Coaching Pack",  kind: "coach",    size: "mega",  choose: 2, count: 5, rarity: "allstar", cost: 10, text: "Choose 2 of 5 coaches." },
    // Spring Training (Celestial-style): level up your at-bat actions
    { id: "pk_spring",         name: "Spring Training",       kind: "action",   size: "",      choose: 1, count: 3, rarity: "star",    cost: 5,  text: "Level up 1 of 3 actions." },
    { id: "pk_spring_jumbo",   name: "Jumbo Spring Training", kind: "action",   size: "jumbo", choose: 1, count: 5, rarity: "star",    cost: 7,  text: "Level up 1 of 5 actions." },
    { id: "pk_spring_mega",    name: "Mega Spring Training",  kind: "action",   size: "mega",  choose: 2, count: 5, rarity: "allstar", cost: 9,  text: "Level up 2 of 5 actions." },
  ];

  // Deluxe editions (display). Effects live in CONFIG.editionFx.
  const EDITIONS = [
    { id: "allstar",   name: "All-Star",       text: "+2 Bag value when this card scores." },
    { id: "slugger",   name: "Silver Slugger", text: "+1.0 Rally when this card scores." },
    { id: "goldglove", name: "Gold Glove",     text: "This card's scoring play is worth x1.5 Rally." },
    { id: "hof",       name: "Hall of Fame",   text: "+2 Bag and +0.5 Rally when this card scores." },
    { id: "legendary", name: "Legendary",      text: "+3 Bag and +1.0 Rally. On a coach it takes no dugout slot." },
  ];
  // weighted spawn (rarer ones near the end)
  const EDITION_WEIGHTS = [
    { v: "allstar", w: 50 }, { v: "slugger", w: 30 }, { v: "goldglove", w: 14 }, { v: "hof", w: 5 }, { v: "legendary", w: 1 },
  ];
  function getEdition(id) { return EDITIONS.find((e) => e.id === id); }

  // The five at-bat actions you can level up (Spring Training).
  const ACTIONS = [
    { id: "swing",   name: "Swing Away",     text: "Your balanced swing scores hotter." },
    { id: "power",   name: "Power Swing",    text: "Selling out for the big fly scores hotter." },
    { id: "contact", name: "Work the Count", text: "Patient at-bats score hotter." },
    { id: "bunt",    name: "Bunt",           text: "Sacrifices and bunt singles score hotter." },
    { id: "steal",   name: "Steal",          text: "Stolen bases score hotter." },
  ];

  /* -------------------------------------------------------- */
  /* FRANCHISES (starting decks)                              */
  /* -------------------------------------------------------- */
  const FRANCHISES = [
    {
      id: "sandlot",
      name: "The Sandlot",
      tagline: "Balanced. The friendly place to learn.",
      signatureCoach: null,
      bonusText: "No signature coach - a clean, balanced start.",
      deck: ["nico_reyburn", "joey_marsh", "vic_castellano", "chip_donnelly", "gil_hatcher",
        "hank_delgado", "eddie_lux", "rusty_blanco", "benny_alvarez", "gabe_whitfield",
        "marty_soto", "milo_fenn"],
    },
    {
      id: "bashers",
      name: "The Bashers",
      tagline: "Swing for the fences. Power everywhere.",
      signatureCoach: "launch_angle",
      bonusText: "Starts with the Launch Angle Coordinator.",
      deck: ["mack_thunderton", "bruno_vargas", "cy_bigsby", "duke_hammond", "rex_stoneman",
        "milo_fenn", "sherman_boyle", "desmond_pratt", "hank_delgado", "vic_castellano",
        "gabe_whitfield", "rusty_blanco"],
    },
    {
      id: "smallball",
      name: "The Smallball Club",
      tagline: "Contact and speed. Manufacture runs.",
      signatureCoach: "small_ball",
      bonusText: "Starts with the Small Ball coach.",
      deck: ["ziggy_park", "marty_soto", "pete_almonte", "sunny_okada", "otis_lane",
        "slick_bonner", "benny_alvarez", "gil_hatcher", "chip_donnelly", "gabe_whitfield",
        "joey_marsh", "vic_castellano"],
    },
    {
      id: "moneyball",
      name: "The Moneyball Misfits",
      tagline: "Work the count. Patience pays.",
      signatureCoach: "patience_guru",
      bonusText: "Starts with Patience Guru and +$3 starting Payroll.",
      startBonusPayroll: 3,
      deck: ["walt_pemberton", "sherman_boyle", "ozzie_klein", "desmond_pratt", "lionel_frye",
        "buster_kray", "hank_delgado", "pete_almonte", "nico_reyburn", "joey_marsh",
        "marty_soto", "vic_castellano"],
    },
    {
      id: "speed",
      name: "The Speed Demons",
      tagline: "Burn the basepaths. Steal everything.",
      signatureCoach: "whitey_ball",
      bonusText: "Starts with Whitey Ball.",
      deck: ["rocket_ruiz", "dash_okafor", "slick_bonner", "flash_tomlin", "turbo_vance",
        "jackrabbit_jones", "benny_alvarez", "sunny_okada", "nico_reyburn", "gil_hatcher",
        "pete_almonte", "joey_marsh"],
    },
    {
      id: "oldguard",
      name: "The Old Guard",
      tagline: "Grizzled veterans who never fold.",
      signatureCoach: "veteran_presence",
      bonusText: "Starts with Veteran Presence - vets get stronger all run.",
      deck: ["marty_soto", "walt_pemberton", "bruno_vargas", "buster_kray", "hank_delgado",
        "dusty_quintero", "punch_lavoie", "el_toro_mendez", "lionel_frye", "vic_castellano",
        "gabe_whitfield", "rusty_blanco"],
    },
    {
      id: "youngguns",
      name: "The Young Guns",
      tagline: "Raw rookies with sky-high ceilings.",
      signatureCoach: "prospect_pipeline",
      bonusText: "Starts with Prospect Pipeline and +$3 - rookies grow your Rally.",
      startBonusPayroll: 3,
      deck: ["sunny_okada", "tank_mercer", "crusher_voss", "chip_donnelly", "flash_tomlin",
        "scooter_pace", "milo_fenn", "gunnar_polk", "desmond_pratt", "blast_jennings",
        "eddie_lux", "doc_ellwood"],
    },
    {
      id: "wildcards",
      name: "The Wild Cards",
      tagline: "Switch-hitters and do-it-all utility men.",
      signatureCoach: "platoon_manager",
      bonusText: "Starts with Platoon Manager - your platoon edge is doubled.",
      deck: ["ozzie_klein", "pete_almonte", "nico_reyburn", "rudy_falk", "andre_delacroix",
        "benny_alvarez", "comet_reyes", "kid_zamora", "jackrabbit_jones", "spray_okafor",
        "joey_marsh", "eddie_lux"],
    },
    {
      id: "frontoffice",
      name: "The Front Office",
      tagline: "Deep pockets. Buy your way to a contender.",
      signatureCoach: null,
      bonusText: "Start with +$15 Payroll. Outspend the league.",
      mods: { payroll: 15 },
      deck: ["nico_reyburn", "joey_marsh", "vic_castellano", "chip_donnelly", "gil_hatcher",
        "eddie_lux", "rusty_blanco", "pip_sandoval", "cole_morrow", "doc_ellwood",
        "gabe_whitfield", "benny_alvarez"],
    },
    {
      id: "farmhands",
      name: "The Farmhands",
      tagline: "Develop talent. Run deep.",
      signatureCoach: null,
      bonusText: "An extra dugout slot (9 coaches). Build a bigger staff.",
      mods: { dugoutSlots: 1 },
      deck: ["flash_tomlin", "sunny_okada", "chip_donnelly", "scooter_pace", "crusher_voss",
        "tank_mercer", "gunnar_polk", "doc_ellwood", "milo_fenn", "eddie_lux",
        "comet_reyes", "nico_reyburn"],
    },
    {
      id: "specialists",
      name: "The Specialists",
      tagline: "A man for every situation.",
      signatureCoach: null,
      bonusText: "A bigger lineup card: +1 hand size, more options each at-bat.",
      mods: { handSize: 1 },
      deck: ["nico_reyburn", "rudy_falk", "ace_brannigan", "hank_delgado", "dusty_quintero",
        "joey_marsh", "vic_castellano", "pip_sandoval", "cole_morrow", "ozzie_klein",
        "pete_almonte", "eddie_lux"],
    },
    {
      id: "superstition",
      name: "The Superstition",
      tagline: "Rituals, rally caps, and a lucky Salami.",
      signatureCoach: null,
      bonusText: "Roomier pouch (+1 Salami slot) and a free Salami card to start.",
      mods: { charmSlots: 1, grantSalami: 1 },
      deck: ["ziggy_park", "marty_soto", "buster_kray", "hank_delgado", "sherman_boyle",
        "desmond_pratt", "walt_pemberton", "ozzie_klein", "vic_castellano", "joey_marsh",
        "eddie_lux", "gabe_whitfield"],
    },
    {
      id: "pennypinchers",
      name: "The Penny-Pinchers",
      tagline: "Grind out every dollar.",
      signatureCoach: null,
      bonusText: "No interest on banked Payroll, but +$10 up front. Spend it early.",
      mods: { noInterest: true, payroll: 10 },
      deck: ["gil_hatcher", "eddie_lux", "rusty_blanco", "benny_alvarez", "pip_sandoval",
        "cole_morrow", "doc_ellwood", "chip_donnelly", "slick_bonner", "turbo_vance",
        "breeze_holloway", "nico_reyburn"],
    },
    {
      id: "bigleaguers",
      name: "The Big Leaguers",
      tagline: "Bright lights, big swings.",
      signatureCoach: null,
      bonusText: "Start every frame at x1.25 Rally. A swingy, all-or-nothing slugger lineup.",
      mods: { startRally: 1.25 },
      deck: ["mack_thunderton", "bruno_vargas", "duke_hammond", "cy_bigsby", "rex_stoneman",
        "boom_castillo", "moose_kowalski", "blast_jennings", "el_toro_mendez", "sherman_boyle",
        "hank_delgado", "milo_fenn"],
    },
    {
      id: "scouts",
      name: "The Scouts",
      tagline: "Wired into the network.",
      signatureCoach: null,
      bonusText: "+1 shop card slot and $1 off every reroll. See more, pay less.",
      mods: { extraCardSlots: 1, rerollDiscount: 1 },
      deck: ["rocket_ruiz", "dash_okafor", "sunny_okada", "ozzie_klein", "hank_delgado",
        "nico_reyburn", "joey_marsh", "gil_hatcher", "eddie_lux", "vic_castellano",
        "comet_reyes", "dink_harper"],
    },
  ];

  // Difficulty stakes (Balatro-style). Cumulative: each level keeps the harder rules below it.
  // You unlock the next stake by winning the World Series at the current one (META.maxStake).
  const STAKES = [
    { id: 1, name: "Rookie",      text: "The standard climb. Win it to unlock Veteran." },
    { id: 2, name: "Veteran",     text: "Targets are 8% higher." },
    { id: 3, name: "All-Star",    text: "Targets +16%, and pitchers throw harder (+3 Stuff / Command)." },
    { id: 4, name: "Cy Young",    text: "Targets +24%, pitchers +5, and the shop charges $1 more." },
    { id: 5, name: "Cooperstown", text: "Targets +32%, pitchers +7, prices +$1, and your lineup card is 1 smaller." },
  ];

  /* -------------------------------------------------------- */
  /* BRACKET STRUCTURE                                        */
  /* -------------------------------------------------------- */
  // A run is 8 innings (Balatro antes). Each inning has 3 frames (Top / Middle / Boss);
  // the 3rd frame is a Boss pitcher with a rule. Beat inning 8's boss to win the World
  // Series, then continue into Extra Innings (endless, exponentially escalating).
  const INNINGS_TO_WIN = 8;
  const GAMES_PER_ROUND = 3; // frames per inning; frame idx 2 is the Boss
  const ROUNDS = [];
  for (let _i = 1; _i <= INNINGS_TO_WIN; _i++) ROUNDS.push({ id: "inn" + _i, name: "Inning " + _i });

  /* -------------------------------------------------------- */
  /* RARITY metadata (colors handled in CSS via class)        */
  /* -------------------------------------------------------- */
  const RARITY_ORDER = { common: 0, star: 1, allstar: 2, legend: 3 };

  global.CONFIG = CONFIG;
  global.PLAYERS = PLAYERS;
  global.COACHES = COACHES;
  global.BOSSES = BOSSES;
  global.ANALYTICS = ANALYTICS;
  global.SCOUTING = SCOUTING;
  global.CHARMS = CHARMS;
  global.ACHIEVEMENTS = ACHIEVEMENTS;
  global.UPGRADES = UPGRADES;
  global.PACKS = PACKS;
  global.EDITIONS = EDITIONS;
  global.EDITION_WEIGHTS = EDITION_WEIGHTS;
  global.ACTIONS = ACTIONS;
  global.getEdition = getEdition;
  global.FRANCHISES = FRANCHISES;
  global.STAKES = STAKES;
  global.ROUNDS = ROUNDS;
  global.GAMES_PER_ROUND = GAMES_PER_ROUND;
  global.RARITY_ORDER = RARITY_ORDER;
  global.TRAITS = TRAITS;
  global.getPlayer = getPlayer;
  global.getTrait = getTrait;
  global.getCoach = getCoach;
  global.getBoss = getBoss;
  global.getCharm = getCharm;
  global.getAchievement = getAchievement;
})(window);
