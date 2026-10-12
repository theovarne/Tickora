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
 * delta counts as at most half a second, and a paused clock does not advance.
 */
export function advanceSnowCover(state, { type = 'clear', intensity = DEFAULT_INTENSITY, paused = false, dt = 0 } = {}) {
  const next = createSnowCoverState(state);
  const seconds = paused || !Number.isFinite(dt) ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, dt));
  if (seconds === 0) return next;

  const strength = coverage(intensity, DEFAULT_INTENSITY);
  if (type === 'snow') {
    // Linear deposition keeps thin early snow visible and stronger snow faster.
    next.roofCoverage = coverage(next.roofCoverage + seconds * strength / 78);
    next.groundCoverage = coverage(next.groundCoverage + seconds * strength / 123.5);
    return next;
  }

  // Full clear-weather melt takes 12–15 minutes. Sunshine and rain accelerate
  // thawing; even light rain melts more quickly than the clear-weather baseline.
  let roofMultiplier = 1;
  let groundMultiplier = 1;
  if (type === 'sunny') {
    roofMultiplier = 2.8;
    groundMultiplier = 3.2;
  } else if (type === 'rain') {
    roofMultiplier = 2.2 * (0.5 + 0.5 * strength);
    groundMultiplier = 3 * (0.5 + 0.5 * strength);
  }
  next.roofCoverage = coverage(next.roofCoverage - seconds * roofMultiplier / 720);
  next.groundCoverage = coverage(next.groundCoverage - seconds * groundMultiplier / 900);
  return next;
}
