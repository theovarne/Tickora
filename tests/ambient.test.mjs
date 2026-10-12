import assert from 'node:assert/strict';
import test from 'node:test';
import { createAmbientAudio, getSoundProfile } from '../ambient.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class Parameter {
  constructor(value = 1) { this.value = value; this.events = []; }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.events.push(['value', value, time]); }
  setTargetAtTime(value, time, tau) { this.value = value; this.events.push(['target', value, time, tau]); }
}

class Node {
  constructor() { this.connections = []; this.disconnects = 0; }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections.length = 0; this.disconnects++; }
}

class TestContext {
  constructor({ resumeGate, resumeError, suspendGate, suspendStarted } = {}) {
    this.state = 'suspended';
    this.sampleRate = 2000;
    this.currentTime = 0;
    this.destination = new Node();
    this.nodes = [];
    this.sources = [];
    this.buffers = [];
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.closeCalls = 0;
    Object.assign(this, { resumeGate, resumeError, suspendGate, suspendStarted });
  }
  createGain() {
    const node = new Node(); node.gain = new Parameter(); this.nodes.push(node); return node;
  }
  createBiquadFilter() {
    const node = new Node(); node.frequency = new Parameter(350); node.Q = new Parameter(1); this.nodes.push(node); return node;
  }
  createBuffer(channels, length, rate) {
    const samples = new Float32Array(length);
    const buffer = { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: () => samples };
    this.buffers.push(buffer); return buffer;
  }
  createBufferSource() {
    const source = new Node();
    source.starts = 0; source.stops = 0;
    source.start = () => { source.starts++; };
    source.stop = () => { source.stops++; };
    this.sources.push(source); return source;
  }
  resume() {
    this.resumeCalls++;
    if (this.resumeError) return Promise.reject(this.resumeError);
    const ready = this.resumeGate?.promise ?? Promise.resolve();
    return ready.then(() => { if (this.state !== 'closed') this.state = 'running'; });
  }
  suspend() {
    this.suspendCalls++;
    this.suspendStarted?.resolve();
    const ready = this.suspendGate?.promise ?? Promise.resolve();
    return ready.then(() => { if (this.state !== 'closed') this.state = 'suspended'; });
  }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
}

const automationCount = context => context.nodes.reduce((total, node) => total + (node.gain?.events.length || 0) + (node.frequency?.events.length || 0), 0);

test('Sound recipes distinguish rain, snow, daytime birds and nighttime insects', () => {
  const day = getSoundProfile('clear', 0.65, 13);
  const night = getSoundProfile('clear', 0.65, 21);
  assert.equal(day.period, 'day'); assert.ok(day.wind > 0 && day.birds > 0); assert.equal(day.crickets, 0);
  assert.equal(night.period, 'night'); assert.equal(night.birds, 0); assert.ok(night.crickets > 0);
  const sunny = getSoundProfile('sunny', 0.65, 13);
  assert.ok(sunny.birds > day.birds);
  const rain = getSoundProfile('rain', 0.65, 13);
  assert.ok(rain.rain > 0 && rain.drops > 0); assert.equal(rain.birds, 0); assert.equal(rain.crickets, 0);
  const snow = getSoundProfile('snow', 0.65, 21);
  assert.ok(snow.wind > night.wind); assert.ok(snow.windCutoff < night.windCutoff);
  assert.equal(snow.rain, 0); assert.equal(snow.drops, 0); assert.equal(snow.crickets, 0);
  assert.equal(getSoundProfile('clear', 0.65, 6).period, 'day');
  assert.equal(getSoundProfile('clear', 0.65, 18).period, 'night');
});

test('Sound intensity and hour normalization stay finite and zero intensity suppresses rain', () => {
  const light = getSoundProfile('rain', 0.2, 13);
  const heavy = getSoundProfile('rain', 1, 13);
  assert.ok(heavy.rain > light.rain && heavy.drops > light.drops);
  const silentRain = getSoundProfile('rain', 0, 13);
  assert.equal(silentRain.rain, 0); assert.equal(silentRain.drops, 0);
  assert.equal(getSoundProfile('unknown', Infinity, -1).weather, 'clear');
  assert.equal(getSoundProfile('clear', NaN, 30).period, 'day');
  for (const type of ['clear', 'sunny', 'rain', 'snow']) {
    for (const intensity of [-1, 0, 0.65, 2, NaN, Infinity]) {
      const profile = getSoundProfile(type, intensity, NaN);
      for (const key of ['wind', 'rain', 'drops', 'birds', 'crickets']) assert.ok(Number.isFinite(profile[key]) && profile[key] >= 0 && profile[key] <= 1);
    }
  }
});

test('Preferences remain lazy, and first enable constructs and resumes before awaiting', async t => {
  const gate = deferred();
  const context = new TestContext({ resumeGate: gate });
  let factories = 0;
  const audio = createAmbientAudio({ contextFactory: () => { factories++; return context; } });
  t.after(() => audio.dispose());
  audio.setWeather('rain', 0.8); audio.setTime(20); audio.setVolume(0.35);
  assert.equal(await audio.setEnabled(false), false);
  assert.equal(factories, 0); assert.equal(context.sources.length, 0);
  const starting = audio.setEnabled(true);
  assert.equal(factories, 1); assert.equal(context.resumeCalls, 1);
  assert.equal(audio.getState().enabled, false);
  gate.resolve();
  assert.equal(await starting, true);
  assert.deepEqual({ ...audio.getState(), supported: undefined }, {
    enabled: true, weather: 'rain', intensity: 0.8, hour: 20, volume: 0.35, activity: 0.5, townLevel: 0.5,
    period: 'night', disposed: false, error: null, supported: undefined,
  });
});

test('Looping PCM is bounded and graph updates do not rebuild or accumulate automation', async t => {
  const context = new TestContext();
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  assert.equal(context.sources.length, 8);
  for (const source of context.sources) assert.ok(source.loop && source.starts === 1);
  for (const buffer of context.buffers) {
    const samples = buffer.getChannelData(0);
    assert.equal(Math.abs(samples[0]), 0); assert.equal(Math.abs(samples.at(-1)), 0);
    for (const sample of samples) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 0.950001);
  }
  const events = automationCount(context);
  for (let update = 0; update < 100; update++) {
    audio.setWeather('clear', 0.65); audio.setTime(13 + update / 1000); audio.setVolume(0.55);
  }
  assert.equal(context.sources.length, 8); assert.equal(automationCount(context), events);
  audio.setTime(18);
  const nightEvents = automationCount(context);
  assert.ok(nightEvents > events);
  audio.setTime(21); assert.equal(automationCount(context), nightEvents);
  audio.setWeather('rain', 0.9);
  assert.equal(context.sources.length, 8); assert.ok(automationCount(context) > nightEvents);
  assert.ok(context.nodes.some(node => node.gain?.events.some(event => event[0] === 'target' && event[3] === 0.25)));
});

test('Mute frees playing sources and suspends the same unlocked context; dispose closes it', async t => {
  const context = new TestContext();
  let factories = 0;
  const audio = createAmbientAudio({ contextFactory: () => { factories++; return context; } });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  audio.setVolume(2); assert.equal(audio.getState().volume, 1);
  audio.setVolume(-2); assert.equal(audio.getState().volume, 0);
  audio.setVolume(NaN); assert.equal(audio.getState().volume, 0);
  assert.equal(await audio.setEnabled(false), false);
  assert.equal(context.state, 'suspended'); assert.equal(context.closeCalls, 0);
  assert.ok(context.sources.every(source => source.stops === 1 && source.disconnects === 1 && source.buffer === null));
  assert.ok(context.nodes.every(node => node.disconnects === 1));
  assert.equal(await audio.setEnabled(true), true);
  assert.equal(factories, 1); assert.equal(context.sources.length, 16);
  audio.dispose(); audio.dispose();
  assert.equal(context.closeCalls, 1); assert.equal(audio.getState().enabled, false);
  assert.ok(context.sources.every(source => source.stops === 1 && source.buffer === null));
  await assert.rejects(audio.setEnabled(true), /disposed/);
});

test('Rapid mute then enable cancels pending cleanup and settles both callers', async t => {
  const context = new TestContext();
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  const muting = audio.setEnabled(false);
  const enabling = audio.setEnabled(true);
  assert.equal(await enabling, true); assert.equal(typeof await muting, 'boolean');
  assert.equal(audio.getState().enabled, true);
  assert.equal(context.state, 'running'); assert.equal(context.sources.length, 8);
  assert.ok(context.sources.every(source => source.stops === 0));
  assert.equal(context.suspendCalls, 0); assert.equal(context.closeCalls, 0);
});

test('A late suspend cannot override a newer enable request', async t => {
  const gate = deferred();
  const started = deferred();
  const context = new TestContext({ suspendGate: gate, suspendStarted: started });
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  const muting = audio.setEnabled(false);
  await started.promise;
  const enabling = audio.setEnabled(true);
  gate.resolve();
  await muting;
  assert.equal(await enabling, true);
  assert.equal(context.state, 'running'); assert.equal(audio.getState().enabled, true);
  assert.equal(context.closeCalls, 0);
});

test('A late initial resume remains muted after a newer disable', async t => {
  const gate = deferred();
  const context = new TestContext({ resumeGate: gate });
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  const starting = audio.setEnabled(true);
  assert.equal(await audio.setEnabled(false), false);
  gate.resolve();
  assert.equal(await starting, false);
  assert.equal(context.state, 'suspended'); assert.equal(audio.getState().enabled, false);
  assert.ok(context.sources.every(source => source.stops === 1));
});

test('Resume failure releases its graph and a later gesture can recover', async t => {
  const failed = new TestContext({ resumeError: new Error('Gesture required') });
  const recovered = new TestContext();
  let factories = 0;
  const audio = createAmbientAudio({ contextFactory: () => factories++ === 0 ? failed : recovered });
  t.after(() => audio.dispose());
  await assert.rejects(audio.setEnabled(true), /Gesture required/);
  assert.equal(audio.getState().enabled, false); assert.equal(audio.getState().error, 'Gesture required');
  assert.equal(failed.closeCalls, 1); assert.ok(failed.sources.every(source => source.stops === 1));
  assert.equal(await audio.setEnabled(true), true);
  assert.equal(audio.getState().error, null);
});

test('Dispose invalidates pending resume, and unavailable audio fails only on enable', async () => {
  const gate = deferred();
  const context = new TestContext({ resumeGate: gate });
  const audio = createAmbientAudio({ contextFactory: () => context });
  const pending = audio.setEnabled(true);
  audio.dispose(); gate.resolve();
  assert.equal(await pending, false); assert.equal(context.closeCalls, 1);
  assert.equal(context.state, 'closed'); assert.equal(audio.getState().enabled, false);
  let factories = 0;
  const unsupported = createAmbientAudio({ contextFactory: () => { factories++; throw new Error('Unavailable'); } });
  assert.equal(factories, 0);
  await assert.rejects(unsupported.setEnabled(true), /Unavailable/);
  assert.equal(unsupported.getState().enabled, false);
  unsupported.dispose();
});

test('Town activity controls people and footsteps, while town level alone controls all town sounds', () => {
  const empty = getSoundProfile('clear', 0.65, 13, 0, 0.5);
  const busy = getSoundProfile('clear', 0.65, 13, 1, 0.5);
  assert.equal(empty.murmur, 0); assert.equal(empty.footsteps, 0);
  assert.ok(busy.murmur > 0 && busy.footsteps > 0);
  assert.equal(empty.traffic, busy.traffic); assert.ok(empty.traffic > 0);
  const townMuted = getSoundProfile('clear', 0.65, 13, 1, 0);
  assert.equal(townMuted.murmur, 0); assert.equal(townMuted.footsteps, 0); assert.equal(townMuted.traffic, 0);
  for (const key of ['wind', 'rain', 'drops', 'birds', 'crickets']) assert.equal(townMuted[key], busy[key]);
  const louderTown = getSoundProfile('clear', 0.65, 13, 1, 1);
  for (const key of ['murmur', 'footsteps', 'traffic']) assert.ok(louderTown[key] > busy[key]);
});

test('Town life is lower at night and in rain or snow without losing weather ambience', () => {
  const day = getSoundProfile('clear', 0.65, 13, 0.8, 0.5);
  const night = getSoundProfile('clear', 0.65, 22, 0.8, 0.5);
  const rain = getSoundProfile('rain', 0.8, 13, 0.8, 0.5);
  const snow = getSoundProfile('snow', 0.8, 13, 0.8, 0.5);
  for (const key of ['murmur', 'footsteps', 'traffic']) {
    assert.ok(night[key] < day[key]); assert.ok(rain[key] < day[key]); assert.ok(snow[key] < day[key]);
  }
  assert.ok(rain.rain > 0); assert.ok(snow.wind > 0);
  for (const activity of [-1, 0, 0.5, 3, NaN]) {
    for (const level of [-1, 0, 0.5, 3, NaN]) {
      const profile = getSoundProfile('rain', 1, 13, activity, level);
      for (const key of ['murmur', 'footsteps', 'traffic']) assert.ok(Number.isFinite(profile[key]) && profile[key] >= 0 && profile[key] < 0.2);
    }
  }
});

test('Town updates stay lazy; visit sounds never allocate in mute, pending enable or zero town level', async t => {
  const gate = deferred();
  const context = new TestContext({ resumeGate: gate });
  let factories = 0;
  const audio = createAmbientAudio({ contextFactory: () => { factories++; return context; } });
  t.after(() => audio.dispose());
  audio.setActivity(0.9); audio.setTownLevel(0.8);
  assert.equal(audio.playVisit(), false); assert.equal(factories, 0);
  const enabling = audio.setEnabled(true);
  const sources = context.sources.length;
  assert.equal(audio.playVisit(), false); assert.equal(context.sources.length, sources);
  gate.resolve(); await enabling;
  audio.setTownLevel(0);
  assert.equal(audio.playVisit(), false); assert.equal(context.sources.length, sources);
  audio.setTownLevel(0.5); audio.setVolume(0);
  assert.equal(audio.playVisit(), false); assert.equal(context.sources.length, sources);
  audio.setVolume(0.35);
  assert.equal(audio.playVisit(), true); assert.equal(context.sources.length, sources + 1);
});

test('Town PCM uses sparse footsteps and vehicle passes with long quiet gaps', async t => {
  const context = new TestContext();
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  const traffic = context.buffers.find(buffer => buffer.duration === 39);
  const steps = context.buffers.find(buffer => buffer.duration === 29);
  assert.ok(traffic && steps);
  for (const buffer of [traffic, steps]) {
    const samples = buffer.getChannelData(0);
    let audible = 0;
    for (const sample of samples) if (Math.abs(sample) > 1e-7) audible++;
    assert.ok(audible / samples.length > 0.02);
    assert.ok(audible / samples.length < 0.35);
    assert.ok(samples.subarray(0, buffer.sampleRate).every(sample => sample === 0));
  }
});

test('Weather, time and activity changes never trigger chimes or rebuild loops', async t => {
  const context = new TestContext();
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  const sourceCount = context.sources.length;
  const bufferCount = context.buffers.length;
  audio.setActivity(1); audio.setTownLevel(0.7); audio.setWeather('rain', 0.9); audio.setTime(22);
  assert.equal(context.sources.length, sourceCount); assert.equal(context.buffers.length, bufferCount);
  const count = automationCount(context);
  for (let repeat = 0; repeat < 40; repeat++) { audio.setActivity(1); audio.setTownLevel(0.7); }
  assert.equal(automationCount(context), count);
  assert.equal(audio.getState().activity, 1); assert.equal(audio.getState().townLevel, 0.7);
  audio.setActivity(-1); audio.setTownLevel(2);
  assert.equal(audio.getState().activity, 0); assert.equal(audio.getState().townLevel, 1);
});

test('Visit chimes debounce, cap overlapping voices and release naturally ended nodes', async t => {
  const context = new TestContext();
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true);
  const loops = context.sources.length;
  assert.equal(audio.playVisit(), true);
  const first = context.sources.at(-1);
  const firstGain = context.nodes.at(-1);
  assert.equal(first.loop, undefined); assert.ok(first.buffer.duration < 1.1);
  assert.equal(audio.playVisit(), false); assert.equal(context.sources.length, loops + 1);
  context.currentTime += 0.3;
  assert.equal(audio.playVisit(), true);
  context.currentTime += 0.3;
  assert.equal(audio.playVisit(), false); assert.equal(context.sources.length, loops + 2);
  audio.setTownLevel(0);
  assert.ok(firstGain.gain.events.some(event => event[0] === 'target' && event[1] === 0));
  audio.setTownLevel(0.6);
  const ended = first.onended;
  ended(); ended();
  assert.equal(first.disconnects, 1); assert.equal(first.buffer, null); assert.equal(first.onended, null);
  assert.equal(firstGain.disconnects, 1);
  assert.equal(audio.playVisit(), true); assert.equal(context.sources.length, loops + 3);
});

test('Mute clears active chimes and an old ended callback cannot affect a resumed graph', async t => {
  const context = new TestContext();
  const audio = createAmbientAudio({ contextFactory: () => context });
  t.after(() => audio.dispose());
  await audio.setEnabled(true); audio.playVisit();
  const oldVisit = context.sources.at(-1);
  const oldEnded = oldVisit.onended;
  assert.equal(await audio.setEnabled(false), false);
  assert.equal(oldVisit.stops, 1); assert.equal(oldVisit.buffer, null); assert.equal(oldVisit.disconnects, 1);
  await audio.setEnabled(true);
  assert.equal(audio.playVisit(), true);
  const currentVisit = context.sources.at(-1);
  oldEnded();
  assert.notEqual(currentVisit, oldVisit);
  assert.equal(currentVisit.stops, 0); assert.equal(currentVisit.disconnects, 0); assert.ok(currentVisit.buffer);
  audio.dispose();
  assert.equal(currentVisit.stops, 1); assert.equal(currentVisit.buffer, null); assert.equal(currentVisit.onended, null);
});
