const WEATHER_TYPES = new Set(['clear', 'sunny', 'rain', 'snow']);
const DEFAULT_INTENSITY = 0.65;
const DEFAULT_VOLUME = 0.55;
const DEFAULT_ACTIVITY = 0.5;
const DEFAULT_TOWN_LEVEL = 0.5;
const FADE_OUT_MS = 180;
const LAYER_NAMES = ['wind', 'rain', 'drops', 'birds', 'crickets', 'murmur', 'footsteps', 'traffic'];

const bounded = (value, fallback) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
const timeOfDay = (hour, fallback = 13) => Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : fallback;
const weatherType = type => WEATHER_TYPES.has(type) ? type : 'clear';
const periodAt = hour => hour >= 6 && hour < 18 ? 'day' : 'night';

/** Pure recipe. Gains are layer amplitudes; user volume is applied separately. */
export function getSoundProfile(type = 'clear', intensity = DEFAULT_INTENSITY, hour = 13, activity = DEFAULT_ACTIVITY, townLevel = DEFAULT_TOWN_LEVEL) {
  const weather = weatherType(type);
  const strength = bounded(intensity, DEFAULT_INTENSITY);
  const time = timeOfDay(hour);
  const period = periodAt(time);
  const day = period === 'day';
  const bustle = bounded(activity, DEFAULT_ACTIVITY);
  const town = bounded(townLevel, DEFAULT_TOWN_LEVEL);
  const profile = {
    weather, intensity: strength, period,
    wind: day ? 0.11 : 0.095, rain: 0, drops: 0,
    birds: day ? 0.14 : 0, crickets: day ? 0 : 0.11,
    windCutoff: day ? 850 : 580, rainCutoff: 5200,
  };
  if (weather === 'sunny') {
    profile.wind = day ? 0.095 : 0.09;
    profile.birds = day ? 0.17 : 0;
  } else if (weather === 'rain') {
    profile.wind = 0.085 + 0.035 * strength;
    profile.rain = (0.12 + 0.29 * strength) * Math.sqrt(strength);
    profile.drops = (0.06 + 0.14 * strength) * Math.sqrt(strength);
    profile.birds = 0;
    profile.crickets = 0;
    profile.windCutoff = 1000;
    profile.rainCutoff = 3600 + 2400 * strength;
  } else if (weather === 'snow') {
    profile.wind = 0.14 + 0.075 * strength;
    profile.birds = 0;
    profile.crickets = 0;
    profile.windCutoff = 380;
  }
  const outdoors = weather === 'rain' ? 1 - 0.65 * strength : weather === 'snow' ? 0.38 : 1;
  const footsteps = weather === 'rain' ? 1 - 0.7 * strength : weather === 'snow' ? 0.3 : 1;
  const people = Math.sqrt(bustle) * (day ? 1 : 0.22);
  profile.activity = bustle;
  profile.townLevel = town;
  profile.murmur = 0.14 * town * people * outdoors;
  profile.footsteps = 0.13 * town * people * footsteps;
  profile.traffic = 0.095 * town * (day ? 1 : 0.27) * (weather === 'snow' ? 0.65 : weather === 'rain' ? 0.85 : 1);
  return profile;
}

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeBuffer(context, seconds, seed, fill) {
  // Ambient spectra stay below 10 kHz. A modest PCM rate avoids large mobile
  // allocations; Web Audio resamples it to the device's output rate.
  const rate = Math.min(context.sampleRate || 44100, 22050);
  const buffer = context.createBuffer(1, Math.ceil(rate * seconds), rate);
  const samples = buffer.getChannelData(0);
  fill(samples, rate, randomGenerator(seed));
  const edge = Math.max(1, Math.floor(rate * 0.008));
  for (let i = 0; i < samples.length; i++) {
    const envelope = Math.min(1, i / edge, (samples.length - 1 - i) / edge);
    samples[i] = Math.max(-0.95, Math.min(0.95, samples[i])) * envelope;
  }
  return buffer;
}

function windBuffer(context) {
  return makeBuffer(context, 13, 31517, (samples, rate, random) => {
    let low = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = random() * 2 - 1;
      low = 0.987 * low + 0.045 * white;
      const t = i / rate;
      const gust = 0.64 + 0.16 * Math.sin(t * 1.13) + 0.1 * Math.sin(t * 0.43);
      samples[i] = (2.6 * low + 0.09 * white) * gust;
    }
  });
}

function rainBuffer(context) {
  return makeBuffer(context, 9, 84671, (samples, rate, random) => {
    let soft = 0;
    for (let i = 0; i < samples.length; i++) {
      const noise = random() * 2 - 1;
      soft = 0.78 * soft + 0.22 * noise;
      samples[i] = (0.67 * noise + 0.33 * soft) * (0.79 + 0.07 * Math.sin(i / rate * 0.9));
    }
  });
}

function dropsBuffer(context) {
  return makeBuffer(context, 17, 98233, (samples, rate, random) => {
    for (let time = 0.25; time < 16.8; time += 0.045 + random() * 0.34) {
      const start = Math.floor(time * rate);
      const length = Math.floor((0.04 + random() * 0.07) * rate);
      const pitch = 1100 + random() * 2200;
      const strength = 0.16 + random() * 0.32;
      let phase = 0;
      for (let i = 0; i < length && start + i < samples.length; i++) {
        const t = i / rate;
        phase += 2 * Math.PI * pitch * (1 - 0.4 * i / length) / rate;
        const envelope = Math.min(1, t / 0.002) * Math.exp(-t / 0.014);
        samples[start + i] += strength * envelope * (0.82 * (random() * 2 - 1) + 0.18 * Math.sin(phase));
      }
    }
  });
}

function birdsBuffer(context) {
  return makeBuffer(context, 31, 63109, (samples, rate, random) => {
    for (const phrase of [1.6, 10.7, 22.4]) {
      const pitch = 2200 + random() * 900;
      const notes = 2 + Math.floor(random() * 3);
      for (let note = 0; note < notes; note++) {
        const start = Math.floor((phrase + note * 0.24) * rate);
        const length = Math.floor((0.095 + random() * 0.09) * rate);
        let phase = 0;
        for (let i = 0; i < length; i++) {
          const progress = i / length;
          phase += 2 * Math.PI * (pitch + 850 * Math.sin(Math.PI * progress) - 350 * progress) / rate;
          const envelope = Math.sin(Math.PI * progress) ** 2;
          samples[start + i] += 0.48 * envelope * (Math.sin(phase) + 0.12 * Math.sin(phase * 2));
        }
      }
    }
  });
}

function cricketsBuffer(context) {
  return makeBuffer(context, 14, 40123, (samples, rate, random) => {
    for (let phrase = 0.4; phrase < 13; phrase += 1.4 + random() * 1.5) {
      const pitch = 3500 + random() * 650;
      for (let pulse = 0; pulse < 7; pulse++) {
        const start = Math.floor((phrase + pulse * 0.053) * rate);
        const length = Math.floor(rate * 0.019);
        for (let i = 0; i < length && start + i < samples.length; i++) {
          samples[start + i] += 0.3 * Math.sin(Math.PI * i / length) ** 2 * Math.sin(2 * Math.PI * pitch * i / rate);
        }
      }
    }
  });
}

function murmurBuffer(context) {
  // Irregular shaped noise suggests distant bustle without words, recorded
  // speech, vocal formants or a recognisable synthetic voice.
  return makeBuffer(context, 23, 85331, (samples, rate, random) => {
    let soft = 0;
    let swell = 0.5;
    let target = 0.5;
    for (let i = 0; i < samples.length; i++) {
      if (i % Math.max(1, Math.floor(rate * 0.31)) === 0) target = 0.3 + random() * 0.65;
      swell += (target - swell) / (rate * 0.1);
      const noise = random() * 2 - 1;
      soft = soft * 0.84 + noise * 0.16;
      samples[i] = (0.48 * soft + 0.16 * noise) * swell;
    }
  });
}

function footstepsBuffer(context) {
  return makeBuffer(context, 29, 35179, (samples, rate, random) => {
    for (const walk of [2.3, 12.1, 23.4]) {
      let time = walk;
      for (let step = 0; step < 5; step++) {
        const start = Math.floor(time * rate);
        const length = Math.floor(rate * 0.17);
        const pitch = 85 + random() * 45;
        const weight = 0.65 + random() * 0.25;
        let grit = 0;
        for (let i = 0; i < length && start + i < samples.length; i++) {
          const t = i / rate;
          const attack = Math.min(1, t / 0.003);
          const noise = random() * 2 - 1;
          grit = 0.67 * grit + 0.33 * noise;
          const heel = 0.35 * Math.cos(2 * Math.PI * pitch * t) * Math.exp(-t / 0.03);
          const scuff = 0.3 * grit * Math.exp(-t / 0.046) + 0.12 * noise * Math.exp(-t / 0.009);
          samples[start + i] += weight * attack * (heel + scuff);
        }
        time += 0.43 + random() * 0.16;
      }
    }
  });
}

function trafficBuffer(context) {
  return makeBuffer(context, 39, 61387, (samples, rate, random) => {
    for (const passing of [5.2, 19.1, 32.6]) {
      const length = Math.floor(rate * (3 + random() * 0.9));
      const start = Math.floor(passing * rate);
      const pitch = 62 + random() * 22;
      let phase = 0;
      let tire = 0;
      for (let i = 0; i < length && start + i < samples.length; i++) {
        const progress = i / length;
        phase += 2 * Math.PI * pitch * (1.12 - progress * 0.25) / rate;
        tire = 0.78 * tire + 0.22 * (random() * 2 - 1);
        const pass = Math.sin(Math.PI * progress) ** 3;
        const motor = 0.25 * Math.sin(phase) + 0.09 * Math.sin(phase * 2) + 0.035 * Math.sin(phase * 3);
        samples[start + i] += pass * (motor + 0.35 * tire);
      }
    }
  });
}

function visitBuffer(context) {
  return makeBuffer(context, 0.96, 52711, (samples, rate) => {
    for (const [startTime, pitch, duration] of [[0.02, 784, 0.48], [0.23, 1046.5, 0.65]]) {
      const start = Math.floor(startTime * rate);
      const length = Math.floor(duration * rate);
      for (let i = 0; i < length && start + i < samples.length; i++) {
        const t = i / rate;
        const envelope = Math.min(1, t / 0.014) * Math.exp(-t / 0.16) * Math.min(1, (length - i) / (rate * 0.06));
        const phase = 2 * Math.PI * pitch * t;
        samples[start + i] += envelope * (0.36 * Math.sin(phase) + 0.07 * Math.sin(phase * 2.01));
      }
    }
  });
}

function retarget(parameter, value, now, seconds) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
  else {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
  }
  parameter.setTargetAtTime(value, now, seconds);
}

function defaultContextFactory() {
  const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Constructor) throw new Error('This browser does not support Web Audio.');
  return new Constructor({ latencyHint: 'playback' });
}

/**
 * Lazy, asset-free ambience. Call setEnabled(true) directly from a user gesture.
 * Volume, weather intensity, activity and town level are 0..1. No storage or page listeners are
 * installed here. The caller controls visibility and persists its preferences.
 * Disabling fades out, frees sources/buffers and suspends the unlocked context;
 * dispose closes it. No graph is rebuilt for ordinary weather/time updates.
 */
export function createAmbientAudio({ contextFactory = defaultContextFactory } = {}) {
  let weather = 'clear';
  let intensity = DEFAULT_INTENSITY;
  let hour = 13;
  let volume = DEFAULT_VOLUME;
  let activity = DEFAULT_ACTIVITY;
  let townLevel = DEFAULT_TOWN_LEVEL;
  let desiredEnabled = false;
  let disposed = false;
  let engine = null;
  let request = 0;
  let pendingFade = null;
  let error = null;

  const actualEnabled = () => !disposed && desiredEnabled && Boolean(engine?.audible) && engine?.context.state === 'running';

  function releaseGraph(current) {
    if (!current || current.released) return;
    current.released = true;
    current.audible = false;
    for (const visit of current.visits) {
      try { visit.source.stop(); } catch {}
      visit.cleanup();
    }
    current.visits.clear();
    current.visitBuffer = null;
    for (const source of current.sources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      try { source.buffer = null; } catch {}
    }
    for (const node of current.nodes) { try { node.disconnect(); } catch {} }
    current.sources.length = 0;
    current.nodes.length = 0;
    current.master = null;
    current.layers = null;
    current.profile = null;
  }

  function release(current) {
    if (!current || current.closed) return Promise.resolve();
    releaseGraph(current);
    current.closed = true;
    if (current.context.state === 'closed') return Promise.resolve();
    try { return Promise.resolve(current.context.close()).catch(() => {}); }
    catch { return Promise.resolve(); }
  }

  function cancelFade() {
    if (!pendingFade) return;
    clearTimeout(pendingFade.timer);
    const resolve = pendingFade.resolve;
    pendingFade = null;
    resolve();
  }

  function waitForFade() {
    return new Promise(resolve => {
      pendingFade = {
        resolve,
        timer: setTimeout(() => { pendingFade = null; resolve(); }, FADE_OUT_MS),
      };
    });
  }

  function build(current) {
    current.released = false;
    current.lastVisit = -Infinity;
    const context = current.context;
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    current.master = master;
    current.nodes.push(master);
    current.layers = {};
    const factories = {
      wind: windBuffer, rain: rainBuffer, drops: dropsBuffer, birds: birdsBuffer, crickets: cricketsBuffer,
      murmur: murmurBuffer, footsteps: footstepsBuffer, traffic: trafficBuffer,
    };
    for (const [name, factory] of Object.entries(factories)) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      current.sources.push(source);
      current.nodes.push(filter, gain);
      source.buffer = factory(context);
      source.loop = true;
      filter.type = name === 'murmur' ? 'bandpass' : 'lowpass';
      filter.Q.value = 0.5;
      filter.frequency.value = ({ wind: 850, murmur: 650, footsteps: 1800, traffic: 1400 })[name] || 6000;
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      current.layers[name] = { gain, filter };
      source.start(context.currentTime);
    }
    applyProfile(current);
  }

  function applyProfile(current = engine) {
    if (!current?.layers || current.released) return;
    const next = getSoundProfile(weather, intensity, hour, activity, townLevel);
    const previous = current.profile;
    const now = current.context.currentTime;
    for (const name of LAYER_NAMES) {
      if (!previous || next[name] !== previous[name]) retarget(current.layers[name].gain.gain, next[name], now, 0.25);
    }
    for (const name of ['wind', 'rain']) {
      const key = `${name}Cutoff`;
      if (!previous || next[key] !== previous[key]) retarget(current.layers[name].filter.frequency, next[key], now, 0.25);
    }
    current.profile = next;
  }

  async function setEnabled(value) {
    if (disposed) throw new Error('Ambient audio has been disposed.');
    const token = ++request;
    desiredEnabled = Boolean(value);
    error = null;
    cancelFade();

    if (!desiredEnabled) {
      const current = engine;
      if (!current) return false;
      current.audible = false;
      if (current.master) retarget(current.master.gain, 0, current.context.currentTime, 0.035);
      if (current.master && current.context.state === 'running') await waitForFade();
      if (token !== request || desiredEnabled || engine !== current) return actualEnabled();
      releaseGraph(current);
      // Preserve the context unlocked by the user's gesture, while releasing
      // sources and PCM buffers. This permits Safari visibility-change resume.
      current.suspension = Promise.resolve(current.context.suspend());
      try { await current.suspension; }
      catch (cause) { if (token === request) error = cause instanceof Error ? cause.message : String(cause); }
      return actualEnabled();
    }

    let current = engine;
    try {
      if (!current || current.context.state === 'closed') {
        // Factory and resume execute in the click's synchronous call stack.
        const context = contextFactory();
        current = {
          context, master: null, layers: null, sources: [], nodes: [], profile: null,
          audible: false, released: false, closed: false, resume: null, suspension: null,
          visits: new Set(), visitBuffer: null, lastVisit: -Infinity,
        };
        engine = current;
        current.resume = context.state === 'running' ? Promise.resolve() : Promise.resolve(context.resume());
        build(current);
      } else if (current.context.state !== 'running') {
        current.resume = Promise.resolve(current.context.resume());
      }
      if (!current.layers) build(current);
      await current.resume;
      if (token !== request || disposed || !desiredEnabled || engine !== current) {
        if (!disposed && !desiredEnabled && engine === current && !pendingFade && current.context.state === 'running') {
          // A late initial resume must not leave a hidden page's context running.
          releaseGraph(current);
          await Promise.resolve(current.context.suspend()).catch(() => {});
        }
        return actualEnabled();
      }
      if (current.suspension) {
        await current.suspension.catch(() => {});
        if (token !== request || disposed || !desiredEnabled || engine !== current) return actualEnabled();
        if (current.context.state !== 'running') await current.context.resume();
        if (token !== request || disposed || !desiredEnabled || engine !== current) return actualEnabled();
      }
      if (current.context.state !== 'running') throw new Error('Audio could not start. Try the sound button again.');
      applyProfile(current);
      retarget(current.master.gain, volume, current.context.currentTime, 0.045);
      current.audible = true;
      return true;
    } catch (cause) {
      if (token !== request || disposed || engine !== current) return actualEnabled();
      desiredEnabled = false;
      error = cause instanceof Error ? cause.message : String(cause);
      engine = null;
      await release(current);
      throw cause instanceof Error ? cause : new Error(error);
    }
  }

  return {
    setWeather(type, value = DEFAULT_INTENSITY) {
      const nextWeather = weatherType(type);
      const nextIntensity = bounded(value, DEFAULT_INTENSITY);
      if (weather === nextWeather && intensity === nextIntensity) return;
      weather = nextWeather;
      intensity = nextIntensity;
      applyProfile();
    },
    setTime(value) {
      const next = timeOfDay(value, hour);
      const changedPeriod = periodAt(next) !== periodAt(hour);
      hour = next;
      if (changedPeriod) applyProfile();
    },
    setVolume(value) {
      const next = bounded(value, volume);
      if (volume === next) return;
      volume = next;
      if (engine?.audible) retarget(engine.master.gain, volume, engine.context.currentTime, 0.08);
    },
    setActivity(value) {
      const next = bounded(value, activity);
      if (activity === next) return;
      activity = next;
      applyProfile();
    },
    setTownLevel(value) {
      const next = bounded(value, townLevel);
      if (townLevel === next) return;
      townLevel = next;
      applyProfile();
      if (engine?.audible) {
        for (const visit of engine.visits) retarget(visit.gain.gain, 0.2 * townLevel, engine.context.currentTime, 0.05);
      }
    },
    playVisit() {
      if (!actualEnabled() || townLevel === 0 || volume === 0) return false;
      const current = engine;
      const now = current.context.currentTime;
      if (now - current.lastVisit < 0.25 || current.visits.size >= 2) return false;
      current.visitBuffer ||= visitBuffer(current.context);
      const source = current.context.createBufferSource();
      const gain = current.context.createGain();
      source.buffer = current.visitBuffer;
      gain.gain.value = 0.2 * townLevel;
      source.connect(gain);
      gain.connect(current.master);
      let finished = false;
      const visit = {
        source, gain,
        cleanup() {
          if (finished) return;
          finished = true;
          source.onended = null;
          try { source.disconnect(); } catch {}
          try { source.buffer = null; } catch {}
          try { gain.disconnect(); } catch {}
          current.visits.delete(visit);
        },
      };
      current.visits.add(visit);
      source.onended = visit.cleanup;
      source.start(now);
      current.lastVisit = now;
      return true;
    },
    setEnabled,
    getState() {
      return {
        enabled: actualEnabled(), weather, intensity, hour, volume, activity, townLevel,
        period: periodAt(hour), disposed, error,
        supported: contextFactory !== defaultContextFactory || Boolean(globalThis.AudioContext || globalThis.webkitAudioContext),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      desiredEnabled = false;
      request++;
      cancelFade();
      const current = engine;
      engine = null;
      void release(current);
    },
  };
}
