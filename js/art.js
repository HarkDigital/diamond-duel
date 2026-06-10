/* ============================================================
   Diamond Duel - procedural artwork (no image files, no deps)
   Deterministic SVG portraits and scenes, seeded from item ids:
     portraitSVG(card)         painted baseball-card player portrait
     coachPortraitSVG(coach)   older face, team jacket, whistle
     pitcherPortraitSVG(p)     night-game starter / menacing boss
     packArtSVG(kind)          art scene for each pack family
     crestSVG(franchise)       team crest for the lineup carousel
   Same id -> same art, every time, on every device. All randomness
   here is hash-derived (NOT the game RNG) and purely cosmetic.
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------- tiny deterministic stream from a string ---------- */
  function h32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function streamFrom(key) {
    let a = h32(String(key));
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  /* ---------- shared palettes ---------- */
  const SKIN = ["#f6d3ae", "#efc096", "#e2a878", "#cf9162", "#b97a4b", "#9a6238", "#7c4d2b"];
  const HAIR_YOUNG = ["#1d1d22", "#2e2218", "#4a3320", "#6e4a26", "#8a6a3a", "#3a2a3a"];
  const HAIR_OLD = ["#b9bcc4", "#d9d2c8", "#8e8e96", "#6e6e76"];
  // [cap main, accent] - fictional team colorways
  const TEAMS = [
    ["#15356e", "#d23c3c"], ["#a32638", "#f2d8a0"], ["#0f4f30", "#f5c344"], ["#3b2a6e", "#f2b03c"],
    ["#10626e", "#f4f0e4"], ["#7a1f1f", "#dcd6c8"], ["#21476b", "#e8762c"], ["#23252b", "#cfd6e2"],
    ["#5d3a8e", "#ffd24a"], ["#8a4f17", "#f2e2c8"], ["#0e5a4a", "#ffb14a"], ["#7a2456", "#ffd9e8"],
  ];
  const SKIES = {
    common:  ["#86b8e6", "#d8ecf9"],
    star:    ["#ef9a5a", "#fbd9a8"],
    allstar: ["#7a5fc0", "#efb6d6"],
    legend:  ["#f5c34a", "#fdedc0"],
    night:   ["#1d3250", "#0c1626"],
    boss:    ["#55121a", "#170509"],
    dugout:  ["#26384f", "#131e2e"],
  };
  function skyDef(key) {
    const s = SKIES[key] || SKIES.common;
    return `<linearGradient id="ddsky-${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s[0]}"/><stop offset="1" stop-color="${s[1]}"/></linearGradient>`;
  }
  const FIELD_DEF = `<linearGradient id="ddfield" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46a35c"/><stop offset="1" stop-color="#2a7440"/></linearGradient>`;

  function svgOpen(vw, vh, cls) {
    return `<svg class="${cls || "dd-art"}" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">`;
  }

  /* ---------- scene pieces (160x100 portrait stage) ---------- */
  function ballparkBG(r, skyKey, opts) {
    opts = opts || {};
    let s = `<rect width="160" height="100" fill="url(#ddsky-${skyKey})"/>`;
    // sun / glow + legend rays
    if (skyKey === "legend") {
      s += `<g opacity=".5">`;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = 80 + Math.cos(a) * 150, y = 34 + Math.sin(a) * 150;
        s += `<polygon points="80,34 ${x.toFixed(1)},${(y - 9).toFixed(1)} ${x.toFixed(1)},${(y + 9).toFixed(1)}" fill="#ffe9a3" opacity=".35"/>`;
      }
      s += `</g><circle cx="80" cy="34" r="17" fill="#fff3c4" opacity=".95"/>`;
    } else if (skyKey === "boss") {
      s += `<circle cx="80" cy="36" r="22" fill="#a32638" opacity=".5"/>`;
      for (let i = 0; i < 5; i++) s += `<rect x="${10 + i * 32}" y="${6 + (i % 2) * 7}" width="22" height="2.2" rx="1.1" fill="#e25555" opacity=".25" transform="rotate(-8 80 50)"/>`;
    } else if (skyKey === "night") {
      // stadium light banks
      s += `<g opacity=".9"><rect x="18" y="6" width="22" height="9" rx="2" fill="#0a1422"/><rect x="120" y="6" width="22" height="9" rx="2" fill="#0a1422"/>`;
      for (let i = 0; i < 4; i++) s += `<circle cx="${22 + i * 5}" cy="10.5" r="1.7" fill="#ffe9a3"/><circle cx="${124 + i * 5}" cy="10.5" r="1.7" fill="#ffe9a3"/>`;
      s += `<polygon points="18,15 40,15 52,46 6,46" fill="#ffe9a3" opacity=".07"/><polygon points="120,15 142,15 154,46 108,46" fill="#ffe9a3" opacity=".07"/></g>`;
    } else {
      s += `<circle cx="${24 + Math.floor(r() * 30)}" cy="${16 + Math.floor(r() * 8)}" r="10" fill="#ffffff" opacity=".55"/>`;
      s += `<ellipse cx="${110 + Math.floor(r() * 24)}" cy="${12 + Math.floor(r() * 8)}" rx="14" ry="4.5" fill="#ffffff" opacity=".5"/>`;
    }
    // crowd band + wall + field
    const crowd = opts.crowd !== false;
    if (crowd) {
      s += `<rect x="0" y="50" width="160" height="13" fill="#1c2738" opacity=".92"/>`;
      for (let i = 0; i < 16; i++) {
        s += `<circle cx="${4 + i * 10 + (r() * 4 - 2)}" cy="${53.5 + (i % 2) * 4 + r() * 2}" r="1.5" fill="${pick(r, ["#e8d8b8", "#c8d8e8", "#e8b8b8", "#b8e0c0", "#d8c8ea"])}" opacity=".6"/>`;
      }
      s += `<rect x="0" y="62" width="160" height="6" fill="#23425c"/><rect x="0" y="62" width="160" height="1.4" fill="#f5c344" opacity=".8"/>`;
    }
    s += `<rect x="0" y="${crowd ? 68 : 60}" width="160" height="${crowd ? 32 : 40}" fill="url(#ddfield)"/>`;
    s += `<polygon points="0,100 40,${crowd ? 68 : 60} 56,${crowd ? 68 : 60} 24,100" fill="#ffffff" opacity=".05"/>`;
    s += `<polygon points="96,100 120,${crowd ? 68 : 60} 136,${crowd ? 68 : 60} 120,100" fill="#ffffff" opacity=".05"/>`;
    return s;
  }

  /* ---------- the face + body generator ---------- */
  // kind: "player" | "coach" | "pitcher"
  function person(r, opts) {
    const o = opts || {};
    const cx = 80;
    const skin = o.skin || pick(r, SKIN);
    const skinEdge = "#00000022";
    const team = o.team || pick(r, TEAMS);
    const capMain = o.capMain || team[0], capAcc = o.capAccent || team[1];
    const old = !!o.old;
    const hair = o.hair || (old ? pick(r, HAIR_OLD) : (r() < 0.18 ? pick(r, HAIR_OLD) : pick(r, HAIR_YOUNG)));
    const fy = 44, fr = 16.5;                       // face center / radius
    const jaw = (o.jaw == null ? 13 + r() * 3 : o.jaw);
    const eyeStyle = o.eyeStyle || pick(r, ["round", "focus", "squint"]);
    const mouth = o.mouth || pick(r, ["smile", "flat", "grit"]);
    const facialP = o.facialP == null ? (old ? 0.6 : 0.32) : o.facialP;
    const facial = r() < facialP ? pick(r, ["stache", "goatee", "full"]) : "none";
    const eyeBlack = !!o.eyeBlack && r() < 0.5;
    const glasses = !!o.glasses && r() < 0.55;
    const capY = fy - fr * 0.62;

    let s = "";

    /* bat behind the shoulder (players with pop) */
    if (o.bat) {
      s += `<g><line x1="${cx + 12}" y1="86" x2="${cx + 38}" y2="30" stroke="#8a6134" stroke-width="7.5" stroke-linecap="round"/>`;
      s += `<line x1="${cx + 12}" y1="86" x2="${cx + 38}" y2="30" stroke="#c89a5e" stroke-width="5.5" stroke-linecap="round"/>`;
      s += `<circle cx="${cx + 12}" cy="86" r="3.4" fill="#a87b44"/></g>`;
    }

    /* torso */
    const jerseyKind = o.jerseyKind || pick(r, ["home", "home", "grey", "alt"]);
    const jersey = jerseyKind === "home" ? "#f2efe6" : jerseyKind === "grey" ? "#d7dbe2" : capMain;
    const onJersey = jerseyKind === "alt" ? capAcc : capMain;
    s += `<path d="M ${cx - 31} 100 Q ${cx - 27} 73 ${cx - 13} 67.5 L ${cx} 72 L ${cx + 13} 67.5 Q ${cx + 27} 73 ${cx + 31} 100 Z" fill="${jersey}" stroke="#00000033" stroke-width="1"/>`;
    if (o.jacket) {
      // coach windbreaker: solid team color + zipper + high collar
      s += `<path d="M ${cx - 31} 100 Q ${cx - 27} 73 ${cx - 13} 67.5 L ${cx} 72 L ${cx + 13} 67.5 Q ${cx + 27} 73 ${cx + 31} 100 Z" fill="${capMain}" stroke="#00000044" stroke-width="1"/>`;
      s += `<line x1="${cx}" y1="72" x2="${cx}" y2="100" stroke="${capAcc}" stroke-width="1.6"/>`;
      s += `<path d="M ${cx - 13} 67.5 L ${cx - 8} 74 L ${cx} 72" fill="none" stroke="${capAcc}" stroke-width="2"/>`;
      s += `<path d="M ${cx + 13} 67.5 L ${cx + 8} 74 L ${cx} 72" fill="none" stroke="${capAcc}" stroke-width="2"/>`;
      // whistle
      s += `<path d="M ${cx - 6} 73 Q ${cx - 12} 82 ${cx - 8} 88" fill="none" stroke="#d9d2c8" stroke-width="1.1"/><circle cx="${cx - 8}" cy="89.5" r="3.4" fill="${capAcc}" stroke="#00000055" stroke-width=".8"/><circle cx="${cx - 9}" cy="90.5" r="1" fill="#00000066"/>`;
    } else {
      if (jerseyKind === "home") { // pinstripes
        for (let i = -3; i <= 3; i++) s += `<line x1="${cx + i * 7}" y1="70" x2="${cx + i * 7.6}" y2="100" stroke="${capMain}" stroke-width=".9" opacity=".28"/>`;
      }
      // collar + placket + buttons
      s += `<path d="M ${cx - 13} 67.5 L ${cx} 75 L ${cx + 13} 67.5" fill="none" stroke="${onJersey}" stroke-width="2.2"/>`;
      s += `<line x1="${cx}" y1="75" x2="${cx}" y2="100" stroke="${onJersey}" stroke-width="1.2" opacity=".8"/>`;
      s += `<circle cx="${cx}" cy="82" r=".9" fill="${onJersey}"/><circle cx="${cx}" cy="90" r=".9" fill="${onJersey}"/>`;
      if (o.number != null) s += `<text x="${cx + 17}" y="92" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="900" fill="${onJersey}" opacity=".95">${o.number}</text>`;
    }

    /* glove + ball (pitchers) */
    if (o.glove) {
      s += `<g><circle cx="${cx - 26}" cy="76" r="9.5" fill="#8a5430" stroke="#5e3a20" stroke-width="1.2"/>`;
      s += `<path d="M ${cx - 33} 72 q 7 -6 14 0" fill="none" stroke="#5e3a20" stroke-width="1.1"/>`;
      s += `<circle cx="${cx - 23}" cy="70.5" r="4.2" fill="#f4f0e4" stroke="#cbb88f" stroke-width=".7"/>`;
      s += `<path d="M ${cx - 25.5} 68.5 q 2.5 2 5 0 M ${cx - 25.5} 72.5 q 2.5 -2 5 0" fill="none" stroke="#d23c3c" stroke-width=".7"/></g>`;
    }

    /* neck + head */
    s += `<rect x="${cx - 5.5}" y="${fy + fr - 5}" width="11" height="9" rx="2" fill="${skin}" stroke="${skinEdge}" stroke-width=".8"/>`;
    s += `<circle cx="${cx - fr - 1.5}" cy="${fy + 2}" r="3.1" fill="${skin}"/><circle cx="${cx + fr + 1.5}" cy="${fy + 2}" r="3.1" fill="${skin}"/>`;
    s += `<circle cx="${cx}" cy="${fy}" r="${fr}" fill="${skin}"/>`;
    s += `<ellipse cx="${cx}" cy="${fy + fr * 0.42}" rx="${jaw}" ry="${fr * 0.66}" fill="${skin}"/>`;

    /* age lines */
    if (old) s += `<path d="M ${cx - 7} ${fy + 9} q 2 1.6 4 0 M ${cx + 3} ${fy + 9} q 2 1.6 4 0" fill="none" stroke="#00000033" stroke-width=".9"/>`;

    /* sideburns / fringe under the cap */
    s += `<path d="M ${cx - fr + 1} ${fy - 4} q -1 6 1 10 l 3 0 q -1.6 -5 -.8 -10 Z" fill="${hair}" opacity=".95"/>`;
    s += `<path d="M ${cx + fr - 1} ${fy - 4} q 1 6 -1 10 l -3 0 q 1.6 -5 .8 -10 Z" fill="${hair}" opacity=".95"/>`;

    /* eye black */
    if (eyeBlack) s += `<rect x="${cx - 9.5}" y="${fy + 2.6}" width="5.4" height="2" rx="1" fill="#222" opacity=".85" transform="rotate(6 ${cx - 7} ${fy + 3.6})"/><rect x="${cx + 4.1}" y="${fy + 2.6}" width="5.4" height="2" rx="1" fill="#222" opacity=".85" transform="rotate(-6 ${cx + 7} ${fy + 3.6})"/>`;

    /* eyes + brows */
    const ey = fy - 0.5;
    const browTilt = (r() * 5 - 2.5).toFixed(1);
    if (eyeStyle === "squint") {
      s += `<path d="M ${cx - 10} ${ey} q 3 1.8 6 0" fill="none" stroke="#27201c" stroke-width="1.7" stroke-linecap="round"/>`;
      s += `<path d="M ${cx + 4} ${ey} q 3 1.8 6 0" fill="none" stroke="#27201c" stroke-width="1.7" stroke-linecap="round"/>`;
    } else {
      const ry = eyeStyle === "round" ? 2.9 : 2.1;
      s += `<ellipse cx="${cx - 7}" cy="${ey}" rx="2.9" ry="${ry}" fill="#fff"/><ellipse cx="${cx + 7}" cy="${ey}" rx="2.9" ry="${ry}" fill="#fff"/>`;
      s += `<circle cx="${cx - 6.6}" cy="${ey + 0.3}" r="1.35" fill="#27201c"/><circle cx="${cx + 7.4}" cy="${ey + 0.3}" r="1.35" fill="#27201c"/>`;
    }
    s += `<line x1="${cx - 10.5}" y1="${ey - 4.6}" x2="${cx - 3.5}" y2="${ey - 4.6}" stroke="#27201c" stroke-width="1.6" stroke-linecap="round" transform="rotate(${browTilt} ${cx - 7} ${ey - 4.6})"/>`;
    s += `<line x1="${cx + 3.5}" y1="${ey - 4.6}" x2="${cx + 10.5}" y2="${ey - 4.6}" stroke="#27201c" stroke-width="1.6" stroke-linecap="round" transform="rotate(${-browTilt} ${cx + 7} ${ey - 4.6})"/>`;
    if (glasses) {
      s += `<g stroke="#1c232e" stroke-width="1.1" fill="none"><circle cx="${cx - 7}" cy="${ey}" r="4.6"/><circle cx="${cx + 7}" cy="${ey}" r="4.6"/><line x1="${cx - 2.4}" y1="${ey}" x2="${cx + 2.4}" y2="${ey}"/></g>`;
    }

    /* nose + mouth */
    s += `<path d="M ${cx} ${ey + 2.5} q -1.6 3.8 1.2 5" fill="none" stroke="#00000044" stroke-width="1.1" stroke-linecap="round"/>`;
    const my = fy + 10.5;
    if (mouth === "smile") s += `<path d="M ${cx - 4.6} ${my} q 4.6 3.6 9.2 0" fill="none" stroke="#5e2a22" stroke-width="1.5" stroke-linecap="round"/>`;
    else if (mouth === "grit") s += `<rect x="${cx - 4.6}" y="${my - 1.2}" width="9.2" height="2.8" rx="1.2" fill="#fff" stroke="#5e2a22" stroke-width=".9"/>`;
    else s += `<line x1="${cx - 3.8}" y1="${my}" x2="${cx + 3.8}" y2="${my}" stroke="#5e2a22" stroke-width="1.5" stroke-linecap="round"/>`;

    /* facial hair */
    if (facial === "stache") s += `<path d="M ${cx - 5.5} ${my - 2.6} q 5.5 -3 11 0 q -2.6 1.8 -5.5 1.6 q -2.9 .2 -5.5 -1.6 Z" fill="${hair}"/>`;
    else if (facial === "goatee") s += `<path d="M ${cx - 4} ${my + 1.6} q 4 4.6 8 0 q -1 4.8 -4 4.8 q -3 0 -4 -4.8 Z" fill="${hair}"/>`;
    else if (facial === "full") s += `<path d="M ${cx - 11} ${fy + 4} q 0 12 11 12.5 q 11 -.5 11 -12.5 q -1.5 9 -11 9 q -9.5 0 -11 -9 Z" fill="${hair}" opacity=".96"/>`;

    /* cap (dome + seams + button + straight brim + logo) */
    s += `<path d="M ${cx - 17.4} ${capY} a 17.4 16 0 0 1 34.8 0 Z" fill="${capMain}" stroke="#00000044" stroke-width="1"/>`;
    s += `<path d="M ${cx} ${capY - 15.6} v 15.2 M ${cx - 9.5} ${capY - 12.4} q 1.8 6 1.4 12 M ${cx + 9.5} ${capY - 12.4} q -1.8 6 -1.4 12" fill="none" stroke="#00000033" stroke-width=".9"/>`;
    s += `<circle cx="${cx}" cy="${capY - 15.8}" r="1.4" fill="${capAcc}"/>`;
    s += `<rect x="${cx - 19.5}" y="${capY - 0.6}" width="39" height="4.6" rx="2.3" fill="${capMain}" stroke="#00000055" stroke-width=".8"/>`;
    s += `<path d="M ${cx - 3.4} ${capY - 9.8} L ${cx} ${capY - 3.4} L ${cx + 3.4} ${capY - 9.8} M ${cx - 1.7} ${capY - 6.6} h 3.4" fill="none" stroke="${capAcc}" stroke-width="1.5" stroke-linecap="round"/>`;

    return s;
  }

  /* ============================================================
     PLAYER portrait (baseball card)
     ============================================================ */
  function portraitSVG(c) {
    const id = (c && (c.id || c.name)) || "mystery";
    const r = streamFrom("p:" + id);
    const tags = (c && c.tags) || [];
    const has = (t) => tags.indexOf(t) >= 0;
    const skyKey = c && c.rarity === "legend" ? "legend" : c && c.rarity === "allstar" ? "allstar" : c && c.rarity === "star" ? "star" : "common";
    const jaw = 13 + (has("slugger") ? 3.2 : 0) - (has("speedster") ? 1.8 : 0) + r() * 2.2;
    let out = svgOpen(160, 100, "dd-art dd-portrait");
    out += `<defs>${skyDef(skyKey)}${FIELD_DEF}</defs>`;
    out += ballparkBG(r, skyKey);
    out += person(r, {
      jaw,
      old: has("veteran"),
      eyeBlack: has("speedster") || has("contact") || has("table-setter"),
      bat: has("slugger") || (c && c.power >= 58),
      facialP: has("veteran") ? 0.6 : has("rookie") ? 0.12 : 0.32,
      number: 1 + Math.floor(r() * 52),
    });
    if (skyKey === "legend") out += `<rect width="160" height="100" fill="none" stroke="#f5c344" stroke-width="3" opacity=".55"/>`;
    return out + "</svg>";
  }

  /* ============================================================
     COACH portrait (dugout, jacket, whistle)
     ============================================================ */
  function coachPortraitSVG(co) {
    const id = (co && (co.id || co.name)) || "coach";
    const r = streamFrom("co:" + id);
    let out = svgOpen(160, 100, "dd-art dd-coach");
    out += `<defs>${skyDef("dugout")}${FIELD_DEF}</defs>`;
    // dugout interior: wall, bench rail, bat rack
    out += `<rect width="160" height="100" fill="url(#ddsky-dugout)"/>`;
    out += `<rect x="0" y="58" width="160" height="3" fill="#0c1422" opacity=".9"/><rect x="0" y="61" width="160" height="39" fill="#1a2738"/>`;
    for (let i = 0; i < 4; i++) out += `<line x1="${108 + i * 9}" y1="22" x2="${112 + i * 9}" y2="58" stroke="#c89a5e" stroke-width="3.4" stroke-linecap="round" opacity=".75"/>`;
    out += `<rect x="102" y="18" width="46" height="4" rx="2" fill="#0c1422" opacity=".8"/>`;
    out += `<rect x="10" y="26" width="30" height="20" rx="2" fill="#10314a" stroke="#23425c" stroke-width="1.4" opacity=".9"/><path d="M 13 42 l 7 -8 5 4 6 -7 6 9" fill="none" stroke="#7fd0a0" stroke-width="1.6"/>`;
    out += person(r, {
      old: true,
      jacket: true,
      glasses: true,
      facialP: 0.66,
      eyeStyle: pick(r, ["focus", "squint", "round"]),
      mouth: pick(r, ["flat", "grit", "smile"]),
    });
    return out + "</svg>";
  }

  /* ============================================================
     PITCHER portrait (matchup telegraph): starter vs BOSS
     ============================================================ */
  function pitcherPortraitSVG(p) {
    const boss = !!(p && p.isBoss);
    const key = (p && p.name) || "pitcher";
    const r = streamFrom("pit:" + key + ":" + (p && p.rule || ""));
    let out = svgOpen(160, 100, "dd-art dd-pitcher" + (boss ? " is-boss" : ""));
    out += `<defs>${skyDef(boss ? "boss" : "night")}${FIELD_DEF}</defs>`;
    out += ballparkBG(r, boss ? "boss" : "night");
    out += person(r, {
      glove: true,
      jerseyKind: boss ? "alt" : "grey",
      team: boss ? ["#1a1216", "#d23c3c"] : undefined,
      eyeStyle: boss ? "squint" : undefined,
      mouth: boss ? pick(r, ["flat", "grit"]) : undefined,
      facialP: boss ? 0.7 : 0.35,
      old: boss ? r() < 0.5 : false,
    });
    if (boss) out += `<rect width="160" height="100" fill="none" stroke="#d23c3c" stroke-width="3" opacity=".5"/>`;
    return out + "</svg>";
  }

  /* ============================================================
     PACK ART - a painted scene per family (sits in the foil window)
     ============================================================ */
  function packArtSVG(kind) {
    const r = streamFrom("pk:" + kind);
    let s = svgOpen(100, 72, "dd-art dd-pack");
    s += `<defs>${FIELD_DEF}</defs>`;
    if (kind === "player") {
      // a prospect rising: silhouette batter under a giant star
      s += `<rect width="100" height="72" fill="#173a63"/>`;
      s += `<circle cx="50" cy="30" r="24" fill="#2f7ec0" opacity=".55"/>`;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; s += `<line x1="50" y1="26" x2="${(50 + Math.cos(a) * 34).toFixed(1)}" y2="${(26 + Math.sin(a) * 34).toFixed(1)}" stroke="#bfe3ff" stroke-width="1.4" opacity=".4"/>`; }
      s += `<polygon points="50,10 54.4,21.4 66,21.8 56.9,29 60,40.5 50,33.8 40,40.5 43.1,29 34,21.8 45.6,21.4" fill="#ffd24a" stroke="#a87b1f" stroke-width="1.2"/>`;
      s += `<rect x="0" y="52" width="100" height="20" fill="url(#ddfield)"/>`;
      // batter silhouette mid-swing
      s += `<g fill="#0c1c30"><circle cx="46" cy="40" r="5"/><path d="M 41 45 q 5 -3 10 0 l 3 12 q -8 4 -16 0 Z"/><line x1="52" y1="42" x2="68" y2="30" stroke="#0c1c30" stroke-width="3.4" stroke-linecap="round"/></g>`;
    } else if (kind === "scouting") {
      // the all-seeing scout's eye over the diamond
      s += `<rect width="100" height="72" fill="#0e3424"/>`;
      s += `<circle cx="50" cy="32" r="26" fill="none" stroke="#7fd0a0" stroke-width="1.2" opacity=".5"/><circle cx="50" cy="32" r="18" fill="none" stroke="#7fd0a0" stroke-width="1" opacity=".35"/>`;
      s += `<path d="M 22 32 q 28 -22 56 0 q -28 22 -56 0 Z" fill="#e9f7ee" stroke="#1d5d30" stroke-width="1.6"/>`;
      s += `<circle cx="50" cy="32" r="8.4" fill="#2faa6f"/><circle cx="50" cy="32" r="3.6" fill="#0c2417"/><circle cx="52.6" cy="29.6" r="1.4" fill="#fff"/>`;
      s += `<rect x="0" y="54" width="100" height="18" fill="url(#ddfield)"/>`;
      s += `<rect x="42" y="56.5" width="16" height="13" fill="#cf9162" transform="rotate(45 50 63)"/><rect x="46.4" y="60.5" width="7.2" height="5.8" fill="#e9f7ee" transform="rotate(45 50 63)"/>`;
    } else if (kind === "charm") {
      // the lucky salami: a fat slice with marbling + sparkles
      s += `<rect width="100" height="72" fill="#2a1145"/>`;
      s += `<circle cx="50" cy="36" r="26" fill="#8a3043" stroke="#5e1d2c" stroke-width="3.5"/>`;
      s += `<circle cx="50" cy="36" r="21.5" fill="#c05a62"/>`;
      let sp = streamFrom("salami");
      for (let i = 0; i < 16; i++) { const a = sp() * 6.283, d = sp() * 17; s += `<circle cx="${(50 + Math.cos(a) * d).toFixed(1)}" cy="${(36 + Math.sin(a) * d).toFixed(1)}" r="${(1 + sp() * 1.8).toFixed(1)}" fill="#f2d8c8" opacity=".92"/>`; }
      s += `<path d="M 14 14 l 2.2 4.6 4.6 2.2 -4.6 2.2 -2.2 4.6 -2.2 -4.6 -4.6 -2.2 4.6 -2.2 Z" fill="#ffd24a"/>`;
      s += `<path d="M 84 48 l 1.8 3.8 3.8 1.8 -3.8 1.8 -1.8 3.8 -1.8 -3.8 -3.8 -1.8 3.8 -1.8 Z" fill="#f0e2ff"/>`;
      s += `<path d="M 78 12 l 1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4 Z" fill="#f0e2ff" opacity=".8"/>`;
    } else if (kind === "coach") {
      // chalkboard play + whistle
      s += `<rect width="100" height="72" fill="#241509"/>`;
      s += `<rect x="10" y="8" width="80" height="44" rx="3" fill="#1d3a2a" stroke="#c89a5e" stroke-width="2.5"/>`;
      s += `<path d="M 22 42 Q 36 18 50 30 T 80 20" fill="none" stroke="#f4f0e4" stroke-width="1.6" stroke-dasharray="3.5 2.6"/>`;
      s += `<polygon points="80,20 73.6,19.4 77,25" fill="#f4f0e4"/>`;
      s += `<circle cx="24" cy="42" r="3" fill="none" stroke="#ffd24a" stroke-width="1.6"/>`;
      s += `<path d="M 60 36 l 5 5 M 65 36 l -5 5" stroke="#ff8a5c" stroke-width="1.8" stroke-linecap="round"/>`;
      s += `<path d="M 38 56 q 8 8 20 4" fill="none" stroke="#d9d2c8" stroke-width="1.4"/>`;
      s += `<circle cx="60" cy="59" r="6" fill="#cf7e34" stroke="#5e3a20" stroke-width="1.4"/><circle cx="58" cy="61" r="1.6" fill="#241509"/>`;
    } else { // action / spring training
      s += `<rect width="100" height="72" fill="#1c3c5e"/>`;
      s += `<circle cx="72" cy="18" r="11" fill="#ffd24a"/><circle cx="72" cy="18" r="15" fill="#ffd24a" opacity=".3"/>`;
      s += `<rect x="0" y="50" width="100" height="22" fill="url(#ddfield)"/>`;
      // palm tree
      s += `<path d="M 18 52 q 2 -16 0 -24" fill="none" stroke="#8a5430" stroke-width="3.2" stroke-linecap="round"/>`;
      s += `<path d="M 18 28 q -10 -6 -16 0 q 8 1 16 2 M 18 28 q 10 -6 16 0 q -8 1 -16 2 M 18 28 q -2 -10 4 -14 q 0 8 -2 14 M 18 28 q 2 -10 -4 -14 q 0 8 2 14" fill="#2faa6f"/>`;
      // flying ball + speed lines
      s += `<circle cx="56" cy="34" r="6.5" fill="#f4f0e4" stroke="#cbb88f" stroke-width="1"/>`;
      s += `<path d="M 52.5 31 q 3.5 3 7 0 M 52.5 37 q 3.5 -3 7 0" fill="none" stroke="#d23c3c" stroke-width="1"/>`;
      s += `<line x1="34" y1="30" x2="46" y2="32" stroke="#fff" stroke-width="1.6" opacity=".6" stroke-linecap="round"/><line x1="32" y1="36" x2="45" y2="37" stroke="#fff" stroke-width="1.6" opacity=".45" stroke-linecap="round"/>`;
    }
    return s + "</svg>";
  }

  /* ============================================================
     TEAM CREST (lineup carousel)
     ============================================================ */
  function crestSVG(f) {
    const id = (f && f.id) || "team";
    const r = streamFrom("cr:" + id);
    const team = pick(r, TEAMS);
    const main = team[0], acc = team[1];
    const words = String((f && f.name) || "DD").replace(/^The\s+/i, "").split(/\s+/);
    const initials = words.slice(0, 2).map((w) => (w[0] || "").toUpperCase()).join("");
    let s = svgOpen(64, 72, "dd-art dd-crest");
    s += `<path d="M32 3 L59 11 V37 Q59 57 32 69 Q5 57 5 37 V11 Z" fill="${main}" stroke="#0a0f1c" stroke-width="2"/>`;
    s += `<path d="M32 7 L55 14 V36.5 Q55 54 32 64.6 Q9 54 9 36.5 V14 Z" fill="none" stroke="${acc}" stroke-width="1.6" opacity=".9"/>`;
    s += `<path d="M 5 26 L 59 14 L 59 22 L 5 34 Z" fill="${acc}" opacity=".28"/>`;
    s += `<text x="32" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="900" fill="#ffffff" stroke="#0a0f1c" stroke-width=".8" paint-order="stroke">${initials}</text>`;
    s += `<rect x="27.7" y="46.8" width="8.6" height="8.6" fill="${acc}" transform="rotate(45 32 51)"/>`;
    s += `<circle cx="17" cy="13.6" r="1.6" fill="${acc}"/><circle cx="32" cy="10.4" r="1.6" fill="${acc}"/><circle cx="47" cy="13.6" r="1.6" fill="${acc}"/>`;
    return s + "</svg>";
  }

  global.portraitSVG = portraitSVG;
  global.coachPortraitSVG = coachPortraitSVG;
  global.pitcherPortraitSVG = pitcherPortraitSVG;
  global.packArtSVG = packArtSVG;
  global.crestSVG = crestSVG;
})(window);
