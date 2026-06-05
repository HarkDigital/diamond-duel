/* ============================================================
   Diamond Duel — custom inline-SVG icon set (no emoji anywhere)
   icon(name) -> an <svg> string that inherits currentColor.
   Line icons are Feather/Lucide-style; a few are filled glyphs.
   ============================================================ */
(function (global) {
  "use strict";

  // name -> { d: inner SVG markup, f: true if it should be filled (default: stroked) }
  const ICONS = {
    /* ---- core UI ---- */
    menu:      { d: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>' },
    close:     { d: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' },
    check:     { d: '<polyline points="20 6 9 17 4 12"/>' },
    help:      { d: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
    stats:     { d: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
    soundOn:   { d: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>' },
    soundOff:  { d: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>' },
    copy:      { d: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' },
    replay:    { d: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-7"/>' },
    trophy:    { d: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>' },
    chevronR:  { d: '<polyline points="9 18 15 12 9 6"/>' },
    chevronL:  { d: '<polyline points="15 18 9 12 15 6"/>' },
    chevronsDown:{ d: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>' },
    arrowUpRight:{ d: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>' },
    phone:     { d: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>' },
    sell:      { d: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    out:       { d: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
    inning:    { d: '<circle cx="12" cy="12" r="10"/><path d="M4.5 4.8a16 16 0 0 1 0 14.4M19.5 4.8a16 16 0 0 0 0 14.4"/>' },
    diamond:   { d: '<path d="M12 2 22 12 12 22 2 12Z"/>', f: true },
    sparkle:   { d: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>', f: true },

    /* ---- at-bat approaches ---- */
    bat:       { d: '<path d="M20 4c-1.1-1.1-2.6-.7-3.4.1L5.7 15a2 2 0 0 0 0 2.8l.5.5a2 2 0 0 0 2.8 0L19.9 7.4c.8-.8 1.2-2.3.1-3.4z"/><circle cx="5.5" cy="18.5" r="1.6"/>' },
    muscle:    { d: '<path d="M6.5 6.5 17.5 17.5"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>' },
    eye:       { d: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>' },

    /* ---- streaks ---- */
    flame:     { d: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2 2.5z"/>', f: true },
    snowflake: { d: '<line x1="12" y1="2" x2="12" y2="22"/><line x1="3.3" y1="7" x2="20.7" y2="17"/><line x1="20.7" y1="7" x2="3.3" y2="17"/><path d="M12 2l2 2.2M12 2l-2 2.2M12 22l2-2.2M12 22l-2-2.2"/>' },

    /* ---- traits & coaches (symbolic) ---- */
    rocket:    { d: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0"/><path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>' },
    target:    { d: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
    star:      { d: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"/>', f: true },
    sword:     { d: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/>' },
    zap:       { d: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/>', f: true },
    trendUp:   { d: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>' },
    moveX:     { d: '<polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" y1="12" x2="22" y2="12"/>' },
    hourglass: { d: '<path d="M5 22h14M5 2h14"/><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22"/><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>' },
    fastForward:{ d: '<polygon points="13 19 22 12 13 5"/><polygon points="2 19 11 12 2 5"/>' },
    layers:    { d: '<polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },
    home:      { d: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    cap:       { d: '<path d="M3 13a9 9 0 0 1 18 0"/><path d="M21 13l1.5 2.5a1 1 0 0 1-.9 1.5H12"/><path d="M3 13h9"/>' },
    wind:      { d: '<path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>' },
    shuffle:   { d: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>' },
    barChart:  { d: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
    sprout:    { d: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>' },
    medal:     { d: '<path d="M7.2 15 2.7 7.1a2 2 0 0 1 .1-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.1a2 2 0 0 1 .1 2.2L16.8 15"/><circle cx="12" cy="17" r="5"/><path d="M11 18v-2h.5"/>' },
    eyeOff:    { d: '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M10.7 5.1A10 10 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13 13 0 0 0 2 12s3 7 10 7a10 10 0 0 0 5.4-1.6"/><line x1="2" y1="2" x2="22" y2="22"/>' },
    shield:    { d: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    coin:      { d: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.3A3 3 0 0 0 12 7.5c-1.7 0-3 1-3 2.3 0 3 6 1.5 6 4.4 0 1.3-1.3 2.3-3 2.3a3 3 0 0 1-2.8-1.8"/><line x1="12" y1="6" x2="12" y2="18"/>' },
    handshake: { d: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 0-2.8 0l-1.6 1.6a1 1 0 1 1-3-3l2.7-2.7a2.5 2.5 0 0 1 3.5 0l4.9 4.9"/><path d="m21 4-2.6 2.6"/><path d="M3 13l4 4"/><path d="m7 17-2.6 2.6a1 1 0 0 0 1.4 1.4L9 19"/>' },
    footprints:{ d: '<path d="M4 16v-2.4c0-2.1 1-3.1 1-5.6 0-2.7 1.5-6 4.5-6C11.4 2 12 3.8 12 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.4c0-2.1-1-3.1-1-5.6 0-2.7-1.5-6-4.5-6C12.6 6 12 7.8 12 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0Z"/>' },
    gauge:     { d: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>' },
    repeat:    { d: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>' },
  };

  // semantic aliases so data files read naturally
  ICONS.launch = ICONS.rocket;
  ICONS.eagle = ICONS.eye;
  ICONS.burner = ICONS.flame;
  ICONS.clutch = ICONS.star;
  ICONS.mistake = ICONS.target;
  ICONS.acekiller = ICONS.sword;
  ICONS.sparkplug = ICONS.zap;
  ICONS.streaky = ICONS.trendUp;
  ICONS.ice = ICONS.snowflake;

  function icon(name, cls) {
    const m = ICONS[name];
    const inner = m ? m.d : ICONS.diamond.d;
    const filled = m && m.f;
    const fill = filled ? 'currentColor' : 'none';
    const stroke = filled ? 'none' : 'currentColor';
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="' + fill +
      '" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      inner + '</svg>';
  }

  global.ICONS = ICONS;
  global.icon = icon;
})(window);
