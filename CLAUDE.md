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
- **Headless checks:** `data.js`, `engine.js`, `icons.js`, `art.js`, and `rng.js` run in
  plain Node with a shim: `node -e "global.window = global; require('./js/data.js'); ..."`.
  Use this for count checks, art smoke tests, and engine sims before opening a browser.
- **Debug API (`window.DD`):** `DD.autoPlay(n)` (crude AI plays the current frame),
  `DD.play(i, approach)`, `DD.win()` (score = target), `DD.give(n)` (payroll),
  `DD.state()`, `DD.startFranchise(id)`, `DD.render()`. This is how balance gets
  Monte-Carlo tested in the browser; it ships in production deliberately.

### Cache-busting (IMPORTANT)
`index.html` loads every asset with a version query (`css/styles.css?v=N`, all 7 JS tags).
**Bump every `?v=N` in `index.html` on each deploy** so returning players fetch fresh
files instead of stale cached copies. This also bites during preview iteration: a plain
reload may serve the cached `?v=N`, so bump it (or cache-bust the href) to force-fetch
edited CSS.

### When game rules change, update ALL of these surfaces
The code has outrun the prose more than once. Any change to run structure, scoring, or a
mechanic must sweep:
1. `HOWTO_SECTIONS` in `js/app.js` (the in-game How to Play),
2. boss `text` / achievement `text` strings in `js/data.js` (players read these),
3. `README.md` (public on GitHub),
4. the "Game model" section of this file.

## Hard conventions

- **No emoji anywhere.** All glyphs are inline SVG via `icon(name)` from `js/icons.js`
  (`icon()` returns an `<svg>` that inherits `currentColor`). To add a glyph, add an entry
  to the `ICONS` map (Feather/Lucide-style stroked paths), then reference it by name.
- **No em dashes (-) or en dashes (-)** in user-facing text. Use a plain hyphen, comma,
  colon, or period.
- **Everything gameplay is seeded.** All game randomness flows through `makeRNG(seed)`
  (`js/rng.js`, xmur3 -> mulberry32) so runs are reproducible; the RNG exposes `state()`
  for save/resume. The only sanctioned non-seeded randomness: `randomSeed()` itself
  (generating the seed string), WebAudio noise, and nothing else. Cosmetic art randomness
  is hash-derived per item id in `js/art.js` (deterministic, not the game RNG).
- Keep the load order in `index.html`: `rng -> audio -> icons -> art -> data -> engine -> app`.

## Files

| File | Role |
|------|------|
| `index.html` | shell: `#stage > #app`, splash, rotate hint, versioned asset tags |
| `js/rng.js` | seeded RNG, resumable via `state()`; `uid()` counter with `uid.bump()` for resume |
| `js/audio.js` | WebAudio SFX (`SFX.*`) |
| `js/icons.js` | inline-SVG icon set; `icon(name[, extraClass])` |
| `js/art.js` | **procedural artwork**: `portraitSVG(card)`, `coachPortraitSVG`, `pitcherPortraitSVG`, `packArtSVG(kind)`, `crestSVG(franchise)`; all deterministic from item ids |
| `js/data.js` | all content + tuning: `CONFIG` (incl. `scoreScale`, `shop.packWeights`), 15 `FRANCHISES`, 60 `PLAYERS`, 100 `COACHES`, 12 `CHARMS` (Salami Cards), 32 `UPGRADES` (vouchers), 24 `TAGS`, 57 `ACHIEVEMENTS`, `TRAITS`, `ROUNDS`, 5 `STAKES`, 5 `EDITIONS`, 15 `PACKS`, `ACTIONS` |
| `js/engine.js` | pure rules: `Engine.resolveAtBat`, `attemptSteal` (incl. steal of home), rally math, edition hooks, three generic coach dispatchers (Bag/Rally/Econ) reading each coach's `gen` descriptor. Headless: no DOM/SFX calls |
| `js/app.js` | everything else: state, rendering, screens, shop, drag, save/load, overlays |
| `css/styles.css` | all styles; responsive via a scale-to-fit stage + media queries |
| `README.md` | public repo description; keep in sync with the game (see checklist above) |
| `tools/sim.js` | headless Monte-Carlo balance sim (`node tools/sim.js [reps]`): plays frames with the real engine at 4 build tiers and prints clear% vs the target curve. Use it before ANY tuning change to `CONFIG.target`/`pitcher`/coach numbers |

## Layout model

`#stage` is a fixed design surface scaled to fit the viewport via `transform: scale()`
(`stageScale()` reads the matrix). Every in-run screen (game/map/shop) shares the
**persistent run frame**: `runSideHTML(ctx)` renders the left sidebar (matchup/boss rule,
SCORE AT LEAST target, round score + progress, outs pips, inning, payroll, franchise +
stake, Deck/Menu buttons; the game's live ids `#sb-*`/`#out-pips`/`#res-inning`/
`#payroll-amt` all live here), and `runTopHTML()` renders the top band where the DUGOUT
and SALAMI rows sit as **large cream art cards** (`coachIconHTML(c, idx)` = portrait +
name + corner sell; `charmBadgeHTML(c, i)` = item poster + name + sell), always in the
same place on every screen, with an idle float animation. The rows keep ids `#dugout`/
`#powerups` so the live updaters, tooltips, taps (use in game / open pouch elsewhere),
drags, corner sells, and coach trigger flashes work identically everywhere; `render()`
fills them on map/shop too. Game content: `game-main` grid = `col-field` (diamond +
rally meter pinned to its upper right, `.field-rally`) | `col-summary` (play log) with
the `atbat-bar` under the summary, then the hand row with the tappable `deck-pile`
(remaining/total) at its right.

The **field diamond** must stay a perfect square or the percentage-positioned bases and
runner tokens drift off the infield corners. It is sized with container-query units:
`.col-field .diamond-wrap { container-type: size }` and
`.col-field .diamond { width:100cqmin; height:100cqmin }`. Bases sit at 16%/84%; runner
tokens (`.rtok`) share the same coordinate space in `#runner-layer`.

## Game model (important for "runs"/"innings" questions)

- A **run** is **9 innings** (Balatro antes; `ROUNDS.length`), each with **3 frames**
  (`GAMES_PER_ROUND`): **Top / Middle / Boss**. So **27 frames** main, then **Extra
  Innings** (endless). `gameIndex` 0..26 main, 27+ extra. Helpers: `inningOf`/`frameOf`/
  `isBossInning`/`isExtraInnings`/`roundName`/`gameLabel`. Beat inning 9's Boss ->
  `showVictory` with a "Play Extra Innings" continue (`run.wonWS`).
- Targets come from a **formula** `targetFor(gi)` = `round(base * inningGrowth^(inning-1) *
  frameMult[frame] * scoreScale)` (`CONFIG.target`/`scoreScale`), rounded to a clean
  multiple of 5. Pitcher stuff/command scale per inning + frame (`CONFIG.pitcher`).
  Bosses pre-rolled for 9 innings **without repeats** until the pool runs dry
  (`pickBoss` excludes already-rolled ids); extras via `bossFor` on demand.
- Each **"game"** object (`STATE.game`) is **one frame vs one pitcher**, with **3 outs**
  (`CONFIG.outsPerGame`; the Closer boss gives 2; Second Wind adds 1).
- **`g.score` / target** is the roguelike currency = sum of **Bag value x Rally**. Bag and
  target are both multiplied by `CONFIG.scoreScale` (**100**) so numbers feel grand;
  balance is identical. Rally is un-scaled: starts x1.0, +0.5 per safe play; an out does
  NOT reset it (it resets at inning end). Any new score-threshold (achievements etc.)
  must multiply by `scoreScale`.
- **`g.runsScored`** = literal runners across the plate this frame. Not the score.

## Key systems (all in `js/app.js` unless noted)

- **Save/resume:** `SAVE_KEY` (run) + `GAME_KEY` (mid-inning snapshot incl. RNG `state()`).
  On resume, `uid.bump()` raises the uid counter past every saved uid, and the snapshot's
  cards are **re-linked by uid** to the `run.deck` objects so buffs/Prospect growth stay
  shared after a refresh. Pack picks `saveRun()` immediately and packs charge on open, so
  refreshing can't un-spend.
- **Soft-lock guards:** `commitAtBat`/`sendRunner` wrap their bodies in try/finally that
  clears `STATE.busy`; `boot()` adds window `error`/`unhandledrejection` listeners that
  also clear it.
- **Meta/profile:** `META` (localStorage `META_KEY`) holds `ach`, `career`, `discovered`,
  `franchisesPlayed`/`franchisesWon`, `maxStake`, `lineupWins`, `sound`, `speed` (1..4).
  `defaultMeta()` + `migrateMeta()` back-fill new fields on old saves.
- **Seeded runs earn nothing:** `runIsSeeded()` (typed/replayed seed -> `run.seeded`)
  gates `unlockAchievement` and ALL career/record accrual (incl. `bestRally`).
- **Coaches** (`COACHES`, 100): 21 originals use hand-coded `fx`; 79 are pure data with a
  `gen` descriptor read by the engine's Bag/Rally/Econ dispatchers. Coaches may carry an
  `aura` and a `deluxe` edition; sell anytime for half cost (`sellCoach`).
- **Salami Cards** (`CHARMS`, 12 one-shots): `target` player/coach cards are **drag-only**
  (`onCharmPointerDown/Move/Up` -> `applyCharmToTarget`); `immediate` ones are tapped
  (confirm -> `applyImmediateCharm`). Sell anytime (`.cb-sell` -> `sellCharm`).
- **Always-on access:** `openDugoutView()` + `openSalamiView()` (both with Sell buttons)
  are reachable from EVERY screen: tappable in-game panel headers (`.panel-btn` on the
  DUGOUT/SALAMI titles, with live `x/y` counts), Deck/Dugout/Salami buttons on the map
  (`.mn-views`) and in the shop header, and Deck/Dugout/Salami tiles in the in-run menu.
  On top of that, `ownedStripHTML()` pins the whole build (every dugout + Salami slot,
  each chip sellable via `data-stripsell`, tooltip on tap) into the shop screen AND
  inside the pack-reveal overlay, Balatro-style - so a full dugout can be sold down
  WHILE a pack is open, without leaving it.
- **Make-room instead of blocking:** whenever adding a coach/Salami would overflow its
  slots (a pack pick OR a direct shop coach buy), `openMakeRoom()` offers selling a held
  item to take the new one; the blocked action retries after the sale. Player decks have
  no cap, so player-card picks never block.
- **Steals:** Send a runner from 1st/2nd (`Engine.attemptSteal`), or gamble a **steal of
  HOME** from 3rd (`fromBase 2`: long odds, scores a literal run, fuels the `steal_home`
  achievement). Caught = an out.
- **Lineups & stakes:** 15 `FRANCHISES` (themed deck + `mods` deltas applied in `newRun`)
  x 5 `STAKES` (cumulative `stakeMods`). Home screen carousel + per-lineup `crestSVG`.
- **Rosters have NO duplicate players.** `rosterIdsFor(fr)` builds each franchise's 30:
  the signature 12 plus a themed bench of unique fill players (scored by role-tag match,
  commons preferred, legends never auto-fill; deterministic per franchise, not per run).
  Prospect packs filter out players already in the deck (falling back to the full pool
  only if it runs dry), so the ONLY duplication path is the Clone Project scouting card.
  The carousel/popup stat bars average the full 30-man roster via the same helper.
- **Front Office vouchers** (`UPGRADES`, 16 base + 16 tier-2 gated by `requires`): one per
  inning in the shop (seeded by inning, survives rerolls); a Voucher Tag **appends** an
  extra one. `run.extraCardSlots` (Scouting Network line + The Scouts lineup) adds **+1
  revealed option to every pack** in `openPack`. `startRally` vouchers use `Math.max`
  so buy order can't downgrade.
- **Editions** (`EDITIONS`, 5 deluxe) on a card/coach `deluxe` field; `CONFIG.editionFx`
  drives engine hooks, `applyDeluxeToCoach` the coach aura; Legendary takes no slot
  (`dugoutUsed`). Rolled on pack options (`rollDeluxe`).
- **Action leveling** (Spring Training packs): `run.actionLevels`; each level adds
  `CONFIG.actionLevelRally` in the engine.
- **Skip Tags** (`TAGS`, 24): skipping a non-Boss frame grants a tag, **weighted by
  rarity** (`tagFor`). `when`: instant / shop (resolved by `consumeTagsIntoShop` +
  re-applied by `applyTagFxToShop` each roll) / boss (pays out in `onWin`).
- **Shop & packs:** `rollShop` offers direct-buy coaches + voucher(s) +
  `CONFIG.shop.packSlots` (2) sealed packs, each a weighted pick from
  `CONFIG.shop.packWeights`. Packs are foil bags with `packArtSVG` scenes; drag onto
  `#pack-slot` or tap to open (tear animation, then options deal out). **Packs charge on
  open**, not on pick.
- **Artwork** (`js/art.js`): all art is deterministic SVG from item ids (same id = same
  art everywhere, incl. deck copies). Player cards render a `.card-art` window
  (rarity-keyed sky: day/sunset/dusk/golden), coaches get dugout portraits, the map
  telegraph shows the pitcher (night game; boss = red menace), lineups get crests, and
  `itemArtSVG(kind, item)` paints a retro sunburst poster for every charm / voucher /
  analytics / scouting report / action (motif library + per-id scenes; voucher tier-2s
  get a gold double border). A `retroWash()` halftone finish ages every portrait.
- **Retro card skin:** player cards and the shared `retroCardHTML()` frame (`.rcard`,
  used for coaches/vouchers/Salami/scouting/analytics/actions in the shop and packs) are
  cream cardstock with colored kind/rarity banners. The Collection, Salami pouch, and
  make-room lists show art thumbs (`.col-art` / `.mr-art`). Falls back if art.js absent.
- **Game speed:** `META.speed` (1..4, default 4 = fastest). `speedScale()` scales every
  `sleep()`/`pace()` timeout and the `--gs` CSS var on `#stage` (`applySpeedVar()`)
  scales gameplay animation durations. Interaction feedback is excluded.
- **Juice:** `stampOutcome`, tiered `screenShake`, `ballFlight`, rally heat meter,
  `flashCoachById`, `tickNumber`, `confettiBurst`. All scale with `--gs`.
- **Drag:** card-to-bat, salami-to-target, pack-to-slot via document-level pointer
  handlers (`#bat-zone`, `.charm-ghost`/`.charm-zone`, `.pack-ghost`/`#pack-slot`).
- **Seeds visibility:** hidden during a run; revealed on run-end screens, copyable /
  replayable via `seedChip`.
- **Tooltips:** custom `TIP` controller; `?`-only hover on cards, tap-to-pin, touch
  suppression.

## History

Detailed change history lives in `git log` (commit messages are thorough). Don't grow a
changelog here; this file describes the CURRENT state only.
