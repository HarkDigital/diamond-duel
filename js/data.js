/* ============================================================
   Diamond Duel — Config + Content
   All tuning lives in CONFIG so balancing is a data edit.
   All randomness elsewhere is seeded; this file is static data.
   ============================================================ */
(function (global) {
  "use strict";

  /* -------------------------------------------------------- */
  /* CONFIG — every tuning lever in one place                 */
  /* -------------------------------------------------------- */
  const CONFIG = {
    // Resources per game
    outsPerGame: 27,
    handSize: 6,
    pinchHits: 3,
    startingRally: 1.0,

    // Rally
    rallyIncrement: 0.5, // per safe outcome
    walkRallyIncrement: 0.5, // overridden by Patience Guru
    rallyResetValue: 1.0,

    // Base outcome weights (league-ish starting point; tune freely)
    baseWeights: {
      K: 21,
      BB: 9,
      HBP: 1,
      OUT: 40,
      "1B": 16,
      "2B": 5.5,
      "3B": 0.6,
      HR: 7,
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

    // Target curve across the 12-game gauntlet (idx 0..11). Boss games are idx 2,5,8,11.
    // Tuned via headless simulation: a strong scaled build clears the gauntlet ~40%+
    // (higher for skilled human play), a half-built deck falls off in the late rounds,
    // and the unupgraded starting deck cannot survive past round 2.
    targets: [40, 55, 80, 108, 145, 190, 250, 320, 360, 440, 530, 610],

    // Ordinary / boss pitcher scaling across the bracket
    pitcher: {
      baseStuff: 40,
      stuffPerGame: 2.2,
      baseCommand: 42,
      commandPerGame: 1.7,
      bossStuffBonus: 5,
      bossCommandBonus: 4,
    },

    // Ace boss target multiplier
    aceTargetMult: 1.25,

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
    dugoutSlots: 5,

    // Edition effects
    edition: {
      goldPayroll: 2,
      clutchRallyBonus: 1.0,
      prospectStatGain: 3,
      veteranRallyBonus: 0.2,
      foilStatBump: 6,
    },
  };

  /* -------------------------------------------------------- */
  /* PLAYERS — fictional roster (avoids licensing).           */
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
  ];

  function getPlayer(id) {
    return PLAYERS.find((p) => p.id === id);
  }

  /* -------------------------------------------------------- */
  /* COACHES (the jokers). fx id is read by the engine.       */
  /* -------------------------------------------------------- */
  const COACHES = [
    // Flat boosters
    { id: "launch_angle", name: "Launch Angle Coordinator", fx: "launchAngle", trigger: "passive", rarity: "common", cost: 4, text: "All home runs gain +2 Bag value." },
    { id: "contact_instructor", name: "Contact Hitting Instructor", fx: "contactInstructor", trigger: "passive", rarity: "common", cost: 4, text: "All singles gain +1 Bag value." },
    { id: "gap_coach", name: "Gap-to-Gap Coach", fx: "gapCoach", trigger: "passive", rarity: "common", cost: 4, text: "All doubles & triples gain +2 Bag value." },
    { id: "patience_guru", name: "Patience Guru", fx: "patienceGuru", trigger: "passive", rarity: "common", cost: 4, text: "Walks & HBP grant +1.0 Rally (instead of +0.5)." },

    // Sequence / situational
    { id: "hit_and_run", name: "Hit-and-Run", fx: "hitAndRun", trigger: "situational", rarity: "common", cost: 5, text: "Playing a Contact card with a runner on first grants +0.5 Rally." },
    { id: "table_setter", name: "Table-Setter", fx: "tableSetter", trigger: "situational", rarity: "star", cost: 6, text: "If the first batter of an inning reaches base, +0.5 Rally on every safe play for the rest of that inning." },
    { id: "two_out_magic", name: "Two-Out Magic", fx: "twoOutMagic", trigger: "situational", rarity: "star", cost: 6, text: "Events recorded with two outs score at +1.0 Rally." },
    { id: "risp_specialist", name: "RISP Specialist", fx: "rispSpecialist", trigger: "situational", rarity: "star", cost: 6, text: "With a runner in scoring position, +1 Bag value per run driven in." },
    { id: "back_to_back", name: "Back-to-Back", fx: "backToBack", trigger: "situational", rarity: "star", cost: 6, text: "Playing two Slugger cards in a row grants +1.0 Rally on the second." },
    { id: "small_ball", name: "Small Ball", fx: "smallBall", trigger: "situational", rarity: "star", cost: 6, text: "Productive outs and stolen bases grant +0.5 Rally (and a productive out won't reset your Rally)." },
    { id: "rally_cap", name: "Rally Caps", fx: "rallyCap", trigger: "situational", rarity: "star", cost: 6, text: "Every 3rd consecutive safe outcome scores with an extra +1.5 Rally." },

    // Roster-composition (tag readers)
    { id: "bash_brothers", name: "Bash Brothers", fx: "bashBrothers", trigger: "passive", rarity: "star", cost: 6, text: "While 4+ Sluggers are in your deck, all hits gain +1 Bag value." },
    { id: "whitey_ball", name: "Whitey Ball", fx: "whiteyBall", trigger: "passive", rarity: "star", cost: 6, text: "While 3+ Speedsters are in your deck, all runners gain +18 Speed." },
    { id: "platoon_manager", name: "Platoon Manager", fx: "platoonManager", trigger: "passive", rarity: "common", cost: 5, text: "Your platoon advantage bonus is doubled." },
    { id: "sabermetrician", name: "Sabermetrician", fx: "sabermetrician", trigger: "passive", rarity: "star", cost: 6, text: "Walks count as singles for Bag value (Bag 2)." },

    // Scaling
    { id: "prospect_pipeline", name: "Prospect Pipeline", fx: "prospectPipeline", trigger: "scaling", rarity: "star", cost: 6, text: "Gains +0.2 Rally (applied to every event) each time a Rookie records a hit.", state: { bonus: 0 } },
    { id: "hot_streak", name: "Hot Streak", fx: "hotStreak", trigger: "scaling", rarity: "star", cost: 6, text: "Gains +0.5 Rally per game in which you hit a home run. Resets after a game with no homer.", state: { bonus: 0, homerThisGame: false } },
    { id: "veteran_presence", name: "Veteran Presence", fx: "veteranPresence", trigger: "scaling", rarity: "star", cost: 6, text: "Gains +0.1 Rally (applied to every event) each time a Veteran records a hit.", state: { bonus: 0 } },

    // Economy
    { id: "frugal_fo", name: "Frugal Front Office", fx: "frugalFO", trigger: "economy", rarity: "common", cost: 5, text: "Earn +1 Payroll per leftover out when you win a game." },
    { id: "sign_stealer", name: "Sign Stealer", fx: "signStealer", trigger: "economy", rarity: "common", cost: 5, text: "Your first shop reroll each visit is free." },
    { id: "gold_glove_agent", name: "Gold Glove Agent", fx: "goldGloveAgent", trigger: "economy", rarity: "common", cost: 5, text: "Earn +1 Payroll every time you hit a home run." },
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
    { id: "ace", name: "The Ace", rule: "ace", text: "Target is increased by 50%. No other rule — a raw check.", tier: 2 },
  ];

  function getBoss(id) {
    return BOSSES.find((b) => b.id === id);
  }

  /* -------------------------------------------------------- */
  /* CONSUMABLES — analytics (planets) + scouting (tarots)    */
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
  /* FRONT OFFICE UPGRADES (vouchers)                          */
  /* -------------------------------------------------------- */
  const UPGRADES = [
    { id: "up_dugout", name: "Expanded Dugout", fx: "dugoutSlot", rarity: "star", cost: 8, text: "+1 dugout slot (more coaches)." },
    { id: "up_pinch", name: "Deep Bench", fx: "pinchHit", rarity: "common", cost: 6, text: "+1 pinch hit per game." },
    { id: "up_hand", name: "Bigger Lineup Card", fx: "handSize", rarity: "common", cost: 6, text: "+1 hand size." },
    { id: "up_discount", name: "Analytics Department", fx: "discount", rarity: "star", cost: 7, text: "Shop prices reduced by $1 (min $1)." },
    { id: "up_shopslot", name: "Scouting Network", fx: "shopSlot", rarity: "star", cost: 7, text: "+1 card slot in the shop." },
    { id: "up_reroll", name: "Front Office Interns", fx: "rerollCheap", rarity: "common", cost: 6, text: "Rerolls cost $1 less." },
    { id: "up_startrally", name: "Home Field Advantage", fx: "startRally", rarity: "allstar", cost: 9, text: "Start every game at x1.5 Rally instead of x1.0." },
    { id: "up_interest", name: "Smart Investments", fx: "interest", rarity: "star", cost: 7, text: "Interest cap raised to $8." },
  ];

  /* -------------------------------------------------------- */
  /* BOOSTER PACKS                                             */
  /* -------------------------------------------------------- */
  const PACKS = [
    { id: "pk_player", name: "Prospect Pack", kind: "player", choose: 1, count: 3, rarity: "common", cost: 4, text: "Choose 1 of 3 player cards." },
    { id: "pk_player_big", name: "Free Agent Pack", kind: "player", choose: 1, count: 4, rarity: "star", cost: 6, text: "Choose 1 of 4 stronger player cards." },
    { id: "pk_coach", name: "Coaching Pack", kind: "coach", choose: 1, count: 3, rarity: "star", cost: 6, text: "Choose 1 of 3 coaches." },
    { id: "pk_scout", name: "Scouting Pack", kind: "scouting", choose: 2, count: 3, rarity: "common", cost: 5, text: "Choose 2 of 3 scouting reports." },
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
      bonusText: "No signature coach — a clean, balanced start.",
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
  ];

  /* -------------------------------------------------------- */
  /* BRACKET STRUCTURE                                        */
  /* -------------------------------------------------------- */
  const ROUNDS = [
    { id: "wildcard", name: "Wild Card" },
    { id: "division", name: "Division Series" },
    { id: "championship", name: "Championship Series" },
    { id: "worldseries", name: "World Series" },
  ];
  const GAMES_PER_ROUND = 3; // game 0, game 1, boss(2)

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
  global.UPGRADES = UPGRADES;
  global.PACKS = PACKS;
  global.FRANCHISES = FRANCHISES;
  global.ROUNDS = ROUNDS;
  global.GAMES_PER_ROUND = GAMES_PER_ROUND;
  global.RARITY_ORDER = RARITY_ORDER;
  global.getPlayer = getPlayer;
  global.getCoach = getCoach;
  global.getBoss = getBoss;
})(window);
