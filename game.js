/* Idol Rush — the temple is collapsing.
 *
 * Spectacular edition:
 *  - The world behind you DISINTEGRATES into a glowing golden void — the
 *    collapse wave chases the guardian spider across crumbling ground.
 *  - Full day → sunset → night cycle on a custom shader sky (sun, moon,
 *    procedural stars), torchlight and fireflies at night.
 *  - GOLD RUSH: 10 idols = super-mode — invincible, magnetic, double score,
 *    golden aura, particle trail.
 *  - Guardian roar events, screen shake, speed FOV kick, blob shadows.
 *
 * Built with the real 3D assets from the kenmaz/TempleRun-Unity clone,
 * converted FBX 6.0/6.1/7.3 -> GLB. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------- power-ups ---------------- */
const POWERUP_TYPES = {
  magnet: { color: 0x3aa0ff, dur: 8 },
  shield: { color: 0x35d07f, dur: 6 },
  slowmo: { color: 0xb06cff, dur: 5 },
};
const fx = { magnet: 0, shield: 0, slowmo: 0 };  // remaining seconds per effect

/* ---------------- constants ---------------- */
const LANES = [2.5, 0, -2.5]; // camera looks down +Z: screen-right is -X, screen-left is +X
const SEGMENT_LEN = 26;
const SEGMENTS = 6;
const START_SPEED = 8;
const MAX_SPEED = 19;
const RAMP = 0.115;
const GRAVITY = -19;
const JUMP_V = 8.0;
const OBSTACLE_HALF_Z = 1.35;
const OBSTACLE_HALF_X = 1.05;
const COIN_SCORE = 25;
const CHASE_GAP = 9.5;
const GOLD_IDOLS = 10;       // idols needed to trigger GOLD RUSH
const GOLD_TIME = 8;         // seconds of GOLD RUSH
const COLLAPSE_DIST = 10.5;  // back wave: right at the guardian's heels
const NIGHT_Z = 620;         // distance at which it becomes full night

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------------- dom ---------------- */
const $ = (id) => document.getElementById(id);
const elScore = $('score'), elSpeed = $('speed'), elCoins = $('coins'), elBest = $('best'), elFx = $('fx');
const elGoldFill = $('gold-fill');
const overlayMenu = $('overlay-menu'), overlayDead = $('overlay-dead');
const elFinalScore = $('final-score'), elFinalCoins = $('final-coins'), elFinalBest = $('final-best');
const hudLeft = $('hud-left'), hudRight = $('hud-right'), swipeHint = $('swipe-hint'), loader = $('loader');
const vignetteEl = $('vignette'), bannerEl = $('banner');

const BEST_KEY = 'idol-rush-best';
let best = Number(localStorage.getItem(BEST_KEY) || 0);

/* ---------------- renderer / scene ---------------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.38;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const dayFog = new THREE.Color(0xbfd3de);
const duskFog = new THREE.Color(0xd89a62);
const nightFog = new THREE.Color(0x0a101f);
scene.fog = new THREE.Fog(0xbfd3de, 46, 150);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 3.9, -6.8);

/* ---------------- lights ---------------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0x66755f, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
sun.position.set(30, 42, 16);
scene.add(sun);
scene.add(sun.target);
const nightSunColor = new THREE.Color(0x8fa3ff);
const duskSunColor = new THREE.Color(0xff9a4d);
const daySunColor = new THREE.Color(0xfff1d6);

/* ---------------- audio (synthesized, no files) ---------------- */
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function blip(freqA, freqB, dur, type, vol) {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freqA, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, freqB), t + dur);
  g.gain.setValueAtTime(vol || 0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  coin: () => blip(880, 1560, 0.09, 'sine', 0.14),
  jump: () => blip(220, 520, 0.16, 'triangle', 0.12),
  land: () => blip(120, 90, 0.08, 'sine', 0.1),
  crash: () => { blip(200, 40, 0.5, 'sawtooth', 0.3); blip(90, 30, 0.6, 'square', 0.18); },
  start: () => blip(330, 660, 0.2, 'triangle', 0.12),
  magnet: () => blip(420, 880, 0.16, 'sine', 0.14),
  shield: () => blip(300, 640, 0.18, 'triangle', 0.14),
  slowmo: () => blip(520, 260, 0.3, 'sine', 0.14),
  smash: () => { blip(180, 60, 0.25, 'square', 0.22); blip(700, 900, 0.1, 'sine', 0.1); },
  roar: () => { blip(85, 28, 1.0, 'sawtooth', 0.4); blip(140, 45, 0.9, 'square', 0.22); },
  goldrush: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      setTimeout(() => blip(f, f * 1.02, 0.22, 'triangle', 0.15), i * 85));
  },
};

/* ---------------- state ---------------- */
const state = {
  mode: 'boot', lane: 1, x: 0, y: 0, vy: 0, z: 0,
  speed: START_SPEED, distance: 0, coins: 0, bonus: 0, deadAt: 0,
  idolMeter: 0, goldT: 0, nextRoar: 15, lungeT: 0,
};

/* ---------------- assets ---------------- */
const loader3d = new GLTFLoader();
let MODELS = null;

async function loadAssets() {
  const tex = new THREE.TextureLoader();
  const grassTex = tex.load('assets/textures/grass.jpg');
  const pathTex = tex.load('assets/textures/path.jpg');
  for (const t of [grassTex, pathTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
  }
  const names = ['palm', 'bamboo', 'banana', 'rock', 'spider'];
  const gltfs = await Promise.all(names.map((n) => loader3d.loadAsync(`assets/models/${n}.glb`)));
  MODELS = Object.fromEntries(names.map((n, i) => [n, gltfs[i]]));
  return { grassTex, pathTex };
}

/* ---------------- custom shader sky (day -> sunset -> night) ---------------- */
let sky, skyMat;

function buildSky() {
  const geo = new THREE.SphereGeometry(240, 36, 22);
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uT: { value: 0.15 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
      uMoonDir: { value: new THREE.Vector3(0.7, 0.2, -0.35).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vDir;
      uniform float uT;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float t = uT;
        float sunset = smoothstep(0.42, 0.80, t);
        float night  = smoothstep(0.70, 1.00, t);

        vec3 dayZen = vec3(0.42, 0.62, 0.82);
        vec3 dayHor = vec3(0.86, 0.93, 0.97);
        vec3 sunZen = vec3(0.16, 0.22, 0.38);
        vec3 sunHor = vec3(1.00, 0.40, 0.16);
        vec3 ngtZen = vec3(0.012, 0.016, 0.055);
        vec3 ngtHor = vec3(0.05, 0.09, 0.20);

        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 dayCol = mix(dayHor, dayZen, pow(h, 0.8));
        vec3 sunCol = mix(sunHor, sunZen, pow(h, 0.8));
        vec3 ngtCol = mix(ngtHor, ngtZen, pow(h, 0.8));

        vec3 col = mix(dayCol, sunCol, sunset);
        col = mix(col, ngtCol, night);

        // sun disc + halo
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        float disc = smoothstep(0.9986, 0.9993, sd);
        float halo = pow(sd, 40.0) * 0.4 + pow(sd, 8.0) * 0.16;
        float sunVis = (1.0 - smoothstep(0.55, 0.95, t)) * (1.0 - night);
        col += (vec3(1.0, 0.95, 0.85) * disc + vec3(1.0, 0.5, 0.2) * halo) * sunVis;

        // sunset band hugging the horizon
        col += vec3(1.0, 0.32, 0.08) * pow(1.0 - abs(d.y), 3.0) * sunset * (1.0 - night) * 0.55;

        // moon + halo
        float md = max(dot(d, normalize(uMoonDir)), 0.0);
        col += vec3(0.9, 0.95, 1.0) * smoothstep(0.99925, 0.99965, md) * night;
        col += vec3(0.5, 0.6, 0.9) * pow(md, 60.0) * 0.45 * night;

        // procedural stars
        vec2 sp = d.xz / (d.y + 0.45);
        vec2 cell = floor(sp * 72.0);
        float r = hash(cell);
        float star = smoothstep(0.982, 1.0, r) * smoothstep(0.05, 0.35, d.y);
        col += vec3(1.0, 0.95, 0.85) * star * night * (0.65 + 0.35 * sin(r * 90.0 + t * 9.0));

        // below the horizon fades to void-darkness
        col = mix(col, vec3(0.020, 0.016, 0.022), smoothstep(-0.02, -0.35, d.y));

        // linear -> sRGB (custom shaders must convert manually)
        col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  sky = new THREE.Mesh(geo, skyMat);
  sky.renderOrder = -10;
  scene.add(sky);
}

/* ---------------- collapsing ground (disintegrates into a golden void) ---------------- */
const groundMats = [];

function buildCollapsingGround(tex, w, h, repeatX, repeatY, yPos) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;

  const uCollapseZ = { value: -12 };
  const uNight = { value: 0 };

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0.0,
  });
  if (yPos > 0) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCollapseZ = uCollapseZ;
    shader.uniforms.uNight = uNight;
    shader.vertexShader = 'uniform float uCollapseZ;\nuniform float uNight;\nvarying float vSink;\n'
      + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 _wp = modelMatrix * vec4(transformed, 1.0);
          float _side = smoothstep(0.0, 8.0, abs(_wp.x) - 5.8);
          float _back = smoothstep(0.0, 14.0, uCollapseZ - _wp.z);
          float _sink = max(_side, _back);
          transformed.y -= _sink * _sink * 70.0;
          transformed.y = max(transformed.y, -70.0);
          vSink = _sink;
        }`
      );
    shader.fragmentShader = 'uniform float uCollapseZ;\nuniform float uNight;\nvarying float vSink;\n'
      + shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        {
          float _keep = 1.0 - smoothstep(0.10, 0.75, vSink);
          float _rim = smoothstep(0.0, 0.16, vSink) * (1.0 - smoothstep(0.3, 0.85, vSink));
          gl_FragColor.rgb = gl_FragColor.rgb * _keep
            + vec3(1.0, 0.6, 0.14) * _rim * (1.9 + uNight * 1.2)
            + vec3(0.35, 0.14, 0.02) * _rim * 0.9;
        }`
      );
  };

  const segX = Math.max(2, Math.round(w / 5));
  const segY = Math.max(2, Math.round(h / 5));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, segX, segY), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yPos;
  mesh.frustumCulled = false;
  mesh.userData.uCollapseZ = uCollapseZ;
  mesh.userData.uNight = uNight;
  scene.add(mesh);
  groundMats.push(mesh);
  return mesh;
}

let grassPlane, pathPlane;
let player, chaser, shieldBubble;
const segments = [];
let lastObstacleLane = -1;
let chaserGlowMats = [];
let goldMats = [];

/* ---------------- blob shadows (cheap contact shadows, no shadow maps) ---------------- */
let blobTex, blobMat;
function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function addBlob(parent, radius) {
  if (!blobTex) blobTex = makeBlobTexture();
  if (!blobMat) {
    blobMat = new THREE.SpriteMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.42 });
  }
  const s = new THREE.Sprite(blobMat);
  s.scale.setScalar(radius * 2.6);
  s.position.y = 0.035;
  parent.add(s);
  return s;
}

/* ---------------- particles (additive points) ---------------- */
const MAXP = 900;
const pPos = new Float32Array(MAXP * 3);
const pCol = new Float32Array(MAXP * 3);
const pSize = new Float32Array(MAXP);
const pVel = new Float32Array(MAXP * 3);
const pLife = new Float32Array(MAXP);
const pMax = new Float32Array(MAXP);
const pGrav = new Float32Array(MAXP);
let pCursor = 0;
let points = null;

const POINTS_VERT = `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vC;
  void main() {
    vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    if (mv.z > -0.35) {
      // behind the camera: would project as a giant quad — kill it
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
    } else {
      gl_PointSize = min(aSize * (150.0 / -mv.z), 90.0);
      gl_Position = projectionMatrix * mv;
    }
  }`;
const POINTS_FRAG = `
  precision mediump float;
  varying vec3 vC;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.06, d);
    gl_FragColor = vec4(pow(max(vC, vec3(0.0)), vec3(1.0 / 2.2)), a);
  }`;

function buildParticles() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
}

function spawnP(x, y, z, vx, vy, vz, life, size, r, g, b, grav = 0) {
  const i = pCursor;
  pCursor = (pCursor + 1) % MAXP;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b;
  pSize[i] = size;
  pLife[i] = life; pMax[i] = life; pGrav[i] = grav;
}

function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    if (pLife[i] <= 0) { pSize[i] = 0; continue; }
    pLife[i] -= dt;
    const k = Math.max(0, pLife[i] / pMax[i]);
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    pVel[i * 3 + 1] += pGrav[i] * dt;
    pSize[i] = Math.max(0, pSize[i] * 0.996) * (0.3 + 0.7 * k);
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.aSize.needsUpdate = true;
}

let dustT = 0, emberT = 0, trailT = 0;
function emitAmbient(dt, nowT) {
  const run = state.mode === 'run';
  // dust from the runner's feet
  if (run && state.y <= 0.01) {
    dustT -= dt;
    if (dustT <= 0) {
      dustT = 0.05;
      spawnP(
        state.x + (Math.random() - 0.5) * 0.5, 0.08, state.z - 0.3,
        (Math.random() - 0.5) * 0.9, 0.5 + Math.random() * 1.1, -0.6 - Math.random() * 0.8,
        0.4 + Math.random() * 0.3, 2.2 + Math.random() * 2.4,
        0.85, 0.78, 0.62
      );
    }
  }
  // golden embers rising from the collapsing rims on both sides
  emberT -= dt;
  if (emberT <= 0) {
    emberT = 0.035;
    const side = Math.random() < 0.5 ? -1 : 1;
    const z = state.z - 11 + Math.random() * 28;
    spawnP(
      side * (6.0 + Math.random() * 2.4), Math.random() * 1.4, z,
      -side * (0.2 + Math.random() * 0.5), 1.0 + Math.random() * 2.4, 0.2 + Math.random() * 0.4,
      1.4 + Math.random() * 1.2, 2.0 + Math.random() * 2.6,
      1.0, 0.55 + Math.random() * 0.3, 0.14, 0.2
    );
  }
  // golden trail during GOLD RUSH
  if (run && state.goldT > 0) {
    trailT -= dt;
    if (trailT <= 0) {
      trailT = 0.035;
      spawnP(
        state.x + (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 1.4, state.z - 0.5,
        (Math.random() - 0.5) * 0.6, -0.2 + Math.random() * 0.5, -0.8 - Math.random() * 0.6,
        0.5, 2.6 + Math.random() * 2,
        1.0, 0.82, 0.3
      );
    }
  }
}

function burstAt(x, y, z, color, n = 16, speed = 3.2) {
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const s = speed * (0.4 + Math.random() * 0.8);
    spawnP(
      x, y, z,
      s * Math.sin(ph) * Math.cos(th), s * Math.cos(ph) + 1.2, s * Math.sin(ph) * Math.sin(th),
      0.55 + Math.random() * 0.25, 3.2 + Math.random() * 2,
      color[0], color[1], color[2], -2.2
    );
  }
}

/* ---------------- fireflies (night) ---------------- */
const NFF = 46;
let fireflies = null;
const ffPos = new Float32Array(NFF * 3);
const ffCol = new Float32Array(NFF * 3);
const ffSize = new Float32Array(NFF);
const ffSeed = new Float32Array(NFF);

function buildFireflies() {
  for (let i = 0; i < NFF; i++) {
    ffPos[i * 3] = (Math.random() - 0.5) * 26;
    ffPos[i * 3 + 1] = 1 + Math.random() * 2.5;
    ffPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    ffCol[i * 3] = 0.72; ffCol[i * 3 + 1] = 1.0; ffCol[i * 3 + 2] = 0.5;
    ffSeed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(ffCol, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(ffSize, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  fireflies = new THREE.Points(geo, mat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);
}

function updateFireflies(night, nowT) {
  for (let i = 0; i < NFF; i++) {
    const s = ffSeed[i];
    ffPos[i * 3] += Math.sin(nowT * 0.55 + s) * 0.004;
    ffPos[i * 3 + 1] = 1.1 + Math.sin(nowT * 0.8 + s * 1.7) * 0.65 + s * 0.01;
    // stay in a band around the player
    if (ffPos[i * 3 + 2] < state.z - 34) ffPos[i * 3 + 2] += 68;
    if (ffPos[i * 3 + 2] > state.z + 34) ffPos[i * 3 + 2] -= 68;
    ffSize[i] = night * (1.1 + 1.2 * Math.sin(nowT * 1.4 + s * 2.3)) * (0.75 + 0.45 * Math.sin(nowT * 0.9 + s));
  }
  fireflies.geometry.attributes.position.needsUpdate = true;
  fireflies.geometry.attributes.aSize.needsUpdate = true;
}

/* ---------------- world ---------------- */
function cloneModel(name, scale = 1) {
  const gltf = MODELS[name];
  const root = gltf.scene.clone(true);
  root.scale.setScalar(scale);
  return root;
}

function tintClone(root, color, amount = 0.55) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      if (o.material.map) {
        o.material.color = new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 1 - amount);
      } else {
        o.material.color = new THREE.Color(color);
      }
    }
  });
  return root;
}

function makeIdol() {
  const idol = MODELS.rock.scene.clone(true);
  idol.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0xffc94d, metalness: 1, roughness: 0.28,
        emissive: 0x7a5200, emissiveIntensity: 0.5,
      });
    }
  });
  idol.scale.setScalar(0.26);
  addBlob(idol, 0.5);
  return idol;
}

function randomDecorSide(side /* -1 or 1 */) {
  const r = Math.random();
  let obj;
  if (r < 0.34) { obj = cloneModel('palm', 0.9 + Math.random() * 0.45); }
  else if (r < 0.66) { obj = cloneModel('bamboo', 0.8 + Math.random() * 0.5); }
  else if (r < 0.86) { obj = cloneModel('banana', 1.0 + Math.random() * 0.5); }
  else {
    obj = new THREE.Group();
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const rock = cloneModel('rock', 0.5 + Math.random() * 0.8);
      rock.position.set((Math.random() - 0.5) * 2.2, 0, (Math.random() - 0.5) * 2.2);
      rock.rotation.y = Math.random() * Math.PI * 2;
      obj.add(rock);
    }
  }
  obj.position.x = side * (6.2 + Math.random() * 6.5);
  obj.rotation.y = Math.random() * Math.PI * 2;
  return obj;
}

function makePowerup(type) {
  const cfg = POWERUP_TYPES[type];
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42),
    new THREE.MeshStandardMaterial({
      color: cfg.color, emissive: cfg.color, emissiveIntensity: 0.9,
      metalness: 0.2, roughness: 0.3,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.045, 8, 26),
    new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.75 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.4;
  g.add(core, ring);
  addBlob(g, 0.85);
  g.userData = { type, alive: true, baseY: 0.8, ring };
  return g;
}

function makeObstacle(lane) {
  const r = Math.random();
  const g = new THREE.Group();
  g.userData = { lane, jumpable: false };
  if (r < 0.42) {
    const rock = cloneModel('rock', 1.15 + Math.random() * 0.35);
    rock.rotation.y = Math.random() * Math.PI * 2;
    g.add(rock);
    g.userData.tall = 1.15;
  } else if (r < 0.72) {
    const rock = cloneModel('rock', 1.0 + Math.random() * 0.3);
    rock.scale.y = 0.38;
    rock.position.y = 0.12;
    g.add(rock);
    g.userData.jumpable = true;
    g.userData.tall = 0.5;
  } else {
    const log = cloneModel('bamboo', 0.32);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.22;
    g.add(log);
    g.userData.jumpable = true;
    g.userData.tall = 0.9;
  }
  g.userData.x = LANES[lane];
  addBlob(g, 1.5);
  return g;
}

function makeIdolRow(lane, z0) {
  const row = [];
  for (let i = 0; i < 5; i++) {
    const idol = makeIdol();
    idol.position.set(LANES[lane], 0.75, z0 + i * 2.1);
    idol.rotation.y = Math.random() * Math.PI * 2;
    idol.userData = { lane, alive: true, baseY: 0.75 };
    row.push(idol);
  }
  return row;
}

let flameTex = null;
function makeTorch() {
  if (!flameTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,190,0.95)');
    grad.addColorStop(0.35, 'rgba(255,160,50,0.75)');
    grad.addColorStop(1, 'rgba(255,80,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    flameTex = new THREE.CanvasTexture(c);
    flameTex.colorSpace = THREE.SRGBColorSpace;
  }
  const t = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 })
  );
  pole.position.y = 0.75;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.18, 0.2),
    new THREE.MeshStandardMaterial({
      color: 0x2a1c10, emissive: 0xff7a1a, emissiveIntensity: 0.05, roughness: 0.8,
    })
  );
  head.position.y = 1.56;
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flameTex, transparent: true, depthWrite: false, opacity: 0.04,
    blending: THREE.AdditiveBlending,
  }));
  flame.position.y = 1.95;
  flame.scale.setScalar(1.15);
  t.add(pole, head, flame);
  t.userData = { headMat: head.material, flameMat: flame.material, flame };
  return t;
}

function populateSegment(seg, baseZ) {
  for (const key of ['decor', 'obstacles', 'coins', 'powerups', 'torches']) {
    for (const o of seg.userData[key]) {
      seg.remove(o);
      disposeObject(o);
    }
    seg.userData[key] = [];
  }

  const sideL = randomDecorSide(-1);
  const sideR = randomDecorSide(1);
  const zL = 3 + Math.random() * (SEGMENT_LEN - 8);
  const zR = 3 + Math.random() * (SEGMENT_LEN - 8);
  sideL.position.z = zL; sideR.position.z = zR;
  seg.add(sideL, sideR);
  seg.userData.decor.push(sideL, sideR);
  if (Math.random() < 0.55) {
    const extra = randomDecorSide(Math.random() < 0.5 ? -1 : 1);
    extra.position.z = 3 + Math.random() * (SEGMENT_LEN - 8);
    seg.add(extra);
    seg.userData.decor.push(extra);
  }

  // torches line the path (they light up at night)
  for (const zz of [1.5, 14.5]) {
    for (const sx of [-4.9, 4.9]) {
      const torch = makeTorch();
      torch.position.set(sx, 0, zz);
      seg.add(torch);
      seg.userData.torches.push(torch);
    }
  }

  // one obstacle (sometimes two, spread out, different lanes, never the same as previous segment's last)
  const nObs = Math.random() < 0.45 ? 2 : 1;
  let lane = lastObstacleLane;
  const obsStart = baseZ === 0 ? 20 : 6;
  for (let i = 0; i < nObs; i++) {
    const candidates = [0, 1, 2].filter((l) => l !== lane);
    lane = candidates[Math.floor(Math.random() * candidates.length)];
    const ob = makeObstacle(lane);
    ob.position.z = obsStart + i * (SEGMENT_LEN - 14) + Math.random() * 4;
    ob.position.x = LANES[lane];
    seg.add(ob);
    seg.userData.obstacles.push(ob);
  }
  lastObstacleLane = lane;

  // idol row on a free lane
  const busyLanes = new Set(seg.userData.obstacles.map((o) => o.userData.lane));
  const free = [0, 1, 2].filter((l) => !busyLanes.has(l));
  if (free.length && Math.random() < 0.9) {
    const cl = free[Math.floor(Math.random() * free.length)];
    const cz = 6 + Math.random() * 9;
    for (const idol of makeIdolRow(cl, cz)) {
      seg.add(idol);
      seg.userData.coins.push(idol);
    }
  }

  // power-up on another free lane
  if (free.length > 1 && Math.random() < 0.28) {
    const pl = free[Math.floor(Math.random() * free.length)];
    const types = Object.keys(POWERUP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];
    const pu = makePowerup(type);
    pu.position.set(LANES[pl], 0.8, 6 + Math.random() * 9);
    seg.add(pu);
    seg.userData.powerups.push(pu);
  }
}

function disposeObject(o) {
  o.traverse((n) => {
    if (n.isMesh) {
      n.geometry && n.geometry.dispose && n.geometry.dispose();
      if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose && m.dispose());
      else n.material && n.material.dispose && n.material.dispose();
    }
  });
}

/* ---------------- player character (idol thief) ---------------- */
function buildRunner() {
  const runner = new THREE.Group();
  const std = (color, rough = 0.85) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

  const skinM = std(0xe8b98a, 0.75);
  const shirtM = std(0x3b6fd4, 0.8);
  const pantsM = std(0x6b4a2f, 0.9);
  const bootsM = std(0x423a30, 0.7);
  const hatM = std(0x8a5a2b, 0.75);
  const sashM = std(0xc0392b, 0.7);
  const packM = std(0x5c4a32, 0.85);

  const legGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.6, 10);
  legGeo.translate(0, -0.3, 0);
  const legL = new THREE.Mesh(legGeo, pantsM); legL.position.set(-0.09, 0.5, 0);
  const legR = new THREE.Mesh(legGeo, pantsM); legR.position.set(0.09, 0.5, 0);
  const bootGeo = new THREE.BoxGeometry(0.13, 0.12, 0.24);
  const bootL = new THREE.Mesh(bootGeo, bootsM); bootL.position.set(0, -0.42, 0.04);
  const bootR = new THREE.Mesh(bootGeo, bootsM); bootR.position.set(0, -0.42, 0.04);
  legL.add(bootL); legR.add(bootR);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.135, 0.5, 14), shirtM);
  torso.position.y = 1.05;
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 20), sashM);
  sash.position.y = 0.88;

  const armGeo = new THREE.CylinderGeometry(0.05, 0.042, 0.5, 10);
  armGeo.translate(0, -0.25, 0);
  const armL = new THREE.Mesh(armGeo, shirtM); armL.position.set(-0.235, 1.2, 0);
  const armR = new THREE.Mesh(armGeo, shirtM); armR.position.set(0.235, 1.2, 0);
  const handGeo = new THREE.SphereGeometry(0.052, 10, 8);
  const handL = new THREE.Mesh(handGeo, skinM); handL.position.set(0, -0.28, 0);
  const handR = new THREE.Mesh(handGeo, skinM); handR.position.set(0, -0.28, 0);
  armL.add(handL); armR.add(handR);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), skinM);
  head.position.y = 1.45;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 18), hatM);
  brim.position.y = 1.575;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.185, 0.13, 16), hatM);
  crown.position.y = 1.645;

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.16), packM);
  pack.position.set(0, 1.1, -0.22);
  const idol = MODELS.rock.scene.clone(true);
  idol.traverse((o) => {
    if (o.isMesh) o.material = new THREE.MeshStandardMaterial({
      color: 0xffc94d, metalness: 1, roughness: 0.3,
      emissive: 0x6b4a00, emissiveIntensity: 0.55,
    });
  });
  idol.scale.setScalar(0.13);
  idol.position.set(0, 1.3, -0.28);
  idol.rotation.y = 0.6;

  runner.add(legL, legR, torso, sash, armL, armR, head, brim, crown, pack, idol);
  runner.userData = { legL, legR, armL, armR, runPhase: 0 };
  return runner;
}

function setPlayerGold(on) {
  goldMats = [];
  player.traverse((o) => {
    if (!o.isMesh || o === shieldBubble) return;
    if (on) {
      o.userData.origMat = o.material;
      const m = new THREE.MeshStandardMaterial({
        color: 0xffd76e, metalness: 1, roughness: 0.22,
        emissive: 0xb87800, emissiveIntensity: 0.55,
      });
      o.material = m;
      goldMats.push(m);
    } else if (o.userData.origMat) {
      o.material = o.userData.origMat;
    }
  });
}

/* ---------------- build the world ---------------- */
function buildWorld() {
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = new THREE.Group();
    seg.userData = { decor: [], obstacles: [], coins: [], powerups: [], torches: [], baseZ: i * SEGMENT_LEN };
    seg.position.z = seg.userData.baseZ;
    scene.add(seg);
    populateSegment(seg, seg.userData.baseZ);
    segments.push(seg);
  }

  player = buildRunner();
  player.position.set(0, 0, 0);
  scene.add(player);
  addBlob(player, 1.05);

  shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x7dffa0, transparent: true, opacity: 0.22, depthWrite: false })
  );
  shieldBubble.visible = false;
  player.add(shieldBubble);

  chaser = tintClone(cloneModel('spider', 1.15), '#3a2b1f', 0.75);
  chaser.position.set(0, 0, -CHASE_GAP);
  scene.add(chaser);
  addBlob(chaser, 2.6);
  chaser.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o !== shieldBubble) {
      chaserGlowMats.push(o.material);
    }
  });
}

/* ---------------- input ---------------- */
function setLane(d) {
  const next = Math.max(0, Math.min(2, state.lane + d));
  if (next !== state.lane && state.mode === 'run') {
    state.lane = next;
    laneSwitchT = 0;
    laneFromX = state.x;
  }
}
function jump() {
  if (state.mode === 'run' && state.y <= 0.001) {
    state.vy = JUMP_V;
    sfx.jump();
  }
}

window.addEventListener('keydown', (e) => {
  if (state.mode === 'menu' && (e.code === 'Space' || e.code === 'Enter')) { startGame(); return; }
  if (state.mode === 'dead' && (e.code === 'Space' || e.code === 'Enter')) { startGame(); return; }
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': setLane(-1); e.preventDefault(); break;
    case 'ArrowRight': case 'KeyD': setLane(1); e.preventDefault(); break;
    case 'ArrowUp': case 'KeyW': case 'Space': jump(); e.preventDefault(); break;
  }
});

let touchStart = null;
window.addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
}, { passive: true });
window.addEventListener('touchend', (e) => {
  if (!touchStart || state.mode === 'boot') return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  const dt = performance.now() - touchStart.t;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 24 && ay < 24 && dt < 300) {
    if (state.mode === 'menu' || state.mode === 'dead') startGame();
    else jump();
  } else if (ay > ax && dy < -30) {
    jump();
  } else if (ax > ay && Math.abs(dx) > 30) {
    setLane(dx > 0 ? 1 : -1);
  }
  touchStart = null;
}, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- fx helpers ---------------- */
let shakeA = 0;
function shake(a) { shakeA = Math.min(1.3, shakeA + a); }

let bannerTimer = null;
function showBanner(text) {
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 1350);
}

let vignetteTimer = null;
function flashVignette(kind) {
  vignetteEl.style.background = kind === 'gold'
    ? 'radial-gradient(ellipse at center, rgba(255,196,60,0.32), rgba(255,120,0,0.10) 60%, transparent 100%)'
    : 'radial-gradient(ellipse at center, rgba(255,40,30,0.30), rgba(180,0,0,0.10) 65%, transparent 100%)';
  vignetteEl.style.opacity = '0.95';
  if (vignetteTimer) clearTimeout(vignetteTimer);
  vignetteTimer = setTimeout(() => { vignetteEl.style.opacity = '0'; }, 70);
}

/* ---------------- game flow ---------------- */
let laneSwitchT = 1;
let laneFromX = 0;

function startGame() {
  audio();
  sfx.start();
  state.mode = 'run';
  laneSwitchT = 1; laneFromX = 0;
  state.lane = 1; state.x = 0; state.y = 0; state.vy = 0;
  state.bonus = 0;
  state.z = 0; state.speed = START_SPEED; state.distance = 0; state.coins = 0;
  state.idolMeter = 0; state.goldT = 0; state.nextRoar = 15; state.lungeT = 0;
  setPlayerGold(false);
  fx.magnet = 0; fx.shield = 0; fx.slowmo = 0;
  shieldBubble.visible = false;
  if (player.userData) player.userData.runPhase = 0;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  chaser.position.set(0, 0, -CHASE_GAP);
  player.visible = true;
  elGoldFill.style.width = '0%';
  overlayMenu.classList.add('hidden');
  overlayDead.classList.add('hidden');
  hudLeft.classList.remove('hidden');
  hudRight.classList.remove('hidden');
  swipeHint.classList.remove('hidden');
  setTimeout(() => swipeHint.classList.add('hidden'), 4200);
}

function gameOver() {
  state.mode = 'dead';
  state.deadAt = performance.now();
  sfx.crash();
  shake(0.9);
  flashVignette('red');
  setPlayerGold(false);
  const finalScore = Math.floor(state.distance + state.coins * COIN_SCORE + state.bonus);
  if (finalScore > best) {
    best = finalScore;
    localStorage.setItem(BEST_KEY, String(best));
  }
  elFinalScore.textContent = `${finalScore} m`;
  elFinalCoins.textContent = String(state.coins);
  elFinalBest.textContent = `${best} m`;
  elFx.innerHTML = '';
  hudLeft.classList.add('hidden');
  swipeHint.classList.add('hidden');
  setTimeout(() => overlayDead.classList.remove('hidden'), 550);
}

function smashObstacle(ob) {
  ob.userData.smashed = true;
  ob.userData.smashT = 0;
  state.bonus += 15;
  sfx.smash();
  shake(0.3);
  const wx = ob.position.x, wy = 0.6, wz = ob.parent.position.z + ob.position.z;
  burstAt(wx, wy, wz, [0.55, 0.62, 0.5], 12, 3.0);
}

function activateGold() {
  state.goldT = GOLD_TIME;
  state.idolMeter = 0;
  setPlayerGold(true);
  sfx.goldrush();
  flashVignette('gold');
  showBanner('GOLD RUSH!');
  shake(0.5);
  burstAt(state.x, 1.2, state.z + 0.5, [1.0, 0.78, 0.2], 26, 4.0);
}

function doRoar() {
  state.nextRoar = 13 + Math.random() * 8;
  state.lungeT = 1.3;
  sfx.roar();
  shake(0.55);
  flashVignette('red');
}

function collectIdol(idol) {
  if (!idol.userData.alive) return;
  idol.userData.alive = false;
  idol.visible = false;
  state.coins += 1;
  state.idolMeter += 1;
  if (state.goldT > 0) state.bonus += COIN_SCORE; // double value during GOLD RUSH
  burstAt(idol.position.x, idol.position.y + 0.2, idol.parent.position.z + idol.position.z, [1.0, 0.8, 0.25], 10, 2.4);
  sfx.coin();
  if (state.idolMeter >= GOLD_IDOLS && state.goldT <= 0) activateGold();
}

/* ---------------- day/night + lighting ---------------- */
function dayNightT() {
  if (state.mode === 'menu') return 0.15;
  return THREE.MathUtils.clamp((state.z - 25) / NIGHT_Z, 0, 1);
}

function updateSkyAndLights(t, nowT) {
  // sky
  skyMat.uniforms.uT.value = t;
  const sunEl = Math.max(0.02, 0.62 - 0.78 * t);
  skyMat.uniforms.uSunDir.value.set(0.42, sunEl, 0.3).normalize();
  skyMat.uniforms.uMoonDir.value.set(0.7, 0.22 + 0.45 * t, -0.3).normalize();

  const dusk = smoothstep(0.42, 0.8, t) * (1 - smoothstep(0.8, 1, t));
  const night = smoothstep(0.7, 1, t);

  // fog
  const fogC = new THREE.Color().copy(dayFog).lerp(duskFog, dusk).lerp(nightFog, night);
  scene.fog.color.copy(fogC);

  // hemisphere light
  hemi.intensity = 1.0 - 0.6 * night;
  hemi.color.setRGB(1, 1, 1).lerp(new THREE.Color(0x8599c9), night * 0.75);
  hemi.groundColor.setRGB(0.4, 0.42, 0.35).lerp(new THREE.Color(0x0d1018), night * 0.8);

  // sun / moon light
  sun.intensity = 2.3 - 1.8 * night + 0.3 * dusk;
  sun.color.copy(daySunColor).lerp(duskSunColor, dusk).lerp(nightSunColor, night);
  sun.position.set(state.x + 30, 4 + 42 * Math.max(0.06, 1 - t * 1.15), state.z + 16);
  sun.target.position.set(state.x, 0, state.z);

  // ground night tint + collapse glow
  for (const m of groundMats) {
    m.userData.uNight.value = night;
    m.userData.uCollapseZ.value = state.z - COLLAPSE_DIST;
  }

  // blob shadows deepen at night
  if (blobMat) blobMat.opacity = 0.42 + 0.24 * night;

  // guardian's eyes burn red at night
  const glow = night * (0.45 + 0.55 * Math.sin(nowT * 6.5)) * 0.9;
  for (const m of chaserGlowMats) {
    if (glow > 0.01) {
      m.emissive.setRGB(0.45 * glow, 0.02, 0.02);
    } else {
      m.emissive.setRGB(0, 0, 0);
    }
  }

  // gold aura pulse
  for (const m of goldMats) {
    m.emissiveIntensity = 0.5 + 0.4 * Math.sin(nowT * 11);
  }

  return { night, dusk };
}

function updateTorches(night, nowT) {
  for (const seg of segments) {
    for (const torch of seg.userData.torches) {
      const flick = 0.78 + 0.22 * Math.sin(nowT * 12.5 + torch.position.z * 3.1) * Math.sin(nowT * 5.2 + torch.position.x * 7.7);
      torch.userData.headMat.emissiveIntensity = 0.04 + night * 3.6 * flick;
      torch.userData.flameMat.opacity = 0.03 + night * 0.9 * flick;
    }
  }
}

function updateSinking(dt) {
  const cz = state.z - COLLAPSE_DIST;
  for (const seg of segments) {
    for (const list of [seg.userData.decor, seg.userData.obstacles, seg.userData.coins, seg.userData.powerups, seg.userData.torches]) {
      for (const o of list) {
        if (!o.userData || o.userData.smashed) continue;
        const wz = seg.position.z + o.position.z;
        const behind = (cz - wz) / 12.0;
        // jungle decor also falls sideways into the void (the bridge narrows)
        const lateral = list === seg.userData.decor ? (Math.abs(o.position.x) - 6.4) / 4.5 : 0;
        const f = Math.max(behind, lateral);
        if (f > 0 && o.position.y > -30) {
          o.position.y -= (8 + f * 14) * dt;
          o.rotation.z += dt * (0.6 + f * 0.9);
          const ns = Math.max(0.04, o.scale.x - dt * (0.5 + f * 1.1));
          o.scale.setScalar(ns);
        }
      }
    }
  }
}

/* ---------------- update ---------------- */
const clock = new THREE.Clock();

function update(dt) {
  const nowT = performance.now() / 1000;
  const tDay = dayNightT();
  const { night } = updateSkyAndLights(tDay, nowT);
  updateTorches(night, nowT);
  updateFireflies(night, nowT);
  updateParticles(dt);
  emitAmbient(dt, nowT);
  updateSinking(dt);

  if (state.mode === 'menu') {
    // cinematic attract orbit
    const a = nowT * 0.22;
    camera.position.set(Math.sin(a) * 8.2, 3.3 + Math.sin(a * 0.63) * 0.55, Math.cos(a) * 8.2 - 2);
    camera.lookAt(0, 1.05, 0);
    return;
  }
  if (state.mode !== 'run' && state.mode !== 'dead') return;

  if (state.mode === 'run') {
    // effect timers
    for (const k of Object.keys(fx)) fx[k] = Math.max(0, fx[k] - dt);
    if (state.goldT > 0) {
      state.goldT -= dt;
      if (state.goldT <= 0) { state.goldT = 0; setPlayerGold(false); }
    }

    state.speed = Math.min(MAX_SPEED, state.speed + RAMP * dt * (fx.slowmo > 0 ? 0.35 : 1));
    const eff = state.speed * (fx.slowmo > 0 ? 0.62 : 1);
    const goldMult = state.goldT > 0 ? 2 : 1;
    state.distance += eff * dt * goldMult;
    state.z += eff * dt;

    // guardian roar + lunge
    state.nextRoar -= dt;
    if (state.nextRoar <= 0) doRoar();
    state.lungeT = Math.max(0, state.lungeT - dt);

    // lane lerp
    laneSwitchT = Math.min(1, laneSwitchT + dt * 5.2);
    const targetX = LANES[state.lane];
    const tt = laneSwitchT * laneSwitchT * (3 - 2 * laneSwitchT);
    state.x = laneFromX + (targetX - laneFromX) * tt;

    // jump physics
    state.vy += GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) {
      if (state.vy < -8.5) { shake(0.22); sfx.land(); }
      state.y = 0; state.vy = 0;
    }
  }

  // player transform + animation
  const bob = state.mode === 'run' ? Math.abs(Math.sin(performance.now() * 0.011)) * 0.12 : 0;
  player.position.set(state.x, state.y + bob, state.z);
  player.rotation.y = 0;
  const tilt = (LANES[state.lane] - state.x) * 0.16;
  player.rotation.z = THREE.MathUtils.clamp(tilt, -0.28, 0.28);

  const u = player.userData;
  if (state.mode === 'dead') {
    player.rotation.x = -1.35;
    u.legL.rotation.x = 0.6; u.legR.rotation.x = -0.2;
    u.armL.rotation.x = -2.2; u.armR.rotation.x = -1.9;
  } else if (state.y > 0.01) {
    player.rotation.x = 0.08;
    u.legL.rotation.x = 0.85; u.legR.rotation.x = 0.45;
    u.armL.rotation.x = -2.5; u.armR.rotation.x = -2.5;
  } else {
    player.rotation.x = 0.13;
    u.runPhase += dt * (6 + state.speed * 1.1);
    const s = Math.sin(u.runPhase);
    u.legL.rotation.x = s * 0.8; u.legR.rotation.x = -s * 0.8;
    u.armL.rotation.x = -0.2 - s * 0.65; u.armR.rotation.x = -0.2 + s * 0.65;
  }

  // chaser (creeps closer as you speed up; lunges when it roars)
  const chaseSpeed = state.mode === 'run' ? 1.0 : 6.5;
  chaser.position.x += (state.x - chaser.position.x) * Math.min(1, dt * 1.6);
  const baseGap = state.mode === 'run'
    ? CHASE_GAP - ((state.speed - START_SPEED) / (MAX_SPEED - START_SPEED)) * 0.8
    : 1.2;
  const gap = baseGap - 2.6 * (state.lungeT / 1.3);
  chaser.position.z += (state.z - gap - chaser.position.z) * Math.min(1, dt * chaseSpeed);
  chaser.position.y = state.mode === 'run'
    ? Math.abs(Math.sin(performance.now() * 0.011 + 2)) * 0.16
    : 0.1;
  chaser.rotation.z = THREE.MathUtils.clamp((state.x - chaser.position.x) * -0.08, -0.2, 0.2);

  // segment recycling
  for (const seg of segments) {
    const base = seg.userData.baseZ;
    if (state.z > base + SEGMENT_LEN) {
      seg.userData.baseZ += SEGMENTS * SEGMENT_LEN;
      seg.position.z = seg.userData.baseZ;
      populateSegment(seg, seg.userData.baseZ);
    }
  }

  // magnet: pull nearby idols toward the player
  if (fx.magnet > 0 || state.goldT > 0) {
    for (const seg of segments) {
      for (const idol of seg.userData.coins) {
        if (!idol.userData.alive) continue;
        const wz = seg.position.z + idol.position.z;
        if (Math.abs(wz - state.z) < 7 && Math.abs(idol.position.x - state.x) < 7) {
          idol.position.x += (state.x - idol.position.x) * Math.min(1, dt * 7);
          idol.position.z += ((state.z - seg.position.z) - idol.position.z) * Math.min(1, dt * 7);
        }
      }
    }
  }

  // shield bubble visuals
  shieldBubble.visible = fx.shield > 0;
  if (fx.shield > 0) {
    const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.06;
    shieldBubble.scale.setScalar(pulse);
    shieldBubble.material.opacity = fx.shield < 1.5 ? (Math.sin(performance.now() * 0.02) > 0 ? 0.3 : 0.1) : 0.22;
  }

  // collisions
  if (state.mode === 'run') {
    for (const seg of segments) {
      const b = seg.userData.baseZ;
      if (b > state.z + 8 || b + SEGMENT_LEN < state.z - 4) continue;
      for (const ob of seg.userData.obstacles) {
        if (ob.userData.smashed) continue;
        const worldZ = seg.position.z + ob.position.z;
        if (Math.abs(worldZ - state.z) < OBSTACLE_HALF_Z) {
          const ox = ob.userData.x;
          if (Math.abs(state.x - ox) < OBSTACLE_HALF_X) {
            if (ob.userData.jumpable && state.y > 0.55) continue;
            if (state.goldT > 0) { smashObstacle(ob); continue; }
            if (fx.shield > 0) { fx.shield = 0; smashObstacle(ob); continue; }
            gameOver();
            return;
          }
        }
      }
      for (const pu of seg.userData.powerups) {
        if (!pu.userData.alive) continue;
        const worldZ = seg.position.z + pu.position.z;
        if (Math.abs(worldZ - state.z) < 1.25 && Math.abs(state.x - pu.position.x) < 1.25 && Math.abs(state.y - 1.0) < 1.8) {
          pu.userData.alive = false;
          pu.visible = false;
          fx[pu.userData.type] = POWERUP_TYPES[pu.userData.type].dur;
          sfx[pu.userData.type]();
          burstAt(pu.position.x, 1.0, seg.position.z + pu.position.z, [0.55, 0.7, 1.0], 14, 2.6);
        }
      }
      for (const coin of seg.userData.coins) {
        if (!coin.userData.alive) continue;
        const worldZ = seg.position.z + coin.position.z;
        if (Math.abs(worldZ - state.z) < 1.15 && Math.abs(state.x - coin.position.x) < 1.2 && Math.abs(state.y - 1.0) < 1.6) {
          collectIdol(coin);
        }
      }
    }
  }

  // camera + shake + FOV kick
  const camX = state.x * 0.55;
  const camY = 3.9 + Math.max(0, state.y) * 0.25;
  const camZ = state.z - 6.8;
  camera.position.set(camX, camY, camZ);
  shakeA = Math.max(0, shakeA - dt * 1.8);
  const sh = shakeA * shakeA;
  camera.position.x += (Math.random() - 0.5) * 0.5 * sh;
  camera.position.y += (Math.random() - 0.5) * 0.35 * sh;
  camera.lookAt(state.x * 0.72, 0.9 + Math.max(0, state.y) * 0.3, state.z + 7);

  const targetFov = 70
    + ((state.speed - START_SPEED) / (MAX_SPEED - START_SPEED)) * 7
    + (state.goldT > 0 ? 4 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();

  // ground + sky follow
  const tile = 2;
  grassPlane.position.z = Math.round(state.z / tile) * tile;
  pathPlane.position.z = grassPlane.position.z;
  sky.position.z = state.z;

  // idol spin & powerup float; smash animation
  const now = performance.now() / 1000;
  for (const seg of segments) {
    for (const idol of seg.userData.coins) {
      if (!idol.userData.alive) continue;
      idol.rotation.y = now * 3;
      idol.position.y = idol.userData.baseY + Math.sin(now * 3 + idol.position.z) * 0.12;
    }
    for (const pu of seg.userData.powerups) {
      if (!pu.userData.alive) continue;
      pu.rotation.y = now * 2.4;
      pu.position.y = pu.userData.baseY + Math.sin(now * 3 + pu.position.z) * 0.16;
      const ring = pu.userData.ring;
      if (ring) {
        ring.rotation.z = now * 1.8;
        ring.scale.setScalar(1 + Math.sin(now * 5) * 0.12);
      }
    }
    for (const ob of seg.userData.obstacles) {
      if (!ob.userData.smashed) continue;
      ob.userData.smashT += dt;
      const k = Math.max(0, 1 - ob.userData.smashT * 3.5);
      ob.scale.setScalar(k);
      if (k <= 0) ob.visible = false;
    }
  }

  // HUD
  const totalScore = state.distance + state.coins * COIN_SCORE + state.bonus;
  elScore.textContent = `${Math.floor(totalScore)} m`;
  elSpeed.textContent = `${state.speed.toFixed(1)} m/s`;
  elCoins.textContent = String(state.coins);
  elBest.textContent = `${Math.max(best, Math.floor(totalScore))} m`;
  elGoldFill.style.width = state.goldT > 0
    ? '100%'
    : `${Math.min(100, state.idolMeter / GOLD_IDOLS * 100)}%`;
  const fxBits = [];
  if (state.goldT > 0) fxBits.push(`<span style="color:#ffd76e;font-weight:800">GOLD RUSH ×2 ${state.goldT.toFixed(1)}s</span>`);
  if (fx.magnet > 0) fxBits.push(`<span style="color:#5fb2ff">MAGNET ${Math.ceil(fx.magnet)}s</span>`);
  if (fx.shield > 0) fxBits.push(`<span style="color:#6fe08a">SHIELD ${Math.ceil(fx.shield)}s</span>`);
  if (fx.slowmo > 0) fxBits.push(`<span style="color:#c58bff">SLOW-MO ${Math.ceil(fx.slowmo)}s</span>`);
  elFx.innerHTML = fxBits.join(' · ');
}

function render() {
  renderer.render(scene, camera);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  render();
}

/* ---------------- boot ---------------- */
let ASSETS = null;
(async () => {
  try {
    ASSETS = await loadAssets();
    buildSky();
    buildParticles();
    buildFireflies();
    grassPlane = buildCollapsingGround(ASSETS.grassTex, 300, 320, 150, 160, -0.02);
    pathPlane = buildCollapsingGround(ASSETS.pathTex, 7.4, 320, 1, 160, 0.005);
    buildWorld();
    elBest.textContent = `${best} m`;
    loader.classList.add('hidden');
    state.mode = 'menu';
    overlayMenu.classList.remove('hidden');
    loop();
  } catch (err) {
    loader.innerHTML = `<div style="color:#ffb4a8;max-width:480px;text-align:center;font-size:14px">
      Failed to load assets: ${err.message || err}<br><br>
      Make sure the site is served over HTTP (not opened directly from disk).</div>`;
    console.error(err);
  }
})();

$('btn-play').addEventListener('click', startGame);
$('btn-restart').addEventListener('click', startGame);
