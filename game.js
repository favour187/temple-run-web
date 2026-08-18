/* Temple Run — Web Edition
 * Built with the real 3D assets from the kenmaz/TempleRun-Unity clone,
 * converted FBX 6.0/6.1/7.3 -> GLB. Endless runner: 3 lanes, jump,
 * coins, and a giant spider on your heels. */
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
const RAMP = 0.115;          // speed gain per second
const GRAVITY = -19;
const JUMP_V = 8.0;
const OBSTACLE_HALF_Z = 1.35;
const OBSTACLE_HALF_X = 1.05;
const COIN_SCORE = 25;
const CHASE_GAP = 9.5;

/* ---------------- dom ---------------- */
const $ = (id) => document.getElementById(id);
const elScore = $('score'), elSpeed = $('speed'), elCoins = $('coins'), elBest = $('best'), elFx = $('fx');
const overlayMenu = $('overlay-menu'), overlayDead = $('overlay-dead');
const elFinalScore = $('final-score'), elFinalCoins = $('final-coins'), elFinalBest = $('final-best');
const hudLeft = $('hud-left'), hudRight = $('hud-right'), swipeHint = $('swipe-hint'), loader = $('loader');

const BEST_KEY = 'idol-rush-best';
let best = Number(localStorage.getItem(BEST_KEY) || 0);

/* ---------------- renderer / scene ---------------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd3de);
scene.fog = new THREE.Fog(0xbfd3de, 46, 150);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 3.9, -6.8);

/* ---------------- lights ---------------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0x66755f, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
sun.position.set(28, 42, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28; sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 2; sun.shadow.camera.far = 130;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

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
  crash: () => { blip(200, 40, 0.5, 'sawtooth', 0.3); blip(90, 30, 0.6, 'square', 0.18); },
  start: () => blip(330, 660, 0.2, 'triangle', 0.12),
  magnet: () => blip(420, 880, 0.16, 'sine', 0.14),
  shield: () => blip(300, 640, 0.18, 'triangle', 0.14),
  slowmo: () => blip(520, 260, 0.3, 'sine', 0.14),
  smash: () => { blip(180, 60, 0.25, 'square', 0.22); blip(700, 900, 0.1, 'sine', 0.1); },
};

/* ---------------- state ---------------- */
const state = { mode: 'boot', lane: 1, x: 0, y: 0, vy: 0, z: 0, speed: START_SPEED, distance: 0, coins: 0, bonus: 0, deadAt: 0 };

/* ---------------- assets ---------------- */
const loader3d = new GLTFLoader();
let MODELS = null;

async function loadAssets() {
  const tex = new THREE.TextureLoader();
  const cubeTex = new THREE.CubeTextureLoader().setPath('assets/textures/sky/').load([
    'sunny1_right.jpg', 'sunny1_left.jpg',
    'sunny1_up.jpg', 'sunny1_down.jpg',
    'sunny1_front.jpg', 'sunny1_back.jpg',
  ]);
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
  return { cubeTex, grassTex, pathTex };
}

/* ---------------- world ---------------- */
let grassPlane, pathPlane;
let player, chaser, shieldBubble;
const segments = [];
let lastObstacleLane = -1;

function makeGround(grassTex, pathTex) {
  grassTex.repeat.set(150, 160);
  grassPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 320),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
  );
  grassPlane.rotation.x = -Math.PI / 2;
  grassPlane.position.y = -0.02;
  grassPlane.receiveShadow = true;
  scene.add(grassPlane);

  pathTex.repeat.set(1, 160);
  const pathMat = new THREE.MeshStandardMaterial({ map: pathTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 });
  pathPlane = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 320), pathMat);
  pathPlane.rotation.x = -Math.PI / 2;
  pathPlane.position.y = 0.005;
  pathPlane.receiveShadow = true;
  scene.add(pathPlane);
}

function cloneModel(name, scale = 1) {
  const gltf = MODELS[name];
  const root = gltf.scene.clone(true);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
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
  // a tiny golden idol made from the real rock model in the asset set
  const idol = MODELS.rock.scene.clone(true);
  idol.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0xffc94d, metalness: 1, roughness: 0.28,
        emissive: 0x7a5200, emissiveIntensity: 0.5,
      });
      o.castShadow = true;
    }
  });
  idol.scale.setScalar(0.26);
  return idol;
}

function randomDecorSide(side /* -1 or 1 */) {
  const r = Math.random();
  let obj, s;
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
  core.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.045, 8, 26),
    new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.75 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.4;
  g.add(core, ring);
  g.userData = { type, alive: true, baseY: 0.8, ring };
  return g;
}

function makeObstacle(lane) {
  const r = Math.random();
  const g = new THREE.Group();
  g.userData = { lane, jumpable: false };
  if (r < 0.42) {
    // tall rock — dodge it
    const rock = cloneModel('rock', 1.15 + Math.random() * 0.35);
    rock.rotation.y = Math.random() * Math.PI * 2;
    g.add(rock);
    g.userData.tall = 1.15;
  } else if (r < 0.72) {
    // low rock — jump it
    const rock = cloneModel('rock', 1.0 + Math.random() * 0.3);
    rock.scale.y = 0.38;
    rock.position.y = 0.12;
    g.add(rock);
    g.userData.jumpable = true;
    g.userData.tall = 0.5;
  } else {
    // fallen bamboo log — jump it
    const log = cloneModel('bamboo', 0.32);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.22;
    g.add(log);
    g.userData.jumpable = true;
    g.userData.tall = 0.9;
  }
  g.userData.x = LANES[lane];
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

function populateSegment(seg, baseZ) {
  // clear previous content
  for (const key of ['decor', 'obstacles', 'coins', 'powerups']) {
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

  // one obstacle (sometimes two, spread out, different lanes, never the same as previous segment's last)
  const nObs = Math.random() < 0.45 ? 2 : 1;
  let lane = lastObstacleLane;
  // warm-up: the very first segment keeps obstacles far away so runners can react
  const obsStart = baseZ === 0 ? 20 : 6;
  for (let i = 0; i < nObs; i++) {
    let candidates = [0, 1, 2].filter((l) => l !== lane);
    lane = candidates[Math.floor(Math.random() * candidates.length)];
    const ob = makeObstacle(lane);
    ob.position.z = obsStart + i * (SEGMENT_LEN - 14) + Math.random() * 4;
    ob.position.x = LANES[lane];
    seg.add(ob);
    seg.userData.obstacles.push(ob);
  }
  lastObstacleLane = lane;

  // coin row on a free lane
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


function buildRunner() {
  // A brand-new player character, hand-built from primitives:
  // an idol thief in a fedora with the stolen idol poking out of his backpack.
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

  // legs (pivot at the hip so they can swing)
  const legGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.6, 10);
  legGeo.translate(0, -0.3, 0);
  const legL = new THREE.Mesh(legGeo, pantsM); legL.position.set(-0.09, 0.5, 0);
  const legR = new THREE.Mesh(legGeo, pantsM); legR.position.set(0.09, 0.5, 0);
  const bootGeo = new THREE.BoxGeometry(0.13, 0.12, 0.24);
  const bootL = new THREE.Mesh(bootGeo, bootsM); bootL.position.set(0, -0.42, 0.04);
  const bootR = new THREE.Mesh(bootGeo, bootsM); bootR.position.set(0, -0.42, 0.04);
  legL.add(bootL); legR.add(bootR);

  // torso + red sash belt
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.135, 0.5, 14), shirtM);
  torso.position.y = 1.05;
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 20), sashM);
  sash.position.y = 0.88;

  // arms (pivot at the shoulder)
  const armGeo = new THREE.CylinderGeometry(0.05, 0.042, 0.5, 10);
  armGeo.translate(0, -0.25, 0);
  const armL = new THREE.Mesh(armGeo, shirtM); armL.position.set(-0.235, 1.2, 0);
  const armR = new THREE.Mesh(armGeo, shirtM); armR.position.set(0.235, 1.2, 0);
  const handGeo = new THREE.SphereGeometry(0.052, 10, 8);
  const handL = new THREE.Mesh(handGeo, skinM); handL.position.set(0, -0.28, 0);
  const handR = new THREE.Mesh(handGeo, skinM); handR.position.set(0, -0.28, 0);
  armL.add(handL); armR.add(handR);

  // head + fedora
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), skinM);
  head.position.y = 1.45;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 18), hatM);
  brim.position.y = 1.575;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.185, 0.13, 16), hatM);
  crown.position.y = 1.645;

  // backpack with the stolen idol peeking out
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
  runner.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  runner.userData = { legL, legR, armL, armR, runPhase: 0 };
  return runner;
}

function buildWorld() {
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = new THREE.Group();
    seg.userData = { decor: [], obstacles: [], coins: [], powerups: [], baseZ: i * SEGMENT_LEN };
    seg.position.z = seg.userData.baseZ;
    scene.add(seg);
    populateSegment(seg, seg.userData.baseZ);
    segments.push(seg);
  }

  player = buildRunner();
  player.position.set(0, 0, 0);
  scene.add(player);

  shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x7dffa0, transparent: true, opacity: 0.22, depthWrite: false })
  );
  shieldBubble.visible = false;
  player.add(shieldBubble);

  chaser = tintClone(cloneModel('spider', 1.15), '#3a2b1f', 0.75);
  chaser.position.set(0, 0, -CHASE_GAP);
  scene.add(chaser);

  scene.background = ASSETS.cubeTex;
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
    // tap
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
  fx.magnet = 0; fx.shield = 0; fx.slowmo = 0;
  shieldBubble.visible = false;
  if (player.userData) player.userData.runPhase = 0;
  state.z = 0; state.speed = START_SPEED; state.distance = 0; state.coins = 0;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  chaser.position.set(0, 0, -CHASE_GAP);
  player.visible = true;
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
  const finalScore = Math.floor(state.distance + state.coins * COIN_SCORE + state.bonus);
  if (finalScore > best) {
    best = finalScore;
    localStorage.setItem(BEST_KEY, String(best));
  }
  elFinalScore.textContent = `${Math.floor(state.distance + state.coins * COIN_SCORE + state.bonus)} m`;
  elFinalCoins.textContent = String(state.coins);
  elFinalBest.textContent = `${best} m`;
  elFx.innerHTML = '';
  hudLeft.classList.add('hidden');
  swipeHint.classList.add('hidden');
  setTimeout(() => overlayDead.classList.remove('hidden'), 550);
}

function collectIdol(idol) {
  if (!idol.userData.alive) return;
  idol.userData.alive = false;
  idol.visible = false;
  state.coins += 1;
  sfx.coin();
}

/* ---------------- update ---------------- */
const clock = new THREE.Clock();

function update(dt) {
  if (state.mode !== 'run' && state.mode !== 'dead') return;
  if (state.mode === 'run') {
    // effect timers
    for (const k of Object.keys(fx)) fx[k] = Math.max(0, fx[k] - dt);
    state.speed = Math.min(MAX_SPEED, state.speed + RAMP * dt * (fx.slowmo > 0 ? 0.35 : 1));
    const eff = state.speed * (fx.slowmo > 0 ? 0.62 : 1);
    state.distance += eff * dt;
    state.z += eff * dt;

    // lane lerp
    laneSwitchT = Math.min(1, laneSwitchT + dt * 5.2);
    const targetX = LANES[state.lane];
    const t = laneSwitchT * laneSwitchT * (3 - 2 * laneSwitchT);
    state.x = laneFromX + (targetX - laneFromX) * t;

    // jump physics
    state.vy += GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) { state.y = 0; state.vy = 0; }
  }

  // player transform + run animation
  const bob = state.mode === 'run' ? Math.abs(Math.sin(performance.now() * 0.011)) * 0.12 : 0;
  player.position.set(state.x, state.y + bob, state.z); // ride the world scroll
  player.rotation.y = 0;
  const tilt = (LANES[state.lane] - state.x) * 0.16;
  player.rotation.z = THREE.MathUtils.clamp(tilt, -0.28, 0.28);

  const u = player.userData;
  if (state.mode === 'dead') {
    // caught: tumble over
    player.rotation.x = -1.35;
    u.legL.rotation.x = 0.6; u.legR.rotation.x = -0.2;
    u.armL.rotation.x = -2.2; u.armR.rotation.x = -1.9;
  } else if (state.y > 0.01) {
    // airborne: legs tucked, arms up
    player.rotation.x = 0.08;
    u.legL.rotation.x = 0.85; u.legR.rotation.x = 0.45;
    u.armL.rotation.x = -2.5; u.armR.rotation.x = -2.5;
  } else {
    // running: swinging limbs, forward lean
    player.rotation.x = 0.13;
    u.runPhase += dt * (6 + state.speed * 1.1);
    const s = Math.sin(u.runPhase);
    u.legL.rotation.x = s * 0.8; u.legR.rotation.x = -s * 0.8;
    u.armL.rotation.x = -0.2 - s * 0.65; u.armR.rotation.x = -0.2 + s * 0.65;
  }

  // chaser (creeps closer as you speed up — drama, but never blocks the view)
  const chaseSpeed = state.mode === 'run' ? 1.0 : 6.5;
  chaser.position.x += (state.x - chaser.position.x) * Math.min(1, dt * 1.6);
  const gap = state.mode === 'run'
    ? CHASE_GAP - ((state.speed - START_SPEED) / (MAX_SPEED - START_SPEED)) * 0.8
    : 1.2;
  chaser.position.z += (state.z - gap - chaser.position.z) * Math.min(1, dt * chaseSpeed);
  chaser.position.y = state.mode === 'run' ? Math.abs(Math.sin(performance.now() * 0.011 + 2)) * 0.16 : 0.1;
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
  if (fx.magnet > 0) {
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
            if (fx.shield > 0) {
              // smash through it!
              fx.shield = 0;
              ob.userData.smashed = true;
              ob.userData.smashT = 0;
              state.bonus += 15;
              sfx.smash();
              continue;
            }
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

  // camera
  const camX = state.x * 0.55;
  const camY = 3.9 + Math.max(0, state.y) * 0.25;
  const camZ = state.z - 6.8;
  camera.position.set(camX, camY, camZ);
  camera.lookAt(state.x * 0.72, 0.9 + Math.max(0, state.y) * 0.3, state.z + 7);

  // sun + ground follow
  sun.position.set(state.x + 28, 42, state.z + 14);
  sun.target.position.set(state.x, 0, state.z);
  const tile = 2;
  grassPlane.position.z = Math.round(state.z / tile) * tile;
  pathPlane.position.z = grassPlane.position.z;

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
        const rs = 1 + Math.sin(now * 5) * 0.12;
        ring.scale.setScalar(rs);
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
  const fxBits = [];
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
    makeGround(ASSETS.grassTex, ASSETS.pathTex);
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

