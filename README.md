# ◆ Diamond Duel

A single-player, baseball-themed **roguelike deckbuilder** — *Balatro* re-engineered around
manufacturing runs. Build a lineup of player cards, play them one at a time as a batting-order
combo, and stack a snowballing **rally multiplier** to out-score the opposing ace before you run
out of outs. Survive a 12-game postseason gauntlet from the Wild Card to the World Series.

Built as a self-contained static web app (HTML + vanilla JS, no build step, no dependencies).

## How to play it

Just open `index.html` in any modern browser — that's it. No server, no install.

Or, if you prefer a local server:

```bash
cd "Diamond Duel"
python3 -m http.server 4178
# then visit http://localhost:4178
```

## The core idea

| Concept | In Diamond Duel |
|---|---|
| Score = chips × mult | **Score = Bag value × Rally** |
| Chips | **Bag value** of an offensive event (walk 1 → HR 5, +1 per run driven in) |
| Mult | **Rally** — builds +0.5 on every safe outcome, **resets to ×1.0 on an out** |
| Blind / score-to-beat | The **pitcher's Target** |
| Hands / plays | **Outs** (27 per game) |
| Discards | **Pinch hits** (swap a card in hand) |
| Jokers | **Coaches** in your dugout (the build) |
| Planets / Tarots / Vouchers | **Analytics / Scouting reports / Front-office upgrades** |
| Boss blind | **Boss pitchers** with rule modifiers (Knuckleballer halves Power, etc.) |
| Ante (8) | **The Gauntlet** — Wild Card → Division → Championship → World Series |

The skill is **sequencing**: lead off your speedster to set the table, hold your slugger until
runners are aboard, and time the big bat to land while the rally is huge. A three-run homer at
×2.5 is worth far more than the same swing leading off at ×1.0.

## How to play (controls)

- **Click a card** (or press **1–8**) to send that batter to the plate.
- **Pinch Hit** (or **P**) swaps a card in your hand for a fresh draw — a limited resource.
- Reach the **Target** to win the game; spend all your **Outs** short of it and you're eliminated.
- Between games, visit the **Shop** to buy players, coaches, analytics, scouting reports,
  front-office upgrades, and booster packs. Watch the **boss telegraph** on the map and shop for it.

## What's in this build

- **At-bat engine** — one seeded weighted roll per plate appearance, adjusted by four batter stats
  (Contact / Power / Eye / Speed), pitcher Stuff & Command, platoon handedness, and active coaches;
  plus sub-rolls for double plays, sacrifice flies, extra bases taken, and stolen bases.
- **The rally scoring engine** — Bag × Rally with a satisfying snowball and reset-on-out tension.
- **40 player cards** (fictional, incl. legends), **21 coaches** across every category
  (flat / situational / roster-reading / scaling / economy), **8 boss pitcher rules**,
  **5 franchises** (starting decks), analytics packages, 11 scouting reports, 8 upgrades, 4 pack types.
- **Card editions** — Gold, Clutch, Prospect (scaling), Foil, Veteran.
- **Full gauntlet** — 4 rounds × 3 games (two ordinary + one boss) with a rising target curve,
  economy with interest, escalating reroll costs, and a bracket/map screen.
- **Polish** — animated rally hero-number with heat glow, score/run pops, coach-trigger flashes,
  card deal/play motion, a pure-WebAudio synth for SFX (no asset files), and save/resume.

## Design & tuning notes

- All tuning lives in `CONFIG` in [`js/data.js`](js/data.js) — base outcome weights, stat
  coefficients, rally increment, bag values, the target curve, pitcher scaling, economy, and shop.
- The difficulty curve was tuned with a **headless Monte-Carlo simulation** of the real engine:
  a fully-scaled build clears the gauntlet ~40%+ of the time (more for skilled play), a half-built
  deck falls off in the late rounds, and the unupgraded starting deck cannot survive past round 2.
- All randomness flows through one **seeded RNG** ([`js/rng.js`](js/rng.js)), keyed per game/shop,
  so runs are reproducible and saves resume cleanly.

## File layout

```
index.html        — entry point, loads everything
css/styles.css    — all styling & animations
js/rng.js         — seeded RNG (xmur3 → mulberry32)
js/audio.js       — tiny WebAudio synth for SFX
js/data.js        — CONFIG + all content (players, coaches, bosses, franchises, shop items)
js/engine.js      — resolveAtBat(): the testable at-bat resolver & scoring
js/app.js         — state, screens, the game loop, shop, bracket, save/load
```

There is a small debug API on `window.DD` (e.g. `DD.autoPlay()`, `DD.give(50)`) used during
development and balance simulation.

---

*Roadmap parked for later (per the design spec): meta-progression unlocks & stakes, a collection
almanac, and swapping the fictional roster for ratings derived from the live MLB Stats API.*
