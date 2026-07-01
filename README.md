# Diamond Duel

A single-player, baseball-themed **roguelike deckbuilder**: Balatro re-engineered around
manufacturing runs. Build a lineup of player cards, send them to the plate one at a time,
and stack a snowballing **Rally multiplier** to out-score each pitcher's Target before you
burn your three outs. Survive all **9 innings**, beat the Boss in the 9th, and win the
World Series, then push into endless **Extra Innings**.

Built as a self-contained static web app (HTML + vanilla JS + procedural SVG artwork,
no build step, no dependencies).

**Play it:** https://harkdigital.github.io/diamond-duel/

## How to run it locally

Just open `index.html` in any modern browser. No server, no install. Or serve it:

```bash
cd "Diamond Duel"
python3 -m http.server 4178
# then visit http://localhost:4178
```

## The core idea

| Balatro | In Diamond Duel |
|---|---|
| Score = chips x mult | **Score = Bag value x Rally** |
| Chips | **Bag value** of an offensive event (Walk 100 up to Home Run 500, +100 per run driven in) |
| Mult | **Rally**: builds +0.5 on every safe outcome and holds through outs; it resets when the inning ends |
| Hands / plays | **3 outs** per frame: every out is precious |
| Blind / score-to-beat | The pitcher's **Target**, climbing every frame |
| Ante (8 of them) | **9 innings**, each with Top / Middle / **Boss** frames (27 in all) |
| Boss blind | **Boss pitchers** with nasty rules (the Closer gives you only 2 outs, the Flamethrower makes strikeouts cost two...) |
| Jokers | **100 Coaches** in your dugout |
| Consumables | **Salami Cards**: one-shot superstitions you drag onto players and coaches |
| Planets / Tarots | **Spring Training** action levels / **Scouting reports** |
| Vouchers | **32 Front Office upgrades** (16 base + 16 tier-2) |
| Skip tags | **24 Skip Tags**: skip a Top or Middle frame, pocket a reward |
| Booster packs | Sealed foil **packs** you drag open: Prospect, Scouting, Salami, Coaching, Spring Training, in Normal / Jumbo / Mega sizes |
| Decks + stakes | **15 lineups** x **5 difficulty stakes** (Rookie to Cooperstown) |

The skill is **sequencing**: lead off your speedster to set the table, hold your slugger
until runners are aboard, and time the big bat to land while the Rally is huge. A
three-run homer at x2.5 is worth far more than the same swing leading off at x1.0. When
the path is clear you can bunt runners over, send them to steal, or even gamble on a
straight **steal of home**.

## Also in the box

- **Procedural artwork**: every player card, coach, pitcher, pack, and team crest is a
  deterministic SVG portrait generated from its id; no image files anywhere.
- **Seeded runs**: every run reproduces exactly from its seed string. The seed is revealed
  when the run ends and can be copied and replayed (seeded runs earn no unlocks).
- **57 achievements**, a career profile, and a Balatro-style Collection compendium that
  fills in as you discover coaches, Salami Cards, vouchers, and tags.
- **Mid-inning save/resume**: refresh whenever; the game picks up exactly where you were.
- **Sequential scoring**: every hit counts up Balatro-style, one contribution at a time.
  The Bag x Rally tally fills as each coach fires, then the product slams into your score;
  frame wins cash out line by line. Tap anywhere to fast-forward.
- **Game speed setting** (1x to 4x) that scales every animation and pause.
- **iPhone friendly**: the playfield tucks inside the Dynamic Island and home indicator
  safe areas in landscape.

## Project layout

| File | Role |
|---|---|
| `index.html` | shell + versioned asset tags |
| `js/rng.js` | seeded RNG (xmur3 + mulberry32), resumable |
| `js/audio.js` | WebAudio synth SFX |
| `js/icons.js` | inline SVG icon set |
| `js/art.js` | procedural portrait / pack-art / crest generator |
| `js/data.js` | all content + tuning (CONFIG, players, coaches, packs, tags...) |
| `js/engine.js` | pure at-bat resolver (headless, runs in Node) |
| `js/app.js` | state, screens, shop, drag, saves, juice |
| `css/styles.css` | all styles; fixed 1600px stage scaled to fit |

There is a small debug API on `window.DD` (e.g. `DD.autoPlay()`, `DD.give(50)`) used for
development and balance simulation.
