# Diamond Duel - project guide

A **vanilla-JS baseball roguelike deckbuilder** (Balatro-inspired). No build step, no
framework, no dependencies. Plain `<script>` tags share one global scope. Deployed to
GitHub Pages.

- **Live:** https://harkdigital.github.io/diamond-duel/
- **Repo:** HarkDigital/diamond-duel (deploys from `main`)

## Run / preview / deploy

- **Preview locally:** static server at repo root, e.g. `python3 -m http.server 4178`
  (the `.claude/launch.json` "diamond-duel" config does exactly this). Open the root.
- **No terminal on the user's machine.** The user does not run commands; Claude handles
  preview + deploy.
- **Deploy:** commit to `main` and `git push` (gh authed as HarkDigital). GitHub Pages
  serves `main` and usually goes live within ~30s. Verify with `curl` against the live
  URL and compare `shasum` of changed files to local.

### Cache-busting (IMPORTANT)
`index.html` loads assets with a version query, e.g. `css/styles.css?v=9`,
`js/app.js?v=9`. **Bump every `?v=N` in `index.html` on each deploy** so returning
players' browsers fetch fresh CSS/JS instead of stale cached copies. (A stale CSS cache
is what made the field-diagram fix appear "not to work" once.)

## Hard conventions

- **No emoji anywhere.** All glyphs are inline SVG via `icon(name)` from `js/icons.js`
  (`icon()` returns an `<svg>` that inherits `currentColor`). To add a glyph, add an entry
  to the `ICONS` map (Feather/Lucide-style stroked paths), then reference it by name.
- **No em dashes (-) or en dashes (-)** in user-facing text. Use a plain hyphen, comma,
  colon, or period. The user has asked for these to be removed repeatedly; keep them out.
- **Everything is seeded.** All randomness flows through `makeRNG(seed)` (`js/rng.js`,
  xmur3 -> mulberry32) so runs are reproducible. The RNG exposes `state()` for save/resume.
- Keep the load order in `index.html`: `rng -> audio -> icons -> data -> engine -> app`.

## Files

| File | Role |
|------|------|
| `index.html` | shell: `#stage > #app`, splash, rotate hint, versioned asset tags |
| `js/rng.js` | seeded RNG, resumable via `state()` |
| `js/audio.js` | WebAudio SFX (`SFX.*`) |
| `js/icons.js` | inline-SVG icon set; `icon(name[, extraClass])` |
| `js/data.js` | all content + tuning: `CONFIG`, `FRANCHISES`, cards, `COACHES`, `CHARMS` (Sunflower Seeds), `UPGRADES` (Front Office), `ACHIEVEMENTS`, `TRAITS`, `ROUNDS` |
| `js/engine.js` | pure rules: `Engine.resolveAtBat`, steals, rally math, coach effects |
| `js/app.js` | everything else: state, rendering, screens, shop, drag, save/load, overlays |
| `css/styles.css` | all styles; responsive via a scale-to-fit stage + media queries |

## Layout model

`#stage` is a fixed design surface scaled to fit the viewport via `transform: scale()`
(`stageScale()` reads the matrix). The game screen is a CSS grid (`game-main`) with
`col-field` (diamond + outs/inning), `col-summary` (play log), `col-powerups` (Seeds),
`col-dugout` (coaches), and a full-width `atbat-bar`.

The **field diamond** must stay a perfect square or the percentage-positioned bases and
runner tokens drift off the infield corners. It is sized with container-query units:
`.col-field .diamond-wrap { container-type: size }` and
`.col-field .diamond { width:100cqmin; height:100cqmin }`. Bases sit at 16%/84%; runner
tokens (`.rtok`) share the same coordinate space in `#runner-layer` and walk the basepath
via a CSS `left/top` transition.

## Game model (important for "runs"/"innings" questions)

- A **run** is the whole roguelike attempt: **9 innings** (`ROUNDS.length * GAMES_PER_ROUND`),
  every 3rd is a **Boss**.
- Each **"game"** object (`STATE.game`) is **one inning vs one pitcher**, with **3 outs**
  (`CONFIG.outsPerGame`; the Closer boss gives 2; the Second Wind seed adds 1).
- **`g.score` / target** ("0 / 10") is the roguelike currency = sum of **Bag value × Rally**.
  Rally starts ×1.0 and climbs +0.5 per safe play; an out persists rally (resets at inning end).
- **`g.runsScored`** ("Runs this inning") = literal runners who crossed the plate this
  game/inning. It resets to 0 each new inning (new `STATE.game`). It is **not** the run total
  and **not** the same as Score.

## Key systems (all in `js/app.js` unless noted)

- **Save/resume:** `SAVE_KEY` (run) + `GAME_KEY` (mid-inning snapshot incl. RNG `state()`).
  Refresh + Continue restores screen, score, bases, outs.
- **Meta/profile:** `META` (localStorage `META_KEY`) holds `ach`, `career`, `discovered`,
  franchises, sound. `defaultMeta()` + `migrateMeta()` back-fill new fields on old saves.
- **Achievements:** 49 in `ACHIEVEMENTS`. `unlockAchievement` (once ever, banner) and
  `awardAchievement` (feats that also gift a Seed, once per run).
- **Coaches** (`COACHES`, the "build"/Jokers): passive/situational/scaling/economy effects
  applied in `engine.js`. A coach may carry a runtime `aura` (flat Rally per safe play) added
  by the Coaching Clinic seed.
- **Sunflower Seeds** (`CHARMS`, one-shot consumables): `target` is `player`, `coach`, or
  `immediate`.
  - player/coach seeds are **dragged** onto a hand card or dugout coach
    (`onCharmPointerDown/Move/Up` + `applyCharmToTarget`). Tapping is a fallback that opens a
    picker (`useCharm` -> `openCharmPicker` -> `applyCharmTo`).
  - `immediate` seeds (Intentional Walk, Momentum Shift, Second Wind) are **tapped**
    (`applyImmediateCharm`).
- **Collection** (`showCollection`, Balatro-style): every coach / seed / voucher, locked
  (`lock` icon + "???") until `isDiscovered(id)`. `discover(id)` is called when an item is
  acquired (shop buy, pack, granted seed, signature coach). Undiscovered shop items show an
  "Undiscovered" tag (`.undisc-tag`).
- **Drag:** card-to-bat and seed-to-target both use document-level pointer handlers in
  `setupDrag()`. The card drag uses `#bat-zone`; the seed drag builds a `.charm-ghost` and
  highlights `.charm-zone` / `.charm-hover` targets.
- **Seeds (RNG) visibility:** the run seed is **hidden during a run** (map + Stats show
  "hidden until the run ends") and revealed only on the run-end screens (victory + the
  `showGameOver` post-mortem), where it is copyable/replayable via `seedChip`.
- **Tooltips:** custom `TIP` controller; `?`-only hover on cards, tap-to-pin, touch suppression.

## Change history (most recent batches)

- Field-box layout, inline swing bar (no popup), drag-to-bat, abandon confirmation.
- Charms/powerups system, ?-only card tooltips.
- **Batch 8:** renamed powerups to **Sunflower Seeds**; 49 achievements + Profile;
  animated splash; mid-inning save/resume; 8 franchises (4×2); deck/roster 30 with paginated
  deck view; dugout 2×4; card footer (trait/pos/? lower-right); equal-height shop coaches.
- Field diagram made square (cqmin); at-bat header simplified (no platoon chip, no "how do
  you swing?"); corner X replaced by a labeled **Cancel** in the tactics.
- **This batch:** hide seed until run ends; spruced post-mortem; removed all em/en dashes;
  **Collection** screen + discovery tracking + Undiscovered tags; **drag** Seeds onto
  players/coaches; coach-affecting seed (Coaching Clinic aura); asset cache-busting (`?v=`).
