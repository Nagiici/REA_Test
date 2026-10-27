import * as THREE from 'three';
import { RunnerGame } from './game-core.js';
import { loadRecoveredPack, characterFromGLB, loadYellowCharacter, loadRedNoseChaser } from './asset-adapter.js';
import { createEntityVisual } from './entity-visuals.js';
import { SourceRouteGenerator } from './route-generator.js';
import { EnvironmentRouteGenerator } from './environment-layout.js';
import { POWERUP_NAMES, POWERUP_SECONDS } from './powerups.js';
import { JETPACK_SECONDS } from './jetpack.js';
import { createChaserPresentation } from './chaser-presentation.js';
import { PlayerMotion } from './player-motion.js';
import { ClassicAudio } from './classic-audio.js';
import { ClassicCamera, classicCameraFov } from './classic-camera.js';
import { ClassicCameraVolumes, ClassicTunnelModifiers } from './classic-camera-volumes.js';
import { SourceCameraRig } from './source-camera-rig.js';
import { createClassicEffects } from './classic-effects.js';
import { createClassicIntroProps } from './classic-intro-props.js';
import { movingTrainPresentation } from './classic-motion.js';
import './style.css';

const $ = id => document.getElementById(id);
const canvas = $('game');
// Source death presentation defaults to 3 seconds; local revive UI uses that
// window while retaining its explicit browser offer flow.
const game = new RunnerGame({ catchPresentationSeconds: 3 });
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
const cameraController = new ClassicCamera({ aspect: innerWidth / innerHeight });
const cameraVolumes = new ClassicCameraVolumes();
const tunnelModifiers = new ClassicTunnelModifiers();
let introRig = null, introStage = null, introProps = null, effects = null, presentationTime = 0, cameraState = null;
let trainReaction = null;
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
let playerMotion = new PlayerMotion(), gameAudio = new ClassicAudio(null);
let pack = null, character = null, chasers = null, loaded = false, previousPhase = 'ready', previousCatch = false, previousTime = performance.now();
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
  introProps?.dispose(); introProps = null;
  gameAudio.animationEvents?.reset();
  if (character) scene.remove(character.object);
  character = next; scene.add(character.object);
  equipment = null;
  if (pack) {
    const boardParent = character.native.getObjectByName('SourceBoardAttachment');
    const spine = character.native.getObjectByName('LowerSpine_jnt');
    equipment = { board: pack.clonePrefab('hoverboard_default'), jetpack: pack.clonePrefab('wearable_jetpack') };
    const hand = character.native.getObjectByName('R_Hand_jnt');
    if (hand && pack.introProps) introProps = createClassicIntroProps(pack, { character });
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

window.__runner = { game, renderer, scene, camera, cameraController, cameraVolumes, tunnelModifiers, pack: null, character: null, ready: false, errors: [],
  snapshot: () => ({ phase: game.state.phase, distance: game.state.distance, player: { ...game.state.player }, entities: game.entities.length, character: character?.name, animations: character?.animationNames, drawCalls: renderer.info.render.calls }),
};

Promise.all([loadRecoveredPack(undefined, { includeChasers: false }), loadYellowCharacter(), loadRedNoseChaser()]).then(([result, yellowCharacter, redNose]) => {
  pack = result; window.__runner.pack = result;
  playerMotion = new PlayerMotion(result.classicMotionPools); gameAudio = new ClassicAudio(result.classicAudio, undefined, result.classicAudioEvents);
  introRig = new SourceCameraRig(result.classicPresentation.introGraph);
  introStage = result.clonePrefab(result.manifest.introStage.prefabKey); scene.add(introStage);
  effects = createClassicEffects(result); scene.add(effects.object); window.__runner.effects = effects;
  window.__runner.audio = gameAudio;
  if (!result.routeLibrary || !result.environmentBindings) throw new Error('原版关卡数据尚未就绪');
  const source = new SourceRouteGenerator(result.routeLibrary, { seed: game.config.seed });
  game.setRouteGenerator(new EnvironmentRouteGenerator(source, result.environmentBindings));
  // One new actor replaces the entire original guard-and-dog pair.
  chasers = createChaserPresentation({ guard: redNose }, { bindings: result.classicBindings, sourceActors: result.manifest.chaserActors, additions: result.manifest.guardAnimationAdditions }); scene.add(chasers.object);
  window.__runner.chasers = chasers;
  installCharacter(yellowCharacter); loaded = true; window.__runner.ready = true;
  updateMenu();
  $('start').disabled = false; $('start-label').textContent = '开始奔跑';
}).catch(error => {
  console.error(error); window.__runner.errors.push(error.message);
  $('asset-label').textContent = '角色资源读取失败';
  $('menu-description').textContent = '资源尚未准备好，请刷新页面或检查资源同步。';
  $('start-label').textContent = '资源未就绪';
});

let equipment = null;
let toastTimer;
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
}

let soundEnabled = false;

function start() {
  if (!loaded || game.state.phase !== 'paused' && (game.state.catchRemaining > 0 || game.state.deathGrounding)) return;
  if (game.state.phase === 'paused') game.pause();
  else {
    if (game.state.phase === 'gameover') { for (const object of entityObjects.values()) entityRoot.remove(object); entityObjects.clear(); }
    const fov = classicCameraFov(camera.aspect);
    game.introOptions = { introDuration: pack.manifest.introAnimationAdditions.clips.intro_run.duration,
      startFov: fov.menu, runningFov: fov.runningField, aspect: camera.aspect };
    game.headstartOnStart = $('headstart').checked;
    game.start();
  }
  if (soundEnabled) gameAudio.enable(true); canvas.focus();
}
$('start').addEventListener('click', start);
$('revive').addEventListener('click', () => { if (game.revive()) canvas.focus(); });
$('pause').addEventListener('click', () => { if (loaded) game.pause(); });
$('sound').addEventListener('click', async () => {
  soundEnabled = !soundEnabled;
  $('sound').style.opacity = soundEnabled ? '1' : '.55';
  $('sound').setAttribute('aria-label', soundEnabled ? '关闭游戏音效' : '开启游戏音效');
  await gameAudio.enable(soundEnabled);
  toast(soundEnabled ? '音效已开启' : '音效已关闭');
});
$('sound').style.opacity = '.55';

$('board').addEventListener('click', () => { game.action('board'); canvas.focus(); });
$('turbo').addEventListener('click', () => { game.action('turbo'); canvas.focus(); });
const keyActions = { KeyT: 'turbo', KeyE: 'board', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'roll', KeyS: 'roll' };
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
  if (game.hasActiveClock) game.pause();
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
  $('headstart-option').hidden = !['ready', 'gameover'].includes(phase);
  const running = phase === 'intro' || phase === 'running' || phase === 'reviving' || phase === 'gameover' && (game.state.catchRemaining > 0 || game.state.deathGrounding);
  $('menu').classList.toggle('hidden', running);
  $('menu').inert = running;
  $('menu').setAttribute('aria-hidden', String(running));
  document.body.classList.toggle('playing', phase === 'running');
  document.body.classList.toggle('menu-open', !running);
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
  } else if (phase === 'ready') {
    $('menu-title').innerHTML = '下一站，<br><em>全速前进。</em>';
    $('menu-description').textContent = '躲开列车，跃过路障，沿着金币奔跑。';
    $('result').hidden = true; $('start-label').textContent = '开始奔跑';
  }
}

function resize() {
  const width = innerWidth, height = innerHeight;
  renderer.setSize(width, height, false); camera.aspect = width / height;
  const fov = cameraController.setAspect(camera.aspect);
  camera.fov = game.state.phase === 'ready' ? fov.menu : fov.running; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
const lookTarget = new THREE.Vector3();
function frame(now) {
  const realtimeDelta = Math.max(0, (now - previousTime) / 1000);
  const dt = Math.min(0.1, realtimeDelta); previousTime = now;
  game.advance(dt, { realtimeDelta });
  const s = game.state, p = s.player;
  if (s.phase !== 'paused') presentationTime += dt;
  const waitingForDeath = !!(s.catchRemaining || s.deathGrounding);
  if (s.phase !== previousPhase || waitingForDeath !== previousCatch) { updateMenu(); previousPhase = s.phase; previousCatch = waitingForDeath; }
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
    element.querySelector('span').textContent = `${type === 'jetpack' && s.flight?.headstart ? '极速起跑' : name} · ${Math.ceil(remaining)}秒`;
    element.querySelector('progress').value = remaining / (type === 'jetpack' ? s.flight?.initialTimeLeft || JETPACK_SECONDS[game.config.powerupTier] : POWERUP_SECONDS[game.config.powerupTier]);
  }
  const board = game.hoverboard.state;
  $('board').hidden = !!s.flight?.headstart;
  $('board').disabled = s.phase !== 'running' || !game.hoverboard.canActivate;
  $('board').textContent = board.active ? `滑板 ${Math.ceil(board.timeLeft)}秒${s.flight ? ' · 暂停' : ''}` : board.cooldownBlocked ? '滑板冷却中' : `滑板 ×${board.inventory} · E`;
  $('turbo').hidden = !s.flight?.turboVisible;
  $('turbo').disabled = s.phase !== 'running' || !s.flight?.turboAvailable;
  $('turbo').textContent = `再次加速 ${2 - (s.flight?.headstartTier ?? 0)} · T`;
  $('speed-line').style.width = `${(s.speed - game.config.initialSpeed) / (game.config.maximumSpeed - game.config.initialSpeed) * 100}%`;
  const events = game.drainEvents();
  gameAudio.update(s, events);
  for (const event of events) {
    if (event.type === 'stumble') toast('小心，红鼻子追上来了');
    if (event.type === 'revive') toast('继续奔跑');
    if (event.type === 'board-start') toast('滑板保护已开启');
    if (event.type === 'board-hit') toast('滑板挡住了撞击');
    if (event.type === 'powerup') toast(`${event.headstart ? '极速起跑' : POWERUP_NAMES[event.powerup]} · ${Math.ceil(event.duration)}秒`);
    if (event.type === 'turbo-headstart' && event.tier > 0) toast(`极速起跑 · 第 ${event.tier + 1} 档`);
  }
  if (loaded) {
    // Static original opening set stays at world origin as the course scrolls.
    introStage.position.z = s.distance; introStage.visible = s.distance < 50;
    updateEntities(presentationTime);
    chasers.update(s, dt, events);
  }
  if (character) {
    const displayPhase = s.phase === 'paused' ? s.pausedFrom : s.phase;
    if (trainReaction && (trainReaction.state !== s || displayPhase !== 'gameover' || s.reaction?.name !== 'death_moving_train')) trainReaction = null;
    if (events.some(event => event.type === 'crash' && event.animation === 'death_moving_train')) {
      trainReaction = { state: s, elapsed: 0, startPosition: [p.x, p.y, 0], cameraPosition: camera.position.toArray(),
        guardSequence: chasers?.trainSequenceActive === true };
    }
    if (trainReaction && s.phase !== 'paused') trainReaction.elapsed += dt;
    // CharacterRendering's half-second train-hit camera tween, followed by
    // the separately gated guard sink only when ShowEnemies was true at impact.
    const trainPose = trainReaction ? movingTrainPresentation(trainReaction) : null;
    character.object.position.fromArray(trainPose?.position ?? [p.x, p.y, 0]);
    window.__runner.trainPresentation = trainPose;
    const lean = Math.max(-0.13, Math.min(0.13, ((p.lane - 1) * game.config.laneSpacing - p.x) * -0.16));
    if (s.phase !== 'paused') character.object.rotation.z = THREE.MathUtils.damp(character.object.rotation.z, lean, 12, dt);
    const motion = displayPhase === 'ready' ? { name: 'idle_paint', fade: .2 }
      : displayPhase === 'intro' ? { name: 'intro_run', token: s.intro, fade: .2 }
      : playerMotion.select(s, events, character);
    if (chasers?.catchAvatar) {
      const caught = chasers.catchAvatar;
      character.setCatchAnimation?.(caught.name, Math.max(0, caught.time - (s.phase === 'paused' ? 0 : dt)), caught.weight, caught.token);
    } else {
      character.setAnimation(motion.name, motion.duration, displayPhase === 'intro' ? 'intro' : motion.token ?? null, { fade: motion.fade });
      if (motion.speed != null) character.setTimeScale?.(motion.speed);
    }
    if (equipment) { equipment.board.visible = game.hoverboard.visible; equipment.jetpack.visible = !!s.flight; }
    if (s.phase !== 'paused') character.mixer.update(dt);
    const animationState = character.getAnimationSnapshot?.();
    if (animationState) { game.updateAnimationState?.(animationState); gameAudio.updateAnimation(s, animationState); }
  }
  if (cameraState !== s) { cameraController.reset(); cameraState = s; }
  const cameraRegion = cameraVolumes.update(s, game.entities);
  tunnelModifiers.update(s, game.entities, cameraController);
  if (introRig && s.phase !== 'paused') {
    if (s.phase === 'ready' || s.phase === 'intro') {
      const clip = pack.cameraAnimations[s.phase === 'ready' ? 'camera_menu_idle' : 'camera_start_pan'];
      cameraController.setPose(introRig.sample(clip, s.intro?.elapsed ?? 0,
        s.phase === 'intro' ? s.intro.cameraFov : classicCameraFov(camera.aspect).menu));
    } else {
      if (events.some(e => e.type === 'running')) {
        cameraController.setPose(introRig.sample(pack.cameraAnimations.camera_start_pan, s.intro.duration, s.intro.cameraFov));
        cameraController.enterRunning();
      } else if (cameraController.mode === 'external') cameraController.enterRunning();
      if (events.some(e => e.type === 'critical-hit')) cameraController.startShake();
      for (const event of events) {
        if (event.powerup === 'sneakers' && ['powerup', 'powerup-end'].includes(event.type))
          cameraController.sneakersChanged(event.type === 'powerup');
        if (event.type === 'headstart-start') cameraController.beginHeadstartFov();
        if (event.type === 'headstart-end') cameraController.endHeadstartFov();
        if (event.type === 'turbo-headstart') cameraController.pulseHeadstartFov();
      }
      const shakeSample = cameraController.shake
        ? new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random())).toArray() : [0,0,0];
      cameraController.step(dt, { position: [p.x,p.y,s.distance], lastGroundedY: p.lastGroundedY,
        grounded: p.grounded, sneakers: !!s.powerups.sneakers, jetpack: s.flight, shakeSample,
        runningOrJetpack: s.phase === 'running', ...cameraRegion });
    }
  }
  const pose = cameraController.snapshot();
  camera.position.set(pose.position[0], pose.position[1], -(pose.position[2] - s.distance));
  lookTarget.set(pose.target[0], pose.target[1], -(pose.target[2] - s.distance));
  camera.lookAt(lookTarget);
  if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
  effects?.update(s, dt, events, camera, character);
  window.__runner.introProps = introProps;
  introProps?.update(dt, { phase: s.phase, paused: s.phase === 'paused', camera });
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
