import * as THREE from './vendor/three.module.js';

// Weather owns its GPU resources and runs on real seconds, independently of the
// town's crowd time-lapse. Positions, wind and ripple growth stay on the GPU.
const VOLUME_SIZE = 22;
const VOLUME_HEIGHT = 16;
const TOWN_STEP = 14.8;
const MAX_RAIN = 2400;
const MAX_SNOW = 1400;
const MAX_RIPPLES = 180;

const rainVertex = /* glsl */`
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uCenter;
  uniform vec4 uLot;
  attribute vec4 aParticle;
  attribute vec3 aStyle;
  varying vec2 vUv;
  varying float vAlpha;
  #include <fog_pars_vertex>

  void main() {
    float height = mod(aParticle.z - uTime * aParticle.w, 16.0);
    vec3 p = vec3(aParticle.x, height + 0.22, aParticle.y);
    p.x += (16.0 - height) * 0.18 + sin(uTime * 0.55) * 0.16;
    p.z += (16.0 - height) * 0.075;
    p.xz = mod(p.xz + 11.0, 22.0) - 11.0;

    // The ground storefront is hollow behind transparent glazing. Suppress
    // particles inside its walls; opaque roofs handle the rest through depth.
    vec2 lotDelta = p.xz + uCenter - uLot.xy;
    vec2 lot = vec2(uLot.z * lotDelta.x - uLot.w * lotDelta.y,
                    uLot.w * lotDelta.x + uLot.z * lotDelta.y);
    float inside = step(-4.18, lot.x) * step(lot.x, 2.98)
                 * step(-4.28, lot.y) * step(lot.y, 0.78);
    float outside = 1.0 - inside * (1.0 - step(3.65, p.y));
    float edge = 1.0 - smoothstep(8.5, 11.0, max(abs(p.x), abs(p.z)));
    float floorFade = smoothstep(0.0, 0.45, height);
    float ceilingFade = 1.0 - smoothstep(14.5, 16.0, height);
    vAlpha = aStyle.z * uIntensity * edge * floorFade * ceilingFade * outside;
    vUv = uv;

    vec3 streak = vec3(-0.18, 1.0, -0.075) * aStyle.x;
    vec4 mvPosition = modelViewMatrix * vec4(p + streak * position.y, 1.0);
    vec3 viewStreak = mat3(modelViewMatrix) * streak;
    vec2 side = normalize(vec2(-viewStreak.y, viewStreak.x));
    mvPosition.xy += side * position.x * aStyle.y;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const rainFragment = /* glsl */`
  varying vec2 vUv;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    float edge = max(fwidth(vUv.x), 0.12);
    float widthFade = smoothstep(0.0, edge, vUv.x)
                    * (1.0 - smoothstep(1.0 - edge, 1.0, vUv.x));
    float tail = mix(0.95, 0.2, vUv.y);
    float alpha = vAlpha * widthFade * tail;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(0.49, 0.64, 0.78, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const snowVertex = /* glsl */`
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPointScale;
  uniform vec2 uCenter;
  uniform vec4 uLot;
  attribute vec4 aParticle;
  attribute vec3 aStyle;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    float height = mod(aParticle.y - uTime * aParticle.w, 16.0);
    vec3 p = vec3(aParticle.x, height + 0.24, aParticle.z);
    float phase = aStyle.y;
    p.x += sin(uTime * 0.43 + phase) * 0.72
         + sin(uTime * 0.19 + phase * 1.7) * 0.28;
    p.z += cos(uTime * 0.32 + phase * 1.3) * 0.62;
    p.xz = mod(p.xz + 11.0, 22.0) - 11.0;

    vec2 lotDelta = p.xz + uCenter - uLot.xy;
    vec2 lot = vec2(uLot.z * lotDelta.x - uLot.w * lotDelta.y,
                    uLot.w * lotDelta.x + uLot.z * lotDelta.y);
    float inside = step(-4.18, lot.x) * step(lot.x, 2.98)
                 * step(-4.28, lot.y) * step(lot.y, 0.78);
    float outside = 1.0 - inside * (1.0 - step(3.65, p.y));
    float edge = 1.0 - smoothstep(8.5, 11.0, max(abs(p.x), abs(p.z)));
    vAlpha = aStyle.z * (0.45 + 0.55 * uIntensity) * edge * outside
           * smoothstep(0.0, 0.35, height)
           * (1.0 - smoothstep(14.6, 16.0, height));
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(uPointScale * aStyle.x / max(1.0, -mvPosition.z), 1.0, 8.0);
    #include <fog_vertex>
  }
`;

const snowFragment = /* glsl */`
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.25, 1.0, radius)) * vAlpha;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(0.93, 0.97, 1.0, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const rippleVertex = /* glsl */`
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uCenter;
  attribute vec4 aParticle;
  attribute vec3 aStyle;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vRadius;
  #include <fog_pars_vertex>

  void main() {
    float phase = fract(aParticle.z + uTime * aStyle.x);
    float radius = mix(0.035, aParticle.w, phase);
    vec2 world = aParticle.xy + uCenter;
    float ground = 0.015;
    if (aStyle.y < 0.5) {
      world.x = floor(world.x / 14.8 + 0.5) * 14.8 + aParticle.x * 0.14;
    } else if (aStyle.y < 1.5) {
      world.y = floor(world.y / 14.8 + 0.5) * 14.8 + aParticle.y * 0.14;
    } else {
      // Alternate street splashes with exposed front-walkway splashes. The
      // block orientation repeats every two cells around the town junctions.
      vec2 cell = floor(world / 14.8);
      vec2 center = (cell + 0.5) * 14.8;
      float px = mod(cell.x, 2.0);
      float pz = mod(cell.y, 2.0);
      float quarter = px < 0.5 ? (pz < 0.5 ? 0.0 : 1.0)
                              : (pz < 0.5 ? 3.0 : 2.0);
      float angle = quarter * 1.570796327;
      vec2 walk = vec2(aParticle.x * 0.4, 3.35 + abs(aParticle.y) * 0.14);
      world = center + vec2(cos(angle) * walk.x + sin(angle) * walk.y,
                            -sin(angle) * walk.x + cos(angle) * walk.y);
      ground = 0.205;
    }
    vec2 local = world - uCenter;
    float edge = 1.0 - smoothstep(10.0, 15.0, max(abs(local.x), abs(local.y)));
    vUv = uv;
    vRadius = radius;
    vAlpha = aStyle.z * uIntensity * edge * (1.0 - phase)
           * smoothstep(0.0, 0.14, phase);
    vec3 p = vec3(local.x + position.x * radius * 2.0, ground,
                  local.y + position.y * radius * 2.0);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const rippleFragment = /* glsl */`
  varying vec2 vUv;
  varying float vAlpha;
  varying float vRadius;
  #include <fog_pars_fragment>
  void main() {
    float radius = length(vUv * 2.0 - 1.0);
    float aa = max(fwidth(radius), 0.025);
    float thickness = clamp(0.018 / vRadius, 0.075, 0.3);
    float ring = smoothstep(0.9 - thickness - aa, 0.9 - thickness + aa, radius)
               * (1.0 - smoothstep(0.9 - aa, 0.9 + aa, radius));
    float alpha = ring * vAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(0.55, 0.68, 0.78, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function instancedQuad(count, particles, styles) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 1, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.setAttribute('aParticle', new THREE.InstancedBufferAttribute(particles, 4));
  geometry.setAttribute('aStyle', new THREE.InstancedBufferAttribute(styles, 3));
  geometry.instanceCount = count;
  return geometry;
}

/**
 * GPU precipitation following the selected district. Intensity is in [0, 1].
 * update() accepts an optional cached selectedLot {x, z, angle} as its fourth
 * argument for accurate storefront masking; its first three arguments suffice.
 */
export function createWeatherEffects(scene) {
  const root = new THREE.Group();
  root.name = 'Town weather';
  root.visible = false;
  scene.add(root);

  const shared = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uCenter: { value: new THREE.Vector2() },
    uLot: { value: new THREE.Vector4(7.4, 7.4, 1, 0) },
    uPointScale: { value: 1200 },
  };
  const geometries = [];
  const materials = [];
  function makeMaterial(vertexShader, fragmentShader) {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared },
      vertexShader, fragmentShader,
      transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.NormalBlending, side: THREE.DoubleSide, fog: true,
    });
    materials.push(material);
    return material;
  }

  const rng = seededRandom(14082026);
  const rainParticles = new Float32Array(MAX_RAIN * 4);
  const rainStyles = new Float32Array(MAX_RAIN * 3);
  for (let i = 0; i < MAX_RAIN; i++) {
    rainParticles.set([
      (rng() - 0.5) * VOLUME_SIZE, (rng() - 0.5) * VOLUME_SIZE,
      rng() * VOLUME_HEIGHT, 9.5 + rng() * 7,
    ], i * 4);
    rainStyles.set([0.28 + rng() * 0.42, 0.012 + rng() * 0.012,
      0.26 + rng() * 0.21], i * 3);
  }
  const rainGeometry = instancedQuad(MAX_RAIN, rainParticles, rainStyles);
  const rain = new THREE.Mesh(rainGeometry, makeMaterial(rainVertex, rainFragment));
  rain.name = 'Rain streaks';
  rain.renderOrder = 20;
  rain.frustumCulled = false;
  rain.visible = false;
  root.add(rain);
  geometries.push(rainGeometry);

  const snowParticles = new Float32Array(MAX_SNOW * 4);
  const snowStyles = new Float32Array(MAX_SNOW * 3);
  const snowPositions = new Float32Array(MAX_SNOW * 3);
  for (let i = 0; i < MAX_SNOW; i++) {
    const x = (rng() - 0.5) * VOLUME_SIZE;
    const y = rng() * VOLUME_HEIGHT;
    const z = (rng() - 0.5) * VOLUME_SIZE;
    snowPositions.set([x, y, z], i * 3);
    snowParticles.set([x, y, z, 0.48 + rng() * 0.7], i * 4);
    snowStyles.set([0.038 + rng() * 0.065, rng() * Math.PI * 2,
      0.42 + rng() * 0.44], i * 3);
  }
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  snowGeometry.setAttribute('aParticle', new THREE.BufferAttribute(snowParticles, 4));
  snowGeometry.setAttribute('aStyle', new THREE.BufferAttribute(snowStyles, 3));
  const snow = new THREE.Points(snowGeometry, makeMaterial(snowVertex, snowFragment));
  snow.name = 'Snow flakes';
  snow.renderOrder = 21;
  snow.frustumCulled = false;
  snow.visible = false;
  root.add(snow);
  geometries.push(snowGeometry);

  const rippleParticles = new Float32Array(MAX_RIPPLES * 4);
  const rippleStyles = new Float32Array(MAX_RIPPLES * 3);
  for (let i = 0; i < MAX_RIPPLES; i++) {
    rippleParticles.set([
      (rng() - 0.5) * VOLUME_SIZE, (rng() - 0.5) * VOLUME_SIZE,
      rng(), 0.15 + rng() * 0.23,
    ], i * 4);
    rippleStyles.set([0.9 + rng() * 0.9, i % 3, 0.23 + rng() * 0.15], i * 3);
  }
  const rippleGeometry = instancedQuad(MAX_RIPPLES, rippleParticles, rippleStyles);
  // Centre the square in both axes before laying it flat in the vertex shader.
  const ripplePosition = rippleGeometry.getAttribute('position');
  for (let i = 0; i < ripplePosition.count; i++) {
    ripplePosition.setY(i, ripplePosition.getY(i) - 0.5);
  }
  const ripples = new THREE.Mesh(rippleGeometry, makeMaterial(rippleVertex, rippleFragment));
  ripples.name = 'Rain ground ripples';
  ripples.renderOrder = 19;
  ripples.frustumCulled = false;
  ripples.visible = false;
  root.add(ripples);
  geometries.push(rippleGeometry);

  let disposed = false;
  let weather = 'clear';
  let amount = 1;
  let rainLimit = MAX_RAIN;
  let snowLimit = MAX_SNOW;
  let rippleLimit = MAX_RIPPLES;
  const motionQuery = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = !!motionQuery?.matches;
  const onMotionChange = event => { reducedMotion = event.matches; };
  motionQuery?.addEventListener?.('change', onMotionChange);

  function updateCounts() {
    rainGeometry.instanceCount = Math.ceil(rainLimit * (0.18 + amount * 0.82));
    snowGeometry.setDrawRange(0, Math.ceil(snowLimit * (0.16 + amount * 0.84)));
    rippleGeometry.instanceCount = Math.ceil(rippleLimit * (0.15 + amount * 0.85));
  }

  function setWeather(type, intensity = 1) {
    if (disposed) return;
    const normalized = String(type || 'clear').toLowerCase();
    weather = normalized === 'rain' || normalized === 'rainy' ? 'rain'
      : normalized === 'snow' || normalized === 'snowy' ? 'snow' : 'clear';
    const numeric = Number(intensity);
    amount = Number.isFinite(numeric) ? THREE.MathUtils.clamp(numeric, 0, 1) : 1;
    shared.uIntensity.value = amount;
    root.visible = weather !== 'clear' && amount > 0;
    rain.visible = weather === 'rain';
    ripples.visible = weather === 'rain';
    snow.visible = weather === 'snow';
    updateCounts();
  }

  function update(deltaSeconds, target, paused = false, selectedLot) {
    if (disposed) return;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      root.position.set(target.x, 0, target.z);
      shared.uCenter.value.set(target.x, target.z);
      if (selectedLot && Number.isFinite(selectedLot.x) && Number.isFinite(selectedLot.z)) {
        const angle = Number.isFinite(selectedLot.angle) ? selectedLot.angle : 0;
        shared.uLot.value.set(selectedLot.x, selectedLot.z, Math.cos(angle), Math.sin(angle));
      } else {
        const ix = Math.floor(target.x / TOWN_STEP);
        const iz = Math.floor(target.z / TOWN_STEP);
        const px = ((ix % 2) + 2) % 2;
        const pz = ((iz % 2) + 2) % 2;
        const quarter = px ? (pz ? 2 : 3) : (pz ? 1 : 0);
        const angle = quarter * Math.PI / 2;
        shared.uLot.value.set((ix + 0.5) * TOWN_STEP, (iz + 0.5) * TOWN_STEP,
          Math.cos(angle), Math.sin(angle));
      }
    }
    if (!paused && !reducedMotion && root.visible) {
      const dt = Number(deltaSeconds);
      if (Number.isFinite(dt)) shared.uTime.value += THREE.MathUtils.clamp(dt, 0, 0.1);
    }
  }

  function resize(width, height) {
    if (disposed) return;
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const mobile = w < 650;
    rainLimit = mobile ? 950 : MAX_RAIN;
    snowLimit = mobile ? 650 : MAX_SNOW;
    rippleLimit = mobile ? 78 : MAX_RIPPLES;
    const pixelRatio = typeof window === 'undefined' ? 1
      : Math.min(window.devicePixelRatio || 1, 1.5);
    // Matches the town's 30-degree vertical field of view; point sizes are
    // expressed in world units and remain natural at mobile camera distance.
    shared.uPointScale.value = h * pixelRatio * 1.8660254;
    updateCounts();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    motionQuery?.removeEventListener?.('change', onMotionChange);
    root.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  if (typeof window !== 'undefined') resize(window.innerWidth, window.innerHeight);
  else updateCounts();
  return { setWeather, update, resize, dispose, transparentObjects: [rain, snow, ripples] };
}
