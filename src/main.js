import * as THREE from 'three';
import { RunnerGame } from './game-core.js';
import { loadRecoveredPack, characterFromGLB, loadYellowCharacter, loadRedNoseChaser } from './asset-adapter.js';
import { createEntityVisual } from './entity-visuals.js';
import { SourceRouteGenerator } from './route-generator.js';
import { EnvironmentRouteGenerator } from './environment-layout.js';
import { POWERUP_NAMES, POWERUP_SECONDS } from './powerups.js';
import { JETPACK_SECONDS } from './jetpack.js';
import { createChaserPresentation } from './chaser-presentation.js';
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
const entityRoot = new THREE.Group(); scene.add(entityRoot);
const entityObjects = new Map();
let pack = null, character = null, chasers = null, loaded = false, previousPhase = 'ready', previousTime = performance.now();
let best = 0;
try { best = Number(localStorage.getItem('subway-browser-best') || 0); } catch {}
if (!Number.isFinite(best)) best = 0;
$('best').textContent = Math.floor(best).toLocaleString();
$('start').disabled = true; $('start-label').textContent = '准备角色…';

function updateEntities(time) {
  const ids = new Set();
  for (const entity of game.entities) {
    ids.add(entity.id);
    let object = entityObjects.get(entity.id);
    if (!object) { object = createEntityVisual(entity, pack); entityObjects.set(entity.id, object); entityRoot.add(object); }
    object.visible = !entity.collected;
    object.position.set(entity.x ?? (entity.lane - 1) * game.config.laneSpacing, entity.type === 'coin' && !entity.visual ? entity.y ?? 1.1 : 0, -(entity.distance - game.state.distance));
    if (entity.type === 'coin') {
      // Source coin visual matrices include their original elevation.
      if (entity.attraction && entity.visual) object.position.y += entity.y - entity.attraction.y;
      object.rotation.y = time * 1.6 + entity.id * 0.3;
      if (!entity.attraction) object.position.y += Math.sin(time * 2.2 + entity.id * 0.7) * 0.06;
    }
    if (entity.type === 'powerup') object.traverse(node => {
      const rotation = node.userData.pickupRotator;
      if (rotation) node.rotation.y = time * rotation.speed * Math.PI / 180 + rotation.phase;
    });
  }
  for (const [id, object] of entityObjects) if (!ids.has(id)) { entityRoot.remove(object); entityObjects.delete(id); }
}

function installCharacter(next) {
  if (character) scene.remove(character.object);
  character = next; scene.add(character.object);
  equipment = null;
  if (pack) {
    const boardParent = character.native.getObjectByName('SourceBoardAttachment');
    const spine = character.native.getObjectByName('LowerSpine_jnt');
    equipment = { board: pack.clonePrefab('hoverboard_default'), jetpack: pack.clonePrefab('wearable_jetpack') };
    if (boardParent) { equipment.board.children[0].scale.setScalar(.08); boardParent.add(equipment.board); }
    else { equipment.board.position.y = .05; character.object.add(equipment.board); }
    if (spine) {
      // Equipment fit for the broader replacement body; source descendant TRS is retained.
      equipment.jetpack.children[0].scale.setScalar(.17);
      const attachment = pack.manifest.equipmentAttachments.jetpack;
      const rest = new THREE.Matrix4().set(...attachment.rigRestWorldMatrix);
      rest.decompose(new THREE.Vector3(), equipment.jetpack.quaternion, new THREE.Vector3());
      equipment.jetpack.position.set(0, -.13, -.12); spine.add(equipment.jetpack);
    } else { equipment.jetpack.position.set(0, 1, .4); character.object.add(equipment.jetpack); }
    equipment.board.visible = equipment.jetpack.visible = false;
  }
  $('asset-label').textContent = next.name;
  $('asset-status').classList.add('ready');
  window.__runner.character = character;
}

window.__runner = { game, renderer, scene, camera, pack: null, character: null, ready: false, errors: [],
  snapshot: () => ({ phase: game.state.phase, distance: game.state.distance, player: { ...game.state.player }, entities: game.entities.length, character: character?.name, animations: character?.animationNames, drawCalls: renderer.info.render.calls }),
};

Promise.all([loadRecoveredPack(undefined, { includeChasers: false }), loadYellowCharacter(), loadRedNoseChaser()]).then(([result, yellowCharacter, redNose]) => {
  pack = result; window.__runner.pack = result;
  if (!result.routeLibrary || !result.environmentBindings) throw new Error('原版关卡数据尚未就绪');
  const source = new SourceRouteGenerator(result.routeLibrary, { seed: game.config.seed });
  game.setRouteGenerator(new EnvironmentRouteGenerator(source, result.environmentBindings));
  // One new actor replaces the entire original guard-and-dog pair.
  chasers = createChaserPresentation({ guard: redNose }); scene.add(chasers.object);
  window.__runner.chasers = chasers;
  installCharacter(yellowCharacter); loaded = true; window.__runner.ready = true;
  $('start').disabled = false; $('start-label').textContent = '开始奔跑';
}).catch(error => {
  console.error(error); window.__runner.errors.push(error.message);
  $('asset-label').textContent = '角色资源读取失败';
  $('menu-description').textContent = '资源尚未准备好，请刷新页面或检查资源同步。';
  $('start-label').textContent = '资源未就绪';
});

let boardPose = null, equipment = null;
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
$('revive').addEventListener('click', () => { if (game.revive()) canvas.focus(); });
$('pause').addEventListener('click', () => { if (loaded) game.pause(); });
$('sound').addEventListener('click', async () => {
  soundEnabled = !soundEnabled;
  $('sound').style.opacity = soundEnabled ? '1' : '.55';
  $('sound').setAttribute('aria-label', soundEnabled ? '关闭游戏音效' : '开启游戏音效');
  if (soundEnabled) { audioContext ??= new AudioContext(); await audioContext.resume(); sound(660); }
  toast(soundEnabled ? '音效已开启' : '音效已关闭');
});
$('sound').style.opacity = '.55';

$('board').addEventListener('click', () => { game.action('board'); canvas.focus(); });
const keyActions = { KeyE: 'board', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'roll', KeyS: 'roll' };
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
let pointerStart = null, lastTap = 0;
canvas.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointerup', event => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y; pointerStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) {
    const now = performance.now(); if (now - lastTap < 320) { game.action('board'); lastTap = 0; } else lastTap = now; return;
  }
  lastTap = 0;
  game.action(Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'jump' : 'roll');
});
canvas.addEventListener('pointercancel', () => { pointerStart = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden && game.hasActiveClock) game.pause(); previousTime = performance.now(); });

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
  const running = phase === 'running' || phase === 'reviving';
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
    $('result').hidden = true; $('start-label').textContent = '继续';
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
  const reviveOffered = s.phase === 'gameover' && s.revival.phase === 'offered';
  $('revive').hidden = !reviveOffered;
  $('revive').disabled = !reviveOffered;
  $('revive').textContent = `试玩复活 · ${Math.ceil(s.revival.offerRemaining)}秒`;
  $('revive-note').hidden = !reviveOffered;
  $('chase-status').hidden = !s.stumble?.isStumbling || !['running', 'paused'].includes(s.phase);
  if (s.stumble?.isStumbling) { $('chase-status').querySelector('span').textContent = `红鼻子追近 · ${Math.ceil(s.stumble.timeLeft)}秒`; $('chase-status').querySelector('progress').value = s.stumble.timeLeft; }
  $('distance').textContent = Math.floor(s.distance / game.config.distancePerMeter).toLocaleString();
  $('coins').textContent = s.coins.toLocaleString();
  $('score').textContent = s.score.toLocaleString();
  $('multiplier').textContent = `×${game.scoreMultiplier}`;
  for (const [type, name] of Object.entries(POWERUP_NAMES)) {
    const element = $(`effect-${type}`), remaining = s.powerups[type] ?? 0;
    element.hidden = remaining <= 0 && !(type === 'jetpack' && s.flight);
    element.querySelector('span').textContent = `${name} · ${Math.ceil(remaining)}秒`;
    element.querySelector('progress').value = remaining / (type === 'jetpack' ? s.flight?.initialTimeLeft || JETPACK_SECONDS[game.config.powerupTier] : POWERUP_SECONDS[game.config.powerupTier]);
  }
  const board = game.hoverboard.state;
  $('board').disabled = s.phase !== 'running' || !game.hoverboard.canActivate;
  $('board').textContent = board.active ? `滑板 ${Math.ceil(board.timeLeft)}秒${s.flight ? ' · 暂停' : ''}` : board.cooldownBlocked ? '滑板冷却中' : `滑板 ×${board.inventory} · E`;
  $('speed-line').style.width = `${(s.speed - game.config.initialSpeed) / (game.config.maximumSpeed - game.config.initialSpeed) * 100}%`;
  for (const event of game.drainEvents()) {
    if (event.type === 'stumble') { sound(180, .12, 'triangle'); toast('小心，红鼻子追上来了'); }
    if (event.type === 'revive') { boardPose = null; toast('继续奔跑'); sound(500, .2); }
    if (event.type === 'start') boardPose = null;
    if (event.type === 'board-start') { boardPose = { name: 'board_takeoff', until: s.elapsed + .458336 }; toast('滑板保护已开启'); }
    if (event.type === 'land' && game.hoverboard.visible) boardPose = { name: 'board_landing', until: s.elapsed + .333334 };
    if (event.type === 'board-hit') { boardPose = null; toast('滑板挡住了撞击'); sound(160, .2, 'triangle'); }
    if (event.type === 'coin') sound(980 + s.coins % 4 * 85, 0.055);
    if (event.type === 'jump') sound(420, 0.09, 'triangle');
    if (event.type === 'crash') sound(90, 0.25, 'sawtooth', 0.03);
    if (event.type === 'powerup') { sound(740, 0.18, 'triangle'); toast(`${POWERUP_NAMES[event.powerup]} · ${Math.ceil(event.duration)}秒`); }
  }
  if (loaded) {
    updateEntities(time);
    chasers.update(s, dt);
  }
  if (character) {
    character.object.position.set(p.x, p.y, 0);
    const lean = Math.max(-0.13, Math.min(0.13, ((p.lane - 1) * game.config.laneSpacing - p.x) * -0.16));
    character.object.rotation.z = THREE.MathUtils.damp(character.object.rotation.z, lean, 12, dt);
    const base = p.rollRemaining > 0 ? 'roll' : !p.grounded ? 'jump' : 'run';
    const animation = s.reaction?.name ?? (s.flight ? 'flight' : game.hoverboard.visible ? (base === 'run' && boardPose?.until > s.elapsed ? boardPose.name : `board_${base}`) : base);
    const duration = s.reaction ? s.reaction.duration : animation === 'board_takeoff' ? .458336 : animation === 'board_landing' ? .333334 : p.rollRemaining > 0 ? game.config.rollSeconds : base === 'jump' ? 2 * Math.sqrt(2 * (s.powerups.sneakers ? 4 : game.config.jumpHeight) / game.config.gravity) : undefined;
    character.setAnimation(animation, duration, s.reaction?.token ?? null);
    if (equipment) { equipment.board.visible = game.hoverboard.visible; equipment.jetpack.visible = !!s.flight; }
    if (['running','ready','gameover','reviving'].includes(s.phase)) character.mixer.update(dt * (s.phase === 'ready' ? 0.5 : 1));
  }
  const menuView = s.phase === 'ready' && innerWidth > 800;
  const targetX = menuView ? -3.2 : p.x * 0.12;
  camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 3, dt);
  camera.position.y = THREE.MathUtils.damp(camera.position.y || 5.3, menuView ? 4.5 : 5.7 + Math.max(0, p.y - 2) + Math.min(p.y, 2) * 0.17, 4, dt);
  camera.position.z = menuView ? 8.6 : innerWidth < 700 ? 8.7 : 9.4;
  lookTarget.set(menuView ? -3.2 : p.x * 0.12, 1.45 + Math.max(0, p.y - 2) + Math.min(p.y, 2) * 0.1, -8);
  camera.lookAt(lookTarget);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
