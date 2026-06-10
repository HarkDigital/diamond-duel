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
  // shared halftone dot pattern (identical content everywhere, so the duplicate ids are safe)
  const HALFTONE_DEF = `<pattern id="ddht4" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".62" fill="#3a2a14" opacity=".5"/></pattern>`;
  // vintage print finish: warm wash + halftone dots over any scene
  function retroWash(w, h) {
    return `<rect width="${w}" height="${h}" fill="#f0c070" opacity=".13"/>`
      + `<rect width="${w}" height="${h}" fill="url(#ddht4)" opacity=".30"/>`;
  }

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
    out += `<defs>${skyDef(skyKey)}${FIELD_DEF}${HALFTONE_DEF}</defs>`;
    out += ballparkBG(r, skyKey);
    out += person(r, {
      jaw,
      old: has("veteran"),
      eyeBlack: has("speedster") || has("contact") || has("table-setter"),
      bat: has("slugger") || (c && c.power >= 58),
      facialP: has("veteran") ? 0.6 : has("rookie") ? 0.12 : 0.32,
      number: 1 + Math.floor(r() * 52),
    });
    out += retroWash(160, 100);
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
    out += `<defs>${skyDef("dugout")}${FIELD_DEF}${HALFTONE_DEF}</defs>`;
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
    out += retroWash(160, 100);
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
    out += `<defs>${skyDef(boss ? "boss" : "night")}${FIELD_DEF}${HALFTONE_DEF}</defs>`;
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
    out += retroWash(160, 100);
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
     ITEM ART - retro illustrated cards for everything that isn't
     a person: Salami Cards, Front Office vouchers, Scouting and
     Analytics reports, and Spring Training actions. Each gets a
     sunburst poster scene built from the motif library below.
     ============================================================ */
  const INK = "#3a2a14";
  /* ---- motif library (small prop drawings, all strings) ---- */
  function mBall(x, y, r) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#f7f1e2" stroke="#b9a478" stroke-width="${Math.max(1, r * 0.12)}"/>`
      + `<path d="M ${x - r * 0.55} ${y - r * 0.62} q ${r * 0.5} ${r * 0.62} 0 ${r * 1.24} M ${x + r * 0.55} ${y - r * 0.62} q ${-r * 0.5} ${r * 0.62} 0 ${r * 1.24}" fill="none" stroke="#c43c30" stroke-width="${Math.max(1, r * 0.12)}"/>`;
  }
  function mBat(x, y, len, rot, w) {
    w = w || 7;
    return `<g transform="rotate(${rot} ${x} ${y})"><line x1="${x}" y1="${y}" x2="${x}" y2="${y - len}" stroke="#6e451f" stroke-width="${w + 2.5}" stroke-linecap="round"/>`
      + `<line x1="${x}" y1="${y - 1}" x2="${x}" y2="${y - len + 1}" stroke="#c89a5e" stroke-width="${w}" stroke-linecap="round"/>`
      + `<circle cx="${x}" cy="${y}" r="${w * 0.62}" fill="#8a5a28"/></g>`;
  }
  function mStar(x, y, r, fill) {
    let p = "";
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; p += `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)} `; }
    return `<polygon points="${p}" fill="${fill || "#ffd24a"}" stroke="${INK}" stroke-width="1.4"/>`;
  }
  function mPlate(x, y, w) {
    const h = w * 0.92;
    return `<path d="M ${x - w / 2} ${y} h ${w} v ${h * 0.45} L ${x} ${y + h} L ${x - w / 2} ${y + h * 0.45} Z" fill="#f7f1e2" stroke="${INK}" stroke-width="1.6"/>`;
  }
  function mBag(x, y, w) {
    return `<rect x="${x - w / 2}" y="${y - w / 2}" width="${w}" height="${w}" rx="${w * 0.14}" fill="#f7f1e2" stroke="${INK}" stroke-width="1.6" transform="rotate(45 ${x} ${y})"/>`;
  }
  function mBolt(x, y, s, fill) {
    return `<polygon points="${x + 0.1 * s},${y - 0.5 * s} ${x - 0.26 * s},${y + 0.08 * s} ${x - 0.02 * s},${y + 0.08 * s} ${x - 0.1 * s},${y + 0.5 * s} ${x + 0.3 * s},${y - 0.06 * s} ${x + 0.04 * s},${y - 0.06 * s}" fill="${fill || "#ffd24a"}" stroke="${INK}" stroke-width="1.4"/>`;
  }
  function mCoin(x, y, r) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#f2c14a" stroke="#8a6414" stroke-width="${Math.max(1.2, r * 0.14)}"/><circle cx="${x}" cy="${y}" r="${r * 0.68}" fill="none" stroke="#8a6414" stroke-width="1"/>`
      + `<text x="${x}" y="${y + r * 0.42}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${r * 1.15}" font-weight="900" fill="#8a6414">$</text>`;
  }
  function mCapM(x, y, s, c1, c2) {
    return `<path d="M ${x - s} ${y} a ${s} ${s * 0.92} 0 0 1 ${s * 2} 0 Z" fill="${c1}" stroke="${INK}" stroke-width="1.4"/>`
      + `<rect x="${x - s * 1.12}" y="${y - 1}" width="${s * 2.24}" height="${s * 0.26}" rx="${s * 0.13}" fill="${c1}" stroke="${INK}" stroke-width="1.1"/>`
      + `<circle cx="${x}" cy="${y - s * 0.9}" r="${s * 0.1}" fill="${c2}"/>`;
  }
  function mPennant(x, y, w, color, flip) {
    const dir = flip ? -1 : 1;
    return `<path d="M ${x} ${y} l ${dir * w} ${w * 0.18} l ${-dir * w} ${w * 0.2} Z" fill="${color}" stroke="${INK}" stroke-width="1.3"/><line x1="${x}" y1="${y - 2}" x2="${x}" y2="${y + w * 0.44}" stroke="${INK}" stroke-width="1.6"/>`;
  }
  function mCardM(x, y, w, h, rot, face) {
    return `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2.5" fill="#f7f1e2" stroke="${INK}" stroke-width="1.5"/>`
      + (face !== false ? `<rect x="${x - w / 2 + 2.5}" y="${y - h / 2 + 2.5}" width="${w - 5}" height="${h * 0.46}" rx="1.5" fill="#9bc4e8" stroke="${INK}" stroke-width=".8"/>`
        + `<line x1="${x - w / 2 + 3}" y1="${y + h * 0.16}" x2="${x + w / 2 - 3}" y2="${y + h * 0.16}" stroke="${INK}" stroke-width="1" opacity=".55"/>`
        + `<line x1="${x - w / 2 + 3}" y1="${y + h * 0.3}" x2="${x + w / 2 - 6}" y2="${y + h * 0.3}" stroke="${INK}" stroke-width="1" opacity=".35"/>` : "")
      + `</g>`;
  }
  function mWhistleM(x, y, s, color) {
    return `<rect x="${x - s * 0.2}" y="${y - s * 0.66}" width="${s * 0.9}" height="${s * 0.42}" rx="${s * 0.12}" fill="${color}" stroke="${INK}" stroke-width="1.4"/>`
      + `<circle cx="${x}" cy="${y}" r="${s * 0.52}" fill="${color}" stroke="${INK}" stroke-width="1.4"/><circle cx="${x - s * 0.12}" cy="${y + s * 0.1}" r="${s * 0.14}" fill="${INK}"/>`
      + `<path d="M ${x + s * 0.7} ${y - s * 0.78} q ${s * 0.5} ${s * 0.1} ${s * 0.42} ${s * 0.5}" fill="none" stroke="${INK}" stroke-width="1.2" opacity=".6"/>`;
  }
  function mCleat(x, y, s, color, wings) {
    let g = `<path d="M ${x - s} ${y} q 0 -${s * 0.62} ${s * 0.5} -${s * 0.62} l ${s * 0.55} ${s * 0.06} q ${s * 0.36} ${s * 0.04} ${s * 0.5} ${s * 0.3} l ${s * 0.45} ${s * 0.26} h ${-s * 2} Z" fill="${color}" stroke="${INK}" stroke-width="1.5"/>`
      + `<rect x="${x - s}" y="${y}" width="${s * 2}" height="${s * 0.2}" fill="#f7f1e2" stroke="${INK}" stroke-width="1.2"/>`;
    for (let i = 0; i < 4; i++) g += `<rect x="${x - s * 0.82 + i * s * 0.5}" y="${y + s * 0.2}" width="${s * 0.14}" height="${s * 0.2}" fill="${INK}"/>`;
    if (wings) g += `<path d="M ${x - s * 0.94} ${y - s * 0.5} q -${s * 0.7} -${s * 0.34} -${s * 1.05} -${s * 0.05} q ${s * 0.42} ${s * 0.06} ${s * 0.6} ${s * 0.3} q -${s * 0.5} -${s * 0.08} -${s * 0.74} ${s * 0.12} q ${s * 0.45} ${s * 0.12} ${s * 0.75} ${s * 0.2} Z" fill="#f7f1e2" stroke="${INK}" stroke-width="1.2"/>`;
    return g;
  }
  function mArrowUp(x, y, s, color) {
    return `<path d="M ${x} ${y - s} l ${s * 0.62} ${s * 0.7} h ${-s * 0.32} v ${s * 1.0} h ${-s * 0.6} v ${-s * 1.0} h ${-s * 0.32} Z" fill="${color || "#5ad17a"}" stroke="${INK}" stroke-width="1.4"/>`;
  }
  function mSwooshes(x, y, s) {
    return `<path d="M ${x - s} ${y - 4} h ${s * 0.8} M ${x - s * 1.2} ${y + 1} h ${s * 0.95} M ${x - s * 0.9} ${y + 6} h ${s * 0.7}" stroke="#f7f1e2" stroke-width="2" stroke-linecap="round" opacity=".85"/>`;
  }
  function mEyeM(x, y, s) {
    return `<path d="M ${x - s} ${y} q ${s} -${s * 0.78} ${s * 2} 0 q -${s} ${s * 0.78} -${s * 2} 0 Z" fill="#f7f1e2" stroke="${INK}" stroke-width="1.5"/>`
      + `<circle cx="${x}" cy="${y}" r="${s * 0.34}" fill="#2f7ec0" stroke="${INK}" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="${s * 0.14}" fill="${INK}"/>`;
  }
  function mGlassM(x, y, s) {
    return `<circle cx="${x}" cy="${y}" r="${s}" fill="rgba(190,228,255,.4)" stroke="${INK}" stroke-width="2.2"/>`
      + `<line x1="${x + s * 0.72}" y1="${y + s * 0.72}" x2="${x + s * 1.5}" y2="${y + s * 1.5}" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
  }
  function mFlameM(x, y, s, c1, c2) {
    return `<path d="M ${x} ${y - s} q ${s * 0.7} ${s * 0.55} ${s * 0.42} ${s * 1.1} a ${s * 0.62} ${s * 0.62} 0 1 1 -${s * 0.84} 0 q -${s * 0.28} -${s * 0.55} ${s * 0.42} -${s * 1.1} Z" fill="${c1 || "#e8762c"}" stroke="${INK}" stroke-width="1.4"/>`
      + `<path d="M ${x} ${y - s * 0.34} q ${s * 0.3} ${s * 0.3} ${s * 0.16} ${s * 0.56} a ${s * 0.3} ${s * 0.3} 0 1 1 -${s * 0.32} 0 q -${s * 0.14} -${s * 0.26} ${s * 0.16} -${s * 0.56} Z" fill="${c2 || "#ffd24a"}"/>`;
  }
  function mSack(x, y, s) {
    return `<path d="M ${x - s * 0.7} ${y + s * 0.5} a ${s * 0.74} ${s * 0.7} 0 1 1 ${s * 1.4} 0 Z" fill="#c9a04a" stroke="${INK}" stroke-width="1.5"/>`
      + `<path d="M ${x - s * 0.26} ${y - s * 0.62} q ${s * 0.26} -${s * 0.3} ${s * 0.52} 0 l ${s * 0.1} ${s * 0.2} q -${s * 0.36} ${s * 0.16} -${s * 0.72} 0 Z" fill="#a87b2f" stroke="${INK}" stroke-width="1.2"/>`
      + `<text x="${x}" y="${y + s * 0.28}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${s * 0.78}" font-weight="900" fill="#5e4413">$</text>`;
  }
  function mVault(x, y, s) {
    return `<rect x="${x - s}" y="${y - s * 0.82}" width="${s * 2}" height="${s * 1.64}" rx="${s * 0.14}" fill="#8e98a8" stroke="${INK}" stroke-width="1.6"/>`
      + `<circle cx="${x}" cy="${y}" r="${s * 0.44}" fill="#c8d2e0" stroke="${INK}" stroke-width="1.4"/>`
      + `<path d="M ${x} ${y - s * 0.44} v ${s * 0.2} M ${x} ${y + s * 0.24} v ${s * 0.2} M ${x - s * 0.44} ${y} h ${s * 0.2} M ${x + s * 0.24} ${y} h ${s * 0.2}" stroke="${INK}" stroke-width="1.3"/>`;
  }
  function mBench(x, y, s) {
    return `<rect x="${x - s}" y="${y - s * 0.16}" width="${s * 2}" height="${s * 0.3}" rx="${s * 0.06}" fill="#c89a5e" stroke="${INK}" stroke-width="1.4"/>`
      + `<rect x="${x - s * 0.82}" y="${y + s * 0.14}" width="${s * 0.18}" height="${s * 0.5}" fill="#8a5a28" stroke="${INK}" stroke-width="1.1"/>`
      + `<rect x="${x + s * 0.64}" y="${y + s * 0.14}" width="${s * 0.18}" height="${s * 0.5}" fill="#8a5a28" stroke="${INK}" stroke-width="1.1"/>`;
  }
  function mDumbbell(x, y, s) {
    return `<line x1="${x - s}" y1="${y}" x2="${x + s}" y2="${y}" stroke="${INK}" stroke-width="${s * 0.2}"/>`
      + `<rect x="${x - s * 1.2}" y="${y - s * 0.5}" width="${s * 0.34}" height="${s}" rx="2" fill="#5b6470" stroke="${INK}" stroke-width="1.3"/>`
      + `<rect x="${x + s * 0.86}" y="${y - s * 0.5}" width="${s * 0.34}" height="${s}" rx="2" fill="#5b6470" stroke="${INK}" stroke-width="1.3"/>`;
  }
  function mSalamiM(x, y, r) {
    let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="#8a3043" stroke="#5e1d2c" stroke-width="${r * 0.16}"/><circle cx="${x}" cy="${y}" r="${r * 0.8}" fill="#c05a62"/>`;
    const sp = streamFrom("sal2");
    for (let i = 0; i < 10; i++) { const a = sp() * 6.283, d = sp() * r * 0.62; s += `<circle cx="${(x + Math.cos(a) * d).toFixed(1)}" cy="${(y + Math.sin(a) * d).toFixed(1)}" r="${(r * 0.06 + sp() * r * 0.07).toFixed(1)}" fill="#f2d8c8"/>`; }
    return s;
  }
  function mTicket(x, y, w, rot, color) {
    const h = w * 0.46;
    return `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="${color || "#f2c14a"}" stroke="${INK}" stroke-width="1.5"/>`
      + `<circle cx="${x - w / 2}" cy="${y}" r="${h * 0.2}" fill="#f6eedb" stroke="${INK}" stroke-width="1"/><circle cx="${x + w / 2}" cy="${y}" r="${h * 0.2}" fill="#f6eedb" stroke="${INK}" stroke-width="1"/>`
      + `<line x1="${x - w * 0.22}" y1="${y - h * 0.26}" x2="${x - w * 0.22}" y2="${y + h * 0.26}" stroke="${INK}" stroke-width="1" stroke-dasharray="2 2"/></g>`;
  }
  function mCycleM(x, y, s) {
    return `<path d="M ${x - s} ${y} a ${s} ${s} 0 0 1 ${s * 1.7} -${s * 0.5}" fill="none" stroke="${INK}" stroke-width="2.4"/><polygon points="${x + s * 0.86},${y - s * 0.78} ${x + s * 0.4},${y - s * 0.74} ${x + s * 0.78},${y - s * 0.3}" fill="${INK}"/>`
      + `<path d="M ${x + s} ${y} a ${s} ${s} 0 0 1 -${s * 1.7} ${s * 0.5}" fill="none" stroke="${INK}" stroke-width="2.4"/><polygon points="${x - s * 0.86},${y + s * 0.78} ${x - s * 0.4},${y + s * 0.74} ${x - s * 0.78},${y + s * 0.3}" fill="${INK}"/>`;
  }

  /* ---- the poster background: duotone sunburst + ground + frame ---- */
  function poster(c1, c2, ground) {
    let s = `<rect width="100" height="72" fill="${c1}"/>`;
    const cx = 50, cy = 46, R = 130;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 0.5) / 12) * Math.PI * 2;
      s += `<path d="M ${cx} ${cy} L ${(cx + Math.cos(a0) * R).toFixed(1)} ${(cy + Math.sin(a0) * R).toFixed(1)} L ${(cx + Math.cos(a1) * R).toFixed(1)} ${(cy + Math.sin(a1) * R).toFixed(1)} Z" fill="${c2}" opacity=".55"/>`;
    }
    s += `<rect x="0" y="58" width="100" height="14" fill="${ground || "#2a7440"}" opacity=".9"/><rect x="0" y="58" width="100" height="1.6" fill="#f7f1e2" opacity=".5"/>`;
    return s;
  }
  function posterClose(extra) {
    return (extra || "") + retroWash(100, 72) + `<rect x="1.2" y="1.2" width="97.6" height="69.6" fill="none" stroke="#f6eedb" stroke-width="2.4" opacity=".9" rx="3"/></svg>`;
  }

  /* ---- per-item scenes ---- */
  const FAMILY_TONES = {
    charm:     ["#5b2e8e", "#7a4ab8", "#2a1145"],
    upgrade:   ["#7a5514", "#9a6f1f", "#3a2a08"],
    analytics: ["#175c38", "#22744a", "#0b2a1d"],
    scouting:  ["#175c5c", "#1f7575", "#0b2a2a"],
    action:    ["#8a4a12", "#b3611c", "#3a2008"],
  };
  function charmScene(id) {
    switch (id) {
      case "ch_pinetar": return mBat(58, 60, 44, -32) + `<path d="M 38 30 q 4 7 1 13 q -2 5 -5 2 q -3 -4 0 -8 Z" fill="${INK}" opacity=".85"/>` + `<rect x="24" y="44" width="17" height="12" rx="3" fill="#c8d2e0" stroke="${INK}" stroke-width="1.4" transform="rotate(-12 32 50)"/>`;
      case "ch_cork": return mBat(60, 62, 46, -28, 8) + `<circle cx="40" cy="32" r="11" fill="#e8cf9e" stroke="${INK}" stroke-width="1.6"/><circle cx="40" cy="32" r="6.5" fill="#caa05c" stroke="${INK}" stroke-width="1.1"/><circle cx="40" cy="32" r="2.4" fill="#8a5a28"/>`;
      case "ch_eyeblack": return mEyeM(56, 30, 13) + `<rect x="32" y="40" width="14" height="5" rx="2" fill="${INK}" transform="rotate(7 39 42)"/><rect x="54" y="40" width="14" height="5" rx="2" fill="${INK}" transform="rotate(-7 61 42)"/>`;
      case "ch_spikes": return mCleat(50, 40, 17, "#2f5ec0", false) + mSwooshes(26, 36, 14);
      case "ch_allstar": return mStar(50, 32, 16) + mStar(26, 22, 6.5, "#f7f1e2") + mStar(74, 22, 6.5, "#f7f1e2") + mCapM(50, 56, 11, "#15356e", "#d23c3c");
      case "ch_clutch": return mPlate(50, 40, 22) + mStar(50, 26, 11) + mBolt(28, 30, 14, "#f7f1e2") + mBolt(72, 30, 14, "#f7f1e2");
      case "ch_burner": return mCleat(52, 40, 16, "#c43c30", true) + mSwooshes(28, 38, 12);
      case "ch_copy": return mCardM(42, 38, 24, 32, -9) + mCardM(58, 38, 24, 32, 9);
      case "ch_mentor": return mWhistleM(46, 38, 15, "#cf7e34") + mStar(70, 26, 8, "#ffd24a");
      case "ch_ibb": return mBall(22, 28, 6.5) + mBall(38, 24, 6.5) + mBall(54, 22, 6.5) + mBall(70, 24, 6.5) + mBag(78, 50, 13) + `<path d="M 28 42 q 22 12 42 6" fill="none" stroke="#f7f1e2" stroke-width="2.2" stroke-dasharray="4 3"/><polygon points="72,49 64,46.4 66.8,52.6" fill="#f7f1e2"/>`;
      case "ch_momentum": return mBolt(50, 34, 34) + mArrowUp(76, 36, 11, "#7ef0a3");
      case "ch_secondwind": return `<path d="M 22 30 q 12 -8 22 0 q -8 6 -16 3 M 26 44 q 14 -7 26 0 q -10 7 -20 3" fill="none" stroke="#f7f1e2" stroke-width="2.6" stroke-linecap="round"/>` + `<circle cx="66" cy="36" r="11" fill="#5ad17a" stroke="${INK}" stroke-width="1.6"/><path d="M 66 30.5 v 11 M 60.5 36 h 11" stroke="#0b2a1d" stroke-width="2.6"/>`;
      default: return mSalamiM(50, 36, 18);
    }
  }
  function upgradeScene(id) {
    const base = String(id).replace(/2$/, "");
    switch (base) {
      case "up_dugout": return mBench(50, 38, 22) + mCapM(36, 30, 7, "#15356e", "#d23c3c") + mCapM(62, 30, 7, "#a32638", "#f2d8a0");
      case "up_hand": return mCardM(36, 38, 22, 30, -16) + mCardM(50, 36, 22, 30, 0) + mCardM(64, 38, 22, 30, 16);
      case "up_discount": return mTicket(50, 36, 36, -10) + `<text x="50" y="41" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="900" fill="${INK}" transform="rotate(-10 50 36)">-$1</text>`;
      case "up_shopslot": return mCardM(44, 38, 24, 32, -7, true) + mGlassM(60, 34, 12);
      case "up_reroll": return mCycleM(50, 36, 16) + mCoin(50, 36, 7);
      case "up_startrally": return mFlameM(50, 36, 17) + mPennant(74, 22, 16, "#d23c3c");
      case "up_interest": return mCoin(38, 42, 9) + mCoin(50, 38, 9) + mCoin(62, 34, 9) + mArrowUp(78, 32, 10, "#7ef0a3");
      case "up_salami": return mSalamiM(50, 36, 17) + mStar(74, 22, 7, "#f7f1e2");
      case "up_bonus": return mSack(50, 38, 16) + mCoin(70, 46, 6.5) + mCoin(30, 46, 6.5);
      case "up_spring": return `<circle cx="70" cy="20" r="9" fill="#ffd24a" stroke="${INK}" stroke-width="1.4"/>` + `<path d="M 30 58 q 2 -16 0 -24" fill="none" stroke="#8a5430" stroke-width="3" stroke-linecap="round"/><path d="M 30 34 q -9 -5 -14 0 q 7 1 14 2 M 30 34 q 9 -5 14 0 q -7 1 -14 2 M 30 34 q -2 -9 3 -12 q 0 7 -1 12 M 30 34 q 2 -9 -3 -12 q 0 7 1 12" fill="#2faa6f" stroke="${INK}" stroke-width=".8"/>`;
      case "up_editions": return mCardM(50, 38, 26, 34, -6) + `<path d="M 64 22 l 1.8 4 4 1.8 -4 1.8 -1.8 4 -1.8 -4 -4 -1.8 4 -1.8 Z" fill="#ffd24a" stroke="${INK}" stroke-width="1"/>`;
      case "up_strength": return mDumbbell(50, 34, 20) + mBat(74, 58, 30, -24, 5);
      case "up_pension": return mVault(50, 38, 17);
      case "up_owner": return `<rect x="34" y="22" width="32" height="22" rx="3" fill="#16273f" stroke="${INK}" stroke-width="1.6"/><rect x="38" y="27" width="7" height="6" fill="#ffe9a3"/><rect x="47" y="27" width="7" height="6" fill="#ffe9a3"/><rect x="56" y="27" width="6" height="6" fill="#ffe9a3"/>` + mPennant(70, 14, 14, "#ffd24a") + mCoin(30, 50, 7);
      case "up_rallycap": return `<g transform="rotate(180 50 34)">${mCapM(50, 30, 13, "#2f5ec0", "#ffd24a")}</g>` + mStar(72, 24, 7, "#ffd24a");
      case "up_taxbreak": return mTicket(46, 34, 34, 6) + `<path d="M 64 26 l 12 16 M 76 26 l -12 16" stroke="#c43c30" stroke-width="2.6" stroke-linecap="round"/>`;
      default: return mCoin(50, 36, 14);
    }
  }
  function scoutScene(it) {
    const op = it.op || "", arg = it.arg || "", key = it.key || "";
    if (it.kind === "analytics") {
      const tone = { power: "#ff7a59", contact: "#5ad17a", patience: "#56b4ff", speed: "#ffd34e", rally: "#ffd24a" }[key] || "#7fd0a0";
      return `<rect x="26" y="16" width="48" height="40" rx="3.5" fill="#f6eedb" stroke="${INK}" stroke-width="1.8"/>`
        + `<rect x="42" y="12" width="16" height="7" rx="2.5" fill="#8e98a8" stroke="${INK}" stroke-width="1.2"/>`
        + `<path d="M 32 48 l 10 -8 7 4 14 -14" fill="none" stroke="${tone}" stroke-width="3" stroke-linecap="round"/><polygon points="64,28 56.5,29.6 62,35" fill="${tone}"/>`
        + `<line x1="32" y1="24" x2="50" y2="24" stroke="${INK}" stroke-width="1.4" opacity=".5"/>`;
    }
    if (op === "edition" && arg === "gold") return mCoin(50, 34, 15) + mStar(74, 22, 7, "#f7f1e2");
    if (op === "edition" && arg === "clutch") return mStar(50, 32, 15) + mPlate(50, 50, 17);
    if (op === "edition" && arg === "prospect") return `<path d="M 50 52 q 1 -13 0 -19" stroke="#2faa6f" stroke-width="2.6" fill="none"/><path d="M 50 33 q -8 -5 -13 0 q 6 1 13 2 M 50 33 q 8 -5 13 0 q -6 1 -13 2" fill="#2faa6f" stroke="${INK}" stroke-width=".8"/>` + mArrowUp(72, 32, 10, "#7ef0a3");
    if (op === "edition" && arg === "foil") return mCardM(50, 36, 26, 34, -5) + `<path d="M 36 50 L 64 22" stroke="#9bd8ff" stroke-width="3" opacity=".8"/><path d="M 41 53 L 69 25" stroke="#c9b6ff" stroke-width="2" opacity=".8"/>`;
    if (op === "switch") return mBat(36, 56, 34, -38, 5) + mBat(64, 56, 34, 38, 5) + mBall(50, 24, 7);
    if (op === "bump") { const tone = { contact: "#5ad17a", power: "#ff7a59", eye: "#56b4ff", speed: "#ffd34e" }[arg] || "#7fd0a0"; return mArrowUp(50, 34, 16, tone) + (arg === "eye" ? mEyeM(50, 56, 9) : arg === "speed" ? mSwooshes(30, 52, 12) + mCleat(58, 52, 10, "#2f5ec0") : arg === "power" ? mDumbbell(50, 56, 13) : mBat(64, 62, 26, -30, 4.5)); }
    if (op === "copy") return mCardM(42, 38, 24, 32, -9) + mCardM(58, 38, 24, 32, 9);
    if (op === "destroy") return `<rect x="38" y="20" width="24" height="34" rx="2.5" fill="#16273f" stroke="${INK}" stroke-width="1.6"/><rect x="42" y="24" width="16" height="26" fill="#0a1422"/><circle cx="56" cy="38" r="1.6" fill="#ffd24a"/>` + `<path d="M 64 36 h 14 M 73 30.5 l 5.5 5.5 -5.5 5.5" fill="none" stroke="#f7f1e2" stroke-width="2.6" stroke-linecap="round"/>`;
    return mGlassM(48, 34, 13);
  }
  function actionScene(id) {
    switch (id) {
      case "swing": return mBat(46, 56, 40, -52) + `<path d="M 26 46 a 26 26 0 0 1 36 -18" fill="none" stroke="#f7f1e2" stroke-width="2.4" stroke-dasharray="5 4"/>` + mBall(72, 26, 7);
      case "power": return mBat(42, 58, 42, -40, 8) + mBall(70, 22, 8) + `<path d="M 58 32 l -5 -4 M 60 26 l -6 -2 M 64 21 l -4 -4" stroke="#ffd24a" stroke-width="2.4" stroke-linecap="round"/>`;
      case "contact": return mEyeM(50, 28, 12) + mBat(58, 60, 34, -64, 5.5) + mBall(30, 50, 6);
      case "bunt": return `<g transform="rotate(86 50 30)">${mBat(50, 52, 40, 0, 6)}</g>` + mBall(50, 46, 6.5) + `<path d="M 50 54 q 0 5 -3 8" stroke="#f7f1e2" stroke-width="1.8" fill="none" stroke-dasharray="3 2.5"/>`;
      case "steal": return mBag(68, 46, 15) + `<path d="M 18 50 q 16 -4 34 0" stroke="#e8cf9e" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>` + mCleat(36, 40, 13, "#c43c30") + mSwooshes(20, 36, 11);
      default: return mBall(50, 36, 12);
    }
  }
  // itemArtSVG(kind, item) -> a finished retro poster for any non-person item.
  // kind: "charm" | "upgrade" | "analytics" | "scouting" | "action"
  function itemArtSVG(kind, item) {
    const tones = FAMILY_TONES[kind] || FAMILY_TONES.upgrade;
    const tier2 = kind === "upgrade" && /2$/.test(item && item.id || "");
    let s = svgOpen(100, 72, "dd-art dd-item dd-" + kind);
    s += `<defs>${HALFTONE_DEF}</defs>`;
    s += poster(tones[0], tones[1], tones[2]);
    if (kind === "charm") s += charmScene(item && item.id);
    else if (kind === "upgrade") s += upgradeScene(item && item.id);
    else if (kind === "analytics" || kind === "scouting") s += scoutScene(item || {});
    else if (kind === "action") s += actionScene(item && item.id);
    let extra = "";
    if (tier2) extra = `<rect x="1.2" y="1.2" width="97.6" height="69.6" fill="none" stroke="#ffd24a" stroke-width="3.4" rx="3"/>` + mStar(10, 10, 5, "#ffd24a") + mStar(90, 10, 5, "#ffd24a");
    return s + posterClose(extra);
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
  global.itemArtSVG = itemArtSVG;
  global.crestSVG = crestSVG;
})(window);
