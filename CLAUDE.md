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
`index.html` loads assets with a version query, e.g. `css/styles.css?v=16`,
`js/app.js?v=16`. **Bump every `?v=N` in `index.html` on each deploy** so returning
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
| `js/data.js` | all content + tuning: `CONFIG`, `FRANCHISES`, cards, `COACHES`, `CHARMS` (Salami Cards), `UPGRADES` (Front Office), `ACHIEVEMENTS`, `TRAITS`, `ROUNDS` |
| `js/engine.js` | pure rules: `Engine.resolveAtBat`, steals, rally math, coach effects |
| `js/app.js` | everything else: state, rendering, screens, shop, drag, save/load, overlays |
| `css/styles.css` | all styles; responsive via a scale-to-fit stage + media queries |

## Layout model

`#stage` is a fixed design surface scaled to fit the viewport via `transform: scale()`
(`stageScale()` reads the matrix). The game screen is a CSS grid (`game-main`) with
`col-field` (diamond + outs/inning), `col-summary` (play log), `col-powerups` (Salami),
`col-dugout` (coaches), and a full-width `atbat-bar`.

The **field diamond** must stay a perfect square or the percentage-positioned bases and
runner tokens drift off the infield corners. It is sized with container-query units:
`.col-field .diamond-wrap { container-type: size }` and
`.col-field .diamond { width:100cqmin; height:100cqmin }`. Bases sit at 16%/84%; runner
tokens (`.rtok`) share the same coordinate space in `#runner-layer` and walk the basepath
via a CSS `left/top` transition.

## Game model (important for "runs"/"innings" questions)

- A **run** is **9 innings** (a full baseball game; Balatro antes; `ROUNDS.length`), each with
  **3 frames** (`GAMES_PER_ROUND`): **Top / Middle / Boss**. So **27 frames** main, then **Extra
  Innings** (endless). `gameIndex` 0..26 main, 27+ extra. Helpers: `inningOf`/`frameOf`/
  `isBossInning`/`isExtraInnings`/`roundName`/`gameLabel`. Beat inning 9's Boss (frame 27) ->
  `showVictory` (confetti) with a "Play Extra Innings" continue (`run.wonWS`); leaving keeps it continuable.
- Targets come from a **formula** `targetFor(gi)` = `round(base * inningGrowth^(inning-1) *
  frameMult[frame] * scoreScale)` (`CONFIG.target`/`scoreScale`), rounded to a clean multiple of 5,
  so it extends into Extra Innings. Pitcher stuff/command scale per inning + per frame
  (`CONFIG.pitcher`). Bosses pre-rolled for 9 innings, extras via `bossFor` on demand.
- Each **"game"** object (`STATE.game`) is **one frame vs one pitcher**, with **3 outs**
  (`CONFIG.outsPerGame`; the Closer boss gives 2; the Second Wind seed adds 1).
- **`g.score` / target** ("0 / 700") is the roguelike currency = sum of **Bag value × Rally**.
  Bag (after every coach/edition bonus) and the target are both multiplied by `CONFIG.scoreScale`
  (**100**) so on-screen numbers feel grand; balance is identical (score >= target unchanged).
  Rally is the un-scaled multiplier: starts ×1.0, climbs +0.5 per safe play; an out persists rally (resets at inning end).
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
- **Salami Cards** (`CHARMS`, one-shot consumables): `target` is `player`, `coach`, or
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
- **Batch 8:** named the one-shot powerups; 49 achievements + Profile;
  animated splash; mid-inning save/resume; 8 franchises (4×2); deck/roster 30 with paginated
  deck view; dugout 2×4; card footer (trait/pos/? lower-right); equal-height shop coaches.
- Field diagram made square (cqmin); at-bat header simplified (no platoon chip, no "how do
  you swing?"); corner X replaced by a labeled **Cancel** in the tactics.
- Hide seed until run ends; spruced post-mortem; removed all em/en dashes; **Collection**
  screen + discovery tracking + Undiscovered tags; **drag** Salami cards onto players/coaches;
  coach-affecting card (Coaching Clinic aura); asset cache-busting (`?v=`).
- Scoreboard score column re-centered (`1.3fr 1.6fr 1.3fr`).
- Renamed the consumables to **Salami Cards** (panel `SALAMI`, internal identifiers stay
  `CHARMS`/`charm`); pack-based shop - Coaches and Front Office bought directly, the rest are
  sealed packs you drag (or tap) to open. `onPackPointerDown/Move/Up` handle the drag.
- **Balatro 1:1 - Phase 1 (packs):** Analytics & Scouting -> **Scouting Cards/Packs** (one
  pool of `ANALYTICS`+`SCOUTING`); player cards/packs -> **Prospect Cards/Packs**. Every pack
  family (Prospect, Scouting, Salami, Coaching) now has **Normal / Jumbo (5, pick 1) / Mega
  (5, pick 2)** sizes (`PACKS` has all 12; `rollShop` rolls a size per family, weighted by
  round). Sealed packs are now **tall card-pack art** (`.pk-wrap` art window + label band +
  Jumbo/Mega ribbon), and opening plays a **tear-open burst** (`.pack-burst`) then deals the
  cards out.
- **Balatro 1:1 - Phase 2 (run structure):** restructured to **8 innings x 3 frames** (Top /
  Middle / Boss) = 24 frames, then **Extra Innings** (endless). Targets/pitchers are formulas
  that extend forever (`targetFor`, `CONFIG.target`/`pitcher`). Win inning 8's Boss -> World
  Series victory with a "Play Extra Innings" continue. Compact **linescore** (`.linescore`,
  8 inning columns + extra), post-mortem 24-frame strip, labels reworked.
- **Balatro 1:1 - Phase 3 (lineups + stakes):** **15 lineups** (`FRANCHISES`, each with a
  themed deck + a `mods` object of deltas on already-wired run fields: payroll/dugoutSlots/
  handSize/charmSlots/extraCardSlots/rerollDiscount/startRally/noInterest/grantSalami, applied
  in `newRun`). **5 difficulty stakes** (`STAKES`, Rookie..Cooperstown); `stakeMods(stake)` ->
  cumulative `{targetMult, pitcherBonus, priceBump, handDelta}` applied in `targetFor`/
  `makePitcher`/`priceOf`/`newRun`. Stakes gate behind `META.maxStake` (win a WS at the current
  to unlock the next); `META.lineupWins` tracks best stake per lineup. Home screen is now a
  **carousel** (`renderLineupCarousel`): one lineup at a time with arrows + dots, a 5-stake
  selector, inline seed, Play Ball. `run.stake` + `run.franchiseId` define a run.
- **Balatro 1:1 - Phase 4 (editions + action leveling):** 5 deluxe **editions** on a card/
  coach `deluxe` field - All-Star (+2 Bag), Silver Slugger (+1 Rally), Gold Glove (x1.5 Rally
  that play), Hall of Fame (+2 Bag +0.5 Rally), Legendary (biggest; coach takes no slot).
  `CONFIG.editionFx` drives the engine hooks in `resolveAtBat`; coaches use `coach.aura`
  (`applyDeluxeToCoach`) and Legendary is free (`dugoutUsed`). They roll on pack card/coach
  options (`rollDeluxe`, `CONFIG.editionSpawnChance`) and render with an animated shimmer
  (`.has-dx.dx-*` + `.dx-badge`). **Action leveling** (Spring Training packs, kind "action"):
  `run.actionLevels` {swing/power/contact/bunt/steal}; each level adds `CONFIG.actionLevelRally`
  to that action's safe plays (engine) and shows a `Lv` badge on the swing buttons.
- **Balatro 1:1 - Phase 5a (coaches + vouchers):** **100 coaches** (`COACHES`). The 79 new
  ones are pure data: each carries a `gen` descriptor read by three generic dispatchers in
  `engine.js` - Bag (`gen.at:"bag"` matching `out`/`tag`/`deck`), Rally (`gen.at:"rally"`
  matching `out`/`tag`/`cond:risp|twoout|leadoff|firston`/aura), and Econ (`gen.at:"econ"`,
  pays `$amt` into `ev.payrollGained`). So new coaches need no hand-coded engine function.
  **32 Front Office vouchers** (`UPGRADES`): **16 base + 16 upgrades**. The 7 originals keep
  their `fx` switch; the rest are data-driven via `mods` (charmSlots/payroll/interestCap[Abs]/
  startRally[Add]/editionBoost/springLevel/deckStat/...) applied in `applyUpgrade`. Each
  upgrade has `requires: <baseId>` and the shop only offers it once the base is owned. The
  shop shows **one voucher per inning**, seeded by inning so it holds steady across the 3
  frames and ignores rerolls; buying it sets `run.lastVoucherInning` so the slot stays empty
  until the next inning. `run.upgradesOwned` now stores voucher **ids** (was `fx`).
- **Balatro 1:1 - Phase 5b (skip tags):** **24 skip tags** (`TAGS` in `data.js`). Skipping a
  non-Boss frame (Top/Middle) forfeits that frame's win reward and its shop and grants a tag
  instead (`isSkippable`/`tagFor`/`skipFrame`; `run.skips` counts them). Each tag has a
  `when`: **instant** resolves on skip (money, double payroll, level a random action, free
  common coaches, or a one-frame `handBonusNext`/`rallyBonusNext` consumed in `startGame`);
  **shop** waits in `run.tags` and is turned into concrete free items on the next shop visit
  (`consumeTagsIntoShop` -> `STATE.shop.tagFx`, re-applied every roll by `applyTagFxToShop`
  so free coaches/packs survive rerolls; covers free Uncommon/Rare coaches, the 5 editioned
  free coaches, a forced voucher, Coupon = coaches/vouchers free, Discount = free rerolls);
  **boss** (Investment) waits in `run.tags` and pays out in `onWin` when a Boss is beaten
  (added to the reward breakdown). The map shows the offered tag + a Skip button and a
  held-tags tray (`tagTrayHTML`); the shop badges granted items **Free**. Tags are the 4th
  **Collection** group and are discovered on earn. This completes the Balatro 1:1 master list.
- **Phase 6 (structure + juice):** run extended to **9 innings** (`INNINGS_TO_WIN`), so 27 frames.
  **100x score scale** (`CONFIG.scoreScale`): the engine multiplies the finished bag by it and
  `targetFor` multiplies the target (rounded to a clean 5), so numbers are grand and balance is
  unchanged (economy/rally not scaled; `big_swing` threshold scaled too). **Lineup carousel** cards
  are a fixed 312px-tall, `flex:1 1 0` uniform card (`overflow:hidden`). **Pack reveal modal**
  enlarged (`min(1040px,95vw)`, bigger cards, names wrap). **Pack tear-open**: the pack rips into
  two halves (`.pkb-top`/`.pkb-bot`) with a jagged `.pkb-rip` + flash, then cards deal. **Edition
  tooltips**: the `.dx-badge` carries a `data-tip` with the edition's effect. **Juice** (all CSS/JS,
  no deps): `stampOutcome` (color-coded punch-in stamp, GRAND SLAM variant), tiered `screenShake`
  (sm/big/huge), `ballFlight` (a ball arcs onto the field, path per outcome + HR flash), rally
  **heat meter** (`--heat` colour + `rally-warm/hot/blaze` glow/flame tiers), stronger `coach-icon
  .trigger` pop + ring, `tickNumber` count-up on the score, and `confettiBurst` on a run win.
- **Pack variety + speed (Balatro parity):** the shop no longer shows every pack family. `rollShop`
  rolls `CONFIG.shop.packSlots` (**2**) packs, each an independent weighted pick from
  `CONFIG.shop.packWeights` (player>scouting>charm>coach>action), so offered types vary shop to
  shop and on reroll (families can repeat). **Game speed setting** `META.speed` (1..4, default **4**
  = fastest/the original pacing): `speedScale() = 4/speed` is the delay multiplier applied in
  `sleep()` (so every gameplay pause scales) and in `tickNumber` (score count-up). The menu has a
  1x/2x/3x/4x selector (`.menu-speed`/`data-speed` -> `setSpeed`); verified 1x runs ~4x slower.
- **Speed scales ALL animations + juice fixes:** speed now drives a `--gs` CSS var on `#stage`
  (`applySpeedVar()` = `speedScale()`); gameplay durations are `calc(base * var(--gs,1))` so card
  load-in, base running (`.rtok` + `LEG_MS`), shake, stamp, ball, rally, pack tear all rescale
  (interaction feedback is excluded). JS timeouts go through `pace(ms)` (LEG_MS, setReadout display,
  popRuns, floatText, flashScreen, juice removals). **Ball flight** made visible: bigger (18px) +
  glow trail + higher z, and every arc kept inside the diamond `[0..100]%` so `col-field`'s
  `overflow:hidden` no longer clips it (the HR no longer flies to `top:-24%`). **Outcome stamp**
  typography fixed: dropped `-webkit-text-stroke` (it distorted glyphs under scale) for a clean
  drop-shadow. **Selected batter card** no longer lifts (`translateY` removed) into the swing
  buttons; differentiation is now full-opacity + gold ring + glow + subtle scale vs dimmed others.
