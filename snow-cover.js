const MAX_STEP_SECONDS = 0.5;
const DEFAULT_INTENSITY = 0.65;

function coverage(value, fallback = 0) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/** Create independent, bounded surface coverage without retaining the input. */
export function createSnowCoverState(initial = {}) {
  return {
    roofCoverage: coverage(initial?.roofCoverage),
    groundCoverage: coverage(initial?.groundCoverage),
  };
}

/**
 * Advance by real elapsed seconds, returning a new state; never mutate `state`.
 * At intensity .65, roofs fill in 120 seconds and ground fills in 190 seconds.
 * Use this clock independently of crowd/time-lapse speed. A long background-tab
 * delta counts as at most half a second, and paused snow does not accumulate.
 * Leaving snow clears both surfaces immediately, even while paused or at dt 0.
 */
export function advanceSnowCover(state, { type = 'clear', intensity = DEFAULT_INTENSITY, paused = false, dt = 0 } = {}) {
  if (type !== 'snow') return createSnowCoverState();
  const next = createSnowCoverState(state);
  const seconds = paused || !Number.isFinite(dt) ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, dt));
  if (seconds === 0) return next;

  const strength = coverage(intensity, DEFAULT_INTENSITY);
  // Linear deposition keeps thin early snow visible and stronger snow faster.
  next.roofCoverage = coverage(next.roofCoverage + seconds * strength / 78);
  next.groundCoverage = coverage(next.groundCoverage + seconds * strength / 123.5);
  return next;
}
