import * as THREE from 'three';
import { RunnerGame } from './game-core.js';
import { loadRecoveredPack, characterFromGLB } from './asset-adapter.js';
import './style.css';

const $ = id => document.getElementById(id);
const canvas = $('game');
const game = new RunnerGame();
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  $('fatal-error').hidden = false;
  $('fatal-error').textContent = '当前浏览器无法启动 WebGL。请开启硬件加速后重新打开。';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb1d9d4);
scene.fog = new THREE.Fog(0xb1d9d4, 42, 125);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 190);
const ambient = new THREE.HemisphereLight(0xf2ffef, 0x46605e, 2.2);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffedc2, 2.4);
sun.position.set(-15, 28, 12); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 35, bottom: -35, near: 1, far: 80 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
sun.target.position.set(0, 0, -20); scene.add(sun, sun.target);

function mesh(geometry, color, parent = scene) {
  const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  object.receiveShadow = true; object.castShadow = true; parent.add(object); return object;
}
function box(width, height, depth, color, x, y, z, parent = scene) {
  const object = mesh(new THREE.BoxGeometry(width, height, depth), color, parent);
  object.position.set(x, y, z); return object;
}

const ground = mesh(new THREE.PlaneGeometry(350, 250), 0x9eaa95);
ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.57, -65); ground.castShadow = false;
const ballast = mesh(new THREE.PlaneGeometry(8.6, 240), 0x727e76);
ballast.rotation.x = -Math.PI / 2; ballast.position.set(0, -0.06, -65); ballast.castShadow = false;
const trackRoot = new THREE.Group(); scene.add(trackRoot);
const decorations = new THREE.Group(); scene.add(decorations);
const buildings = [];
// Recovered city prefab geometry is installed once the source pack is ready.
const scenerySpan = 180;
function createScenery() {
  for (const side of ['left', 'right']) for (let index = 0; index < 10; index++) {
    const object = pack.clonePrefab(`MexicoCity_med_01_${side}`);
    if (!object) continue;
    const z = 18 - index * 18;
    object.position.set(side === 'left' ? -1 : 1, 0, z);
    decorations.add(object); buildings.push({ object, z });
  }
}

const entityRoot = new THREE.Group(); scene.add(entityRoot);
const entityObjects = new Map(), trackObjects = [];
let pack = null, character = null, loaded = false, previousPhase = 'ready', previousTime = performance.now();
let best = 0;
try { best = Number(localStorage.getItem('subway-browser-best') || 0); } catch {}
if (!Number.isFinite(best)) best = 0;
$('best').textContent = Math.floor(best).toLocaleString();
$('start').disabled = true; $('start-label').textContent = '准备角色…';

function coinObject() {
  // Original mesh includes an offscreen sentinel triangle below the ground;
  // retain it, but do not use its full bounds to normalize the visible coin.
  return pack.cloneProp('currency_coin') ?? new THREE.Group();
}

function fitObstacle(object, entity) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3());
  const scale = new THREE.Vector3(entity.width / size.x, entity.height / size.y, entity.depth / size.z);
  object.scale.multiply(scale);
  // Place the actual extracted geometry at a centered collision footprint.
  const holder = new THREE.Group();
  object.position.set(-(bounds.min.x + bounds.max.x) / 2 * scale.x, -bounds.min.y * scale.y, -(bounds.min.z + bounds.max.z) / 2 * scale.z);
  holder.add(object); return holder;
}
function createEntity(entity) {
  if (entity.type === 'coin') return coinObject();
  const key = { train: 'default_train_standard', barrier: 'blocker_jump', overhead: 'blocker_roll', ramp: 'MexicoCity_train_ramp' }[entity.type];
  const recovered = key && pack?.cloneProp(key);
  if (recovered) return fitObstacle(recovered, entity);
  return new THREE.Group();
}

function updateEntities(time) {
  const ids = new Set();
  for (const entity of game.entities) {
    ids.add(entity.id);
    let object = entityObjects.get(entity.id);
    if (!object) { object = createEntity(entity); entityObjects.set(entity.id, object); entityRoot.add(object); }
    object.visible = !entity.collected;
    object.position.set(entity.x ?? (entity.lane - 1) * game.config.laneSpacing, entity.type === 'coin' ? entity.y ?? 1.1 : 0, -(entity.distance - game.state.distance));
    if (entity.type === 'coin') { object.rotation.y = time * 1.6 + entity.id * 0.3; object.position.y += Math.sin(time * 2.2 + entity.id * 0.7) * 0.06; }
  }
  for (const [id, object] of entityObjects) if (!ids.has(id)) { entityRoot.remove(object); entityObjects.delete(id); }
}

function installCharacter(next) {
  if (character) scene.remove(character.object);
  character = next; scene.add(character.object);
  $('asset-label').textContent = next.name;
  $('asset-status').classList.add('ready');
  window.__runner.character = character;
}

function createTracks() {
  for (let lane = 0; lane < 3; lane++) for (let i = 0; i < 10; i++) {
    const object = pack.clonePrefab('MexicoCity_track') ?? pack.cloneProp('track'); if (!object) continue;
    object.position.set((lane - 1) * game.config.laneSpacing, 0, 18 - i * 18);
    trackRoot.add(object); trackObjects.push({ object, z: 18 - i * 18 });
  }
}

window.__runner = { game, renderer, scene, camera, pack: null, character: null, ready: false, errors: [],
  snapshot: () => ({ phase: game.state.phase, distance: game.state.distance, player: { ...game.state.player }, entities: game.entities.length, character: character?.name, animations: character?.animationNames, drawCalls: renderer.info.render.calls }),
};

loadRecoveredPack().then(result => {
  pack = result; window.__runner.pack = result;
  installCharacter(result.character); createTracks(); createScenery(); loaded = true; window.__runner.ready = true;
  $('start').disabled = false; $('start-label').textContent = '开始奔跑';
}).catch(error => {
  console.error(error); window.__runner.errors.push(error.message);
  $('asset-label').textContent = '角色资源读取失败';
  $('menu-description').textContent = '资源尚未准备好，请刷新页面或检查资源同步。';
  $('start-label').textContent = '资源未就绪';
});

let toastTimer;
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
}

let audioContext = null, soundEnabled = false;
function sound(frequency, duration = 0.06, type = 'sine', volume = 0.035) {
  if (!soundEnabled) return;
  audioContext ??= new AudioContext();
  const osc = audioContext.createOscillator(), gain = audioContext.createGain();
  osc.type = type; osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(25, frequency * 0.7), audioContext.currentTime + duration);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration);
}

function start() {
  if (!loaded) return;
  if (game.state.phase === 'paused') game.pause();
  else { if (game.state.phase === 'gameover') { for (const object of entityObjects.values()) entityRoot.remove(object); entityObjects.clear(); } game.start(); }
  sound(440, 0.12); canvas.focus();
}
$('start').addEventListener('click', start);
$('pause').addEventListener('click', () => { if (loaded) game.pause(); });
$('sound').addEventListener('click', async () => {
  soundEnabled = !soundEnabled;
  $('sound').style.opacity = soundEnabled ? '1' : '.55';
  $('sound').setAttribute('aria-label', soundEnabled ? '关闭游戏音效' : '开启游戏音效');
  if (soundEnabled) { audioContext ??= new AudioContext(); await audioContext.resume(); sound(660); }
  toast(soundEnabled ? '音效已开启' : '音效已关闭');
});
$('sound').style.opacity = '.55';

const keyActions = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'roll', KeyS: 'roll' };
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) return;
  if (keyActions[event.code]) {
    event.preventDefault();
    if (event.repeat) return;
    if (game.state.phase === 'ready' || game.state.phase === 'gameover') { if (event.code === 'Space') start(); }
    else game.action(keyActions[event.code]);
  } else if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) game.pause();
  else if (event.code === 'Enter' && !event.repeat) start();
});
let pointerStart = null;
canvas.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointerup', event => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y; pointerStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
  game.action(Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'jump' : 'roll');
});
canvas.addEventListener('pointercancel', () => { pointerStart = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state.phase === 'running') game.pause(); previousTime = performance.now(); });

$('import-character').addEventListener('click', () => $('character-file').click());
$('character-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (game.state.phase === 'running') game.pause();
  $('import-character').disabled = true; toast('正在读取角色…');
  try {
    const next = await characterFromGLB(await file.arrayBuffer());
    next.name = file.name.replace(/\.glb$/i, ''); installCharacter(next);
    toast(next.animationNames.length ? '角色与内置动画已载入' : '角色已载入 · 模型尚未包含动画');
  } catch (error) { toast(`载入失败：${error.message}`); }
  finally { $('import-character').disabled = false; event.target.value = ''; }
});

function updateMenu() {
  const phase = game.state.phase;
  const running = phase === 'running';
  $('menu').classList.toggle('hidden', running);
  $('menu').inert = running;
  $('menu').setAttribute('aria-hidden', String(running));
  document.body.classList.toggle('playing', phase === 'running');
  $('pause').innerHTML = phase === 'paused' ? '▶' : '<span class="pause-glyph">Ⅱ</span>';
  $('pause').setAttribute('aria-label', phase === 'paused' ? '继续游戏' : '暂停游戏');
  if (phase === 'gameover') {
    const meters = Math.floor(game.state.distance / game.config.distancePerMeter);
    if (meters > best) { best = meters; try { localStorage.setItem('subway-browser-best', String(best)); } catch {} }
    $('best').textContent = best.toLocaleString();
    $('menu-title').innerHTML = '再来一局，<br><em>跑得更远。</em>';
    $('menu-description').textContent = '前面的轨道，还在等你。';
    $('result').hidden = false;
    $('result-distance').innerHTML = `${meters.toLocaleString()} <small>m</small>`;
    $('result-coins').textContent = game.state.coins.toLocaleString();
    $('start-label').textContent = '再跑一次';
  } else if (phase === 'paused') {
    $('menu-title').innerHTML = '稍作停留，<br><em>继续前进。</em>';
    $('menu-description').textContent = '按 P 或点击下方按钮继续。';
    $('result').hidden = true; $('start-label').textContent = '继续奔跑';
  }
}

function resize() {
  const width = innerWidth, height = innerHeight;
  renderer.setSize(width, height, false); camera.aspect = width / height;
  camera.fov = width < 700 ? 59 : 48; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
const lookTarget = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - previousTime) / 1000)); previousTime = now;
  game.advance(dt);
  const s = game.state, p = s.player, time = now / 1000;
  if (s.phase !== previousPhase) { updateMenu(); previousPhase = s.phase; }
  $('distance').textContent = Math.floor(s.distance / game.config.distancePerMeter).toLocaleString();
  $('coins').textContent = s.coins.toLocaleString();
  $('speed-line').style.width = `${(s.speed - game.config.initialSpeed) / (game.config.maximumSpeed - game.config.initialSpeed) * 100}%`;
  for (const event of game.drainEvents()) {
    if (event.type === 'coin') sound(980 + s.coins % 4 * 85, 0.055);
    if (event.type === 'jump') sound(420, 0.09, 'triangle');
    if (event.type === 'crash') sound(90, 0.25, 'sawtooth', 0.03);
  }
  if (loaded) {
    updateEntities(time);
    for (const piece of trackObjects) piece.object.position.z = piece.z + s.distance % 18;
    for (const building of buildings) building.object.position.z = ((building.z + s.distance + 162) % scenerySpan + scenerySpan) % scenerySpan - 162;
  }
  if (character) {
    character.object.position.set(p.x, p.y, 0);
    const lean = Math.max(-0.13, Math.min(0.13, ((p.lane - 1) * game.config.laneSpacing - p.x) * -0.16));
    character.object.rotation.z = THREE.MathUtils.damp(character.object.rotation.z, lean, 12, dt);
    character.setAnimation(p.rollRemaining > 0 ? 'roll' : !p.grounded ? 'jump' : 'run', p.rollRemaining > 0 ? game.config.rollSeconds : 2 * Math.sqrt(2 * game.config.jumpHeight / game.config.gravity));
    if (s.phase === 'running' || s.phase === 'ready') character.mixer.update(dt * (s.phase === 'ready' ? 0.5 : 1));
  }
  const menuView = s.phase === 'ready' && innerWidth > 800;
  const targetX = menuView ? -3.2 : p.x * 0.12;
  camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 3, dt);
  camera.position.y = THREE.MathUtils.damp(camera.position.y || 5.3, menuView ? 4.5 : 5.7 + Math.min(p.y, 2) * 0.17, 4, dt);
  camera.position.z = menuView ? 8.6 : innerWidth < 700 ? 8.7 : 9.4;
  lookTarget.set(menuView ? -3.2 : p.x * 0.12, 1.45 + p.y * 0.1, -8);
  camera.lookAt(lookTarget);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
