/* Temple Run — Web Edition
 * Built with the real 3D assets from the kenmaz/TempleRun-Unity clone,
 * converted FBX 6.0/6.1/7.3 -> GLB. Endless runner: 3 lanes, jump,
 * coins, and a giant spider on your heels. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ---------------- constants ---------------- */
const LANES = [-2.5, 0, 2.5];
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
const CHASE_GAP = 6.8;

/* ---------------- dom ---------------- */
const $ = (id) => document.getElementById(id);
const elScore = $('score'), elSpeed = $('speed'), elCoins = $('coins'), elBest = $('best');
const overlayMenu = $('overlay-menu'), overlayDead = $('overlay-dead');
const elFinalScore = $('final-score'), elFinalCoins = $('final-coins'), elFinalBest = $('final-best');
const hudLeft = $('hud-left'), hudRight = $('hud-right'), swipeHint = $('swipe-hint'), loader = $('loader');

const BEST_KEY = 'temple-run-web-best';
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
camera.position.set(0, 4.6, -7.2);

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
};

/* ---------------- state ---------------- */
const state = { mode: 'boot', lane: 1, x: 0, y: 0, vy: 0, z: 0, speed: START_SPEED, distance: 0, coins: 0, deadAt: 0 };

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
let player, chaser;
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

function makeCoin() {
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 22);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffc94d, metalness: 1, roughness: 0.25,
    emissive: 0x5a3d05, emissiveIntensity: 0.6,
  });
  const coin = new THREE.Mesh(geo, mat);
  coin.castShadow = true;
  return coin;
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

function makeCoinRow(lane, z0) {
  const row = [];
  for (let i = 0; i < 5; i++) {
    const coin = makeCoin();
    coin.position.set(LANES[lane], 0.85, z0 + i * 2.1);
    coin.rotation.x = Math.PI / 2;
    coin.userData = { lane, alive: true, baseY: 0.85 };
    row.push(coin);
  }
  return row;
}

function populateSegment(seg, baseZ) {
  // clear previous content
  for (const key of ['decor', 'obstacles', 'coins']) {
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
  const obsZ = [];
  for (let i = 0; i < nObs; i++) {
    let candidates = [0, 1, 2].filter((l) => l !== lane);
    lane = candidates[Math.floor(Math.random() * candidates.length)];
    const ob = makeObstacle(lane);
    ob.position.z = 6 + i * (SEGMENT_LEN - 14) + Math.random() * 4;
    ob.position.x = LANES[lane];
    seg.add(ob);
    seg.userData.obstacles.push(ob);
    obsZ.push(ob.position.z);
  }
  lastObstacleLane = lane;

  // coin row on a free lane
  const busyLanes = new Set(seg.userData.obstacles.map((o) => o.userData.lane));
  const free = [0, 1, 2].filter((l) => !busyLanes.has(l));
  if (free.length && Math.random() < 0.9) {
    const cl = free[Math.floor(Math.random() * free.length)];
    const cz = 6 + Math.random() * 9;
    for (const coin of makeCoinRow(cl, cz)) {
      seg.add(coin);
      seg.userData.coins.push(coin);
    }
  }
}

function disposeObject(o) {
  o.traverse((n) => {
    if (n.isMesh) {
      n.geometry && n.geometry.dispose && n.geometry !== coinGeo && n.geometry.dispose();
      if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose && m.dispose());
      else n.material && n.material.dispose && n.material.dispose();
    }
  });
}
const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 22);

function buildWorld() {
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = new THREE.Group();
    seg.userData = { decor: [], obstacles: [], coins: [], baseZ: i * SEGMENT_LEN };
    seg.position.z = seg.userData.baseZ;
    scene.add(seg);
    populateSegment(seg, seg.userData.baseZ);
    segments.push(seg);
  }

  player = MODELS.spider.scene.clone(true);
  player.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  player.position.set(0, 0, 0);
  scene.add(player);

  chaser = tintClone(cloneModel('spider', 1.45), '#3a2b1f', 0.75);
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
  if (state.distance > best) {
    best = Math.floor(state.distance);
    localStorage.setItem(BEST_KEY, String(best));
  }
  elFinalScore.textContent = `${Math.floor(state.distance)} m`;
  elFinalCoins.textContent = String(state.coins);
  elFinalBest.textContent = `${best} m`;
  hudLeft.classList.add('hidden');
  swipeHint.classList.add('hidden');
  setTimeout(() => overlayDead.classList.remove('hidden'), 550);
}

function collectCoin(coin) {
  if (!coin.userData.alive) return;
  coin.userData.alive = false;
  coin.visible = false;
  state.coins += 1;
  sfx.coin();
}

/* ---------------- update ---------------- */
const clock = new THREE.Clock();

function update(dt) {
  if (state.mode !== 'run' && state.mode !== 'dead') return;
  if (state.mode === 'run') {
    state.speed = Math.min(MAX_SPEED, state.speed + RAMP * dt);
    state.distance += state.speed * dt;
    state.z += state.speed * dt;

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
  const bob = state.mode === 'run' ? Math.abs(Math.sin(performance.now() * 0.011)) * 0.14 : 0;
  player.position.set(state.x, state.y + bob, 0);
  player.rotation.y = 0;
  const tilt = (LANES[state.lane] - state.x) * 0.16;
  player.rotation.z = THREE.MathUtils.clamp(tilt, -0.28, 0.28);

  // chaser
  const chaseSpeed = state.mode === 'run' ? 1.0 : 6.5;
  chaser.position.x += (state.x - chaser.position.x) * Math.min(1, dt * 1.6);
  const gap = state.mode === 'run' ? CHASE_GAP : 1.4;
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

  // collisions
  if (state.mode === 'run') {
    for (const seg of segments) {
      const b = seg.userData.baseZ;
      if (b > state.z + 8 || b + SEGMENT_LEN < state.z - 4) continue;
      for (const ob of seg.userData.obstacles) {
        const worldZ = seg.position.z + ob.position.z;
        if (Math.abs(worldZ - state.z) < OBSTACLE_HALF_Z) {
          const ox = ob.userData.x;
          if (Math.abs(state.x - ox) < OBSTACLE_HALF_X) {
            if (ob.userData.jumpable && state.y > 0.55) continue;
            gameOver();
            return;
          }
        }
      }
      for (const coin of seg.userData.coins) {
        if (!coin.userData.alive) continue;
        const worldZ = seg.position.z + coin.position.z;
        if (Math.abs(worldZ - state.z) < 1.15 && Math.abs(state.x - coin.position.x) < 1.2 && Math.abs(state.y - 1.0) < 1.6) {
          collectCoin(coin);
        }
      }
    }
  }

  // camera
  const camX = state.x * 0.55;
  const camY = 4.5 + Math.max(0, state.y) * 0.25;
  const camZ = state.z - 7.2;
  camera.position.set(camX, camY, camZ);
  camera.lookAt(state.x * 0.7, 1.5 + Math.max(0, state.y) * 0.3, state.z + 8);

  // sun + ground follow
  sun.position.set(state.x + 28, 42, state.z + 14);
  sun.target.position.set(state.x, 0, state.z);
  const tile = 2;
  grassPlane.position.z = Math.round(state.z / tile) * tile;
  pathPlane.position.z = grassPlane.position.z;

  // coin spin
  const now = performance.now() / 1000;
  for (const seg of segments) {
    for (const coin of seg.userData.coins) {
      if (!coin.userData.alive) continue;
      coin.rotation.z = now * 4;
      coin.position.y = coin.userData.baseY + Math.sin(now * 3 + coin.position.z) * 0.12;
    }
  }

  // HUD
  elScore.textContent = `${Math.floor(state.distance + state.coins * COIN_SCORE)} m`;
  elSpeed.textContent = `${state.speed.toFixed(1)} m/s`;
  elCoins.textContent = String(state.coins);
  elBest.textContent = `${Math.max(best, Math.floor(state.distance + state.coins * COIN_SCORE))} m`;
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

/* debug hook (used by automated tests) */
window.__forceDeath = () => { if (state.mode === 'run') gameOver(); };
