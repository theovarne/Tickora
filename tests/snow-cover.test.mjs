import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceSnowCover, createSnowCoverState } from '../snow-cover.js';

function runFor(seconds, options = {}, initial = createSnowCoverState(), frameSeconds = 0.25) {
  let state = initial;
  for (let elapsed = 0; elapsed < seconds;) {
    const dt = Math.min(frameSeconds, seconds - elapsed);
    state = advanceSnowCover(state, { type: 'snow', ...options, dt });
    elapsed += dt;
  }
  return state;
}

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('Surface state starts clear, remains independent and never mutates its input', () => {
  assert.deepEqual(createSnowCoverState(), { roofCoverage: 0, groundCoverage: 0 });
  const initial = Object.freeze({ roofCoverage: 0.4, groundCoverage: 0.1 });
  const created = createSnowCoverState(initial);
  assert.notEqual(created, initial);
  const next = advanceSnowCover(initial, { type: 'snow', dt: 0.25 });
  assert.notEqual(next, initial);
  assert.ok(next.roofCoverage > initial.roofCoverage);
  assert.ok(next.groundCoverage > initial.groundCoverage);
  assert.deepEqual(initial, { roofCoverage: 0.4, groundCoverage: 0.1 });
  assert.deepEqual(createSnowCoverState({ roofCoverage: 8, groundCoverage: -2 }), { roofCoverage: 1, groundCoverage: 0 });
  assert.deepEqual(createSnowCoverState({ roofCoverage: NaN, groundCoverage: Infinity }), { roofCoverage: 0, groundCoverage: 0 });
  assert.deepEqual(createSnowCoverState(null), { roofCoverage: 0, groundCoverage: 0 });
});

test('Default snow is visible after 15 seconds, then fills roofs before the ground', () => {
  const thin = runFor(15);
  assert.ok(thin.roofCoverage >= 0.1 && thin.roofCoverage < 0.2);
  assert.ok(thin.groundCoverage >= 0.05 && thin.groundCoverage < 0.15);
  assert.ok(thin.roofCoverage > thin.groundCoverage);
  const roof = runFor(120);
  close(roof.roofCoverage, 1);
  assert.ok(roof.groundCoverage > 0.5 && roof.groundCoverage < 0.8);
  const ground = runFor(190);
  close(ground.roofCoverage, 1);
  close(ground.groundCoverage, 1);
  assert.deepEqual(runFor(300), { roofCoverage: 1, groundCoverage: 1 });
});

test('Coverage accumulates monotonically and stronger snow deposits faster', () => {
  let previous = createSnowCoverState();
  for (let frame = 0; frame < 800; frame++) {
    const next = advanceSnowCover(previous, { type: 'snow', intensity: 0.65, dt: 0.25 });
    assert.ok(next.roofCoverage >= previous.roofCoverage);
    assert.ok(next.groundCoverage >= previous.groundCoverage);
    assert.ok(next.roofCoverage <= 1 && next.groundCoverage <= 1);
    previous = next;
  }
  const light = runFor(45, { intensity: 0.25 });
  const heavy = runFor(45, { intensity: 0.9 });
  assert.ok(heavy.roofCoverage > light.roofCoverage);
  assert.ok(heavy.groundCoverage > light.groundCoverage);
  assert.deepEqual(runFor(45, { intensity: 0 }), createSnowCoverState());
});

test('Pausing freezes snowfall, while a paused weather switch clears all snow immediately', () => {
  const initial = Object.freeze({ roofCoverage: 0.6, groundCoverage: 0.4 });
  assert.deepEqual(advanceSnowCover(initial, { type: 'snow', paused: true, intensity: 1, dt: 3600 }), initial);
  for (const type of ['clear', 'sunny', 'rain']) {
    const cleared = advanceSnowCover(initial, { type, paused: true, dt: 0 });
    assert.deepEqual(cleared, { roofCoverage: 0, groundCoverage: 0 });
    assert.deepEqual(advanceSnowCover(cleared, { type: 'snow', paused: true, dt: 3600 }), cleared);
  }
  const resumed = advanceSnowCover(initial, { type: 'snow', paused: false, dt: 0.25 });
  assert.ok(resumed.roofCoverage > initial.roofCoverage);
  assert.ok(resumed.groundCoverage > initial.groundCoverage);
});

test('Background-tab deltas cannot suddenly accumulate minutes of snow', () => {
  const initial = { roofCoverage: 0.4, groundCoverage: 0.3 };
  const huge = advanceSnowCover(initial, { type: 'snow', dt: 3600 });
  const bounded = advanceSnowCover(initial, { type: 'snow', dt: 0.5 });
  assert.deepEqual(huge, bounded);
  assert.ok(Math.abs(huge.roofCoverage - initial.roofCoverage) < 0.01);
  assert.ok(Math.abs(huge.groundCoverage - initial.groundCoverage) < 0.01);
  for (const dt of [-5, NaN, Infinity, -Infinity, 0]) {
    assert.deepEqual(advanceSnowCover(initial, { type: 'snow', dt }), initial);
  }
});

test('Snow intensity changes preserve accumulation; returning after another weather starts fresh', () => {
  const original = runFor(45);
  const reselected = advanceSnowCover(original, { type: 'snow', intensity: 0.2, dt: 0 });
  assert.deepEqual(reselected, original);
  const lighter = runFor(10, { intensity: 0.2 }, original);
  assert.ok(lighter.roofCoverage > original.roofCoverage);
  assert.ok(lighter.groundCoverage > original.groundCoverage);
  const cleared = advanceSnowCover(lighter, { type: 'clear', dt: 0 });
  assert.deepEqual(cleared, { roofCoverage: 0, groundCoverage: 0 });
  const snowyAgain = runFor(10, { intensity: 0.65 }, cleared);
  assert.deepEqual(snowyAgain, runFor(10, { intensity: 0.65 }));
  assert.ok(snowyAgain.roofCoverage > 0 && snowyAgain.roofCoverage < original.roofCoverage);
  assert.ok(snowyAgain.groundCoverage > 0 && snowyAgain.groundCoverage < original.groundCoverage);
});

test('Every non-snow weather clears surfaces without waiting for a clock tick or intensity', () => {
  const full = Object.freeze({ roofCoverage: 1, groundCoverage: 1 });
  for (const type of ['clear', 'sunny', 'rain', 'unknown', undefined]) {
    for (const dt of [0, -1, NaN, Infinity, 3600]) {
      for (const paused of [false, true]) {
        const cleared = advanceSnowCover(full, { type, paused, intensity: 0, dt });
        assert.deepEqual(cleared, { roofCoverage: 0, groundCoverage: 0 });
        assert.notEqual(cleared, full);
      }
    }
  }
  assert.deepEqual(full, { roofCoverage: 1, groundCoverage: 1 });
  assert.deepEqual(advanceSnowCover(full), { roofCoverage: 0, groundCoverage: 0 });
});

test('Normal frame rates give the same elapsed-time result and invalid intensities stay bounded', () => {
  const slowFrames = runFor(17, {}, undefined, 0.2);
  const fastFrames = runFor(17, {}, undefined, 1 / 60);
  close(slowFrames.roofCoverage, fastFrames.roofCoverage);
  close(slowFrames.groundCoverage, fastFrames.groundCoverage);
  const initial = { roofCoverage: 0.2, groundCoverage: 0.1 };
  assert.deepEqual(advanceSnowCover(initial, { type: 'snow', intensity: -1, dt: 0.25 }), initial);
  assert.deepEqual(advanceSnowCover(initial, { type: 'snow', intensity: 9, dt: 0.25 }), advanceSnowCover(initial, { type: 'snow', intensity: 1, dt: 0.25 }));
  for (const intensity of [NaN, Infinity, undefined]) {
    assert.deepEqual(advanceSnowCover(initial, { type: 'snow', intensity, dt: 0.25 }), advanceSnowCover(initial, { type: 'snow', dt: 0.25 }));
  }
});
