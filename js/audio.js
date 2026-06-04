/* ============================================================
   Diamond Duel — Tiny synth SFX (no audio files needed)
   WebAudio blips for hits, the rally tick, coach flashes, etc.
   ============================================================ */
(function (global) {
  "use strict";

  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  // Basic envelope tone
  function tone(opts) {
    if (!enabled) return;
    if (!ensure()) return;
    const o = opts || {};
    const type = o.type || "sine";
    const freq = o.freq || 440;
    const dur = o.dur || 0.15;
    const gain = o.gain == null ? 0.3 : o.gain;
    const t0 = ctx.currentTime + (o.delay || 0);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqTo), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(opts) {
    if (!enabled) return;
    if (!ensure()) return;
    const o = opts || {};
    const dur = o.dur || 0.2;
    const t0 = ctx.currentTime + (o.delay || 0);
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || "bandpass";
    filter.frequency.value = o.freq || 1200;
    filter.Q.value = o.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain == null ? 0.25 : o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
    resume,
    click() { tone({ type: "triangle", freq: 320, freqTo: 220, dur: 0.06, gain: 0.18 }); },
    deal() { tone({ type: "sine", freq: 520, freqTo: 700, dur: 0.05, gain: 0.12 }); },
    bat() { // contact crack
      noise({ freq: 2400, q: 2, dur: 0.07, gain: 0.3, filter: "bandpass" });
      tone({ type: "triangle", freq: 180, dur: 0.06, gain: 0.18 });
    },
    single() { this.bat(); tone({ type: "square", freq: 440, dur: 0.1, gain: 0.12, delay: 0.02 }); },
    xbh() { this.bat(); tone({ type: "sawtooth", freq: 330, freqTo: 660, dur: 0.18, gain: 0.14, delay: 0.02 }); },
    homer() {
      this.bat();
      [0, 0.09, 0.18, 0.30].forEach((d, i) =>
        tone({ type: "square", freq: 392 * Math.pow(1.18, i), dur: 0.16, gain: 0.16, delay: 0.04 + d })
      );
      noise({ freq: 600, q: 0.5, dur: 0.5, gain: 0.12, filter: "lowpass", delay: 0.05 });
    },
    walk() { tone({ type: "sine", freq: 300, freqTo: 380, dur: 0.18, gain: 0.12 }); },
    out() { tone({ type: "sine", freq: 200, freqTo: 90, dur: 0.22, gain: 0.16 }); },
    strikeout() { tone({ type: "sawtooth", freq: 240, freqTo: 70, dur: 0.28, gain: 0.16 }); },
    rally(level) { // pitch rises with rally
      const f = 520 + Math.min(2400, (level || 1) * 120);
      tone({ type: "triangle", freq: f, dur: 0.07, gain: 0.12 });
    },
    coach() { tone({ type: "sine", freq: 740, freqTo: 1100, dur: 0.12, gain: 0.12 }); tone({ type: "sine", freq: 988, dur: 0.1, gain: 0.08, delay: 0.05 }); },
    steal() { noise({ freq: 3000, q: 1.5, dur: 0.12, gain: 0.18, filter: "highpass" }); },
    coin() { tone({ type: "square", freq: 880, dur: 0.06, gain: 0.1 }); tone({ type: "square", freq: 1320, dur: 0.08, gain: 0.1, delay: 0.05 }); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ type: "triangle", freq: f, dur: 0.3, gain: 0.18, delay: i * 0.12 }));
    },
    lose() {
      [392, 330, 262, 196].forEach((f, i) => tone({ type: "sawtooth", freq: f, dur: 0.35, gain: 0.16, delay: i * 0.16 }));
    },
    buy() { this.coin(); },
    error() { tone({ type: "square", freq: 160, dur: 0.12, gain: 0.14 }); },
  };

  global.SFX = SFX;
})(window);
