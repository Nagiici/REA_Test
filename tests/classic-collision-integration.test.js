import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';

const STEP = 1 / 120;
const ticks = (game, count) => { for (let i = 0; i < count; i++) game.advance(STEP); };

function emptyGame() {
  const game = new RunnerGame({ acceleration: 0 });
  game.entities = [];
  game.nextSection = 1e9;
  game.start();
  return game;
}

function reachEdge(game, direction = 'left') {
  assert.equal(game.action(direction), true);
  ticks(game, Math.ceil(game.state.player.laneDuration / STEP));
  assert.equal(game.state.player.x, direction === 'left' ? -2 : 2);
}

test('two boundary impacts request source delayed death, not an immediate game over', () => {
  for (const direction of ['left', 'right']) {
    const game = emptyGame();
    reachEdge(game, direction);
    assert.equal(game.action(direction), false);
    assert.equal(game.state.stumble.isStumbling, true);
    ticks(game, 6);
    assert.equal(game.action(direction), false);
    assert.equal(game.state.stumble.hasPendingDeath, true);
    assert.equal(game.state.phase, 'running');
    ticks(game, 24);
    // Recovered float32 delay is 0.20000000298023224, slightly above 24/120.
    assert.equal(game.state.phase, 'running');
    ticks(game, 1);
    assert.equal(game.state.phase, 'gameover');
    assert.equal(game.state.collision.type, 'repeated-stumble');
    assert.equal(game.state.reaction.name, 'caught_fall');
    assert.equal(game.events.filter(event => event.type === 'crash').length, 1);
  }
});

test('a new boundary impact after the five-second recovery starts a fresh stumble', () => {
  const game = emptyGame();
  reachEdge(game);
  game.action('left');
  ticks(game, 601);
  assert.equal(game.state.stumble.isStumbling, false);
  assert.equal(game.state.stumble.guardClose, false);
  game.action('left');
  assert.equal(game.state.stumble.hasPendingDeath, false);
  ticks(game, 25);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.stumble.isStumbling, true);
});

test('entering the side of a train rebounds one lane with a single contact notification', () => {
  const game = emptyGame();
  game.addEntity({ type: 'train', x: 2, distance: 10, width: 1.7, depth: 30, height: 3, bottom: 0 });
  game.action('right');
  ticks(game, 15);
  assert.equal(game.state.player.lane, 1, 'contact returns to the originating center lane');
  assert.ok(game.state.player.x > 0 && game.state.player.x < 2, 'rebound starts from the actual contact position');
  assert.equal(game.events.filter(event => event.type === 'stumble').length, 1);
  ticks(game, 225);
  assert.equal(game.state.player.x, 0);
  assert.equal(game.state.player.lane, 1);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.stumble.hasPendingDeath, false);
  assert.equal(game.events.filter(event => event.type === 'stumble').length, 1, 'sustained overlap is not a new hit each frame');
});

test('approaching a train front remains a fatal solid collision', () => {
  const game = emptyGame();
  game.addEntity({ type: 'train', x: 0, distance: 6, width: 1.7, depth: 6, height: 3, bottom: 0 });
  ticks(game, 60);
  assert.equal(game.state.phase, 'gameover');
  assert.equal(game.state.collision.type, 'train');
  assert.equal(game.events.filter(event => event.type === 'stumble').length, 1, 'native fatal front hit notifies stumble before critical hit');
  assert.equal(game.events.filter(event => event.type === 'crash').length, 1);
});

test('a hoverboard absorbs the repeated-stumble fatal event and then clears the stumble', () => {
  const game = emptyGame();
  reachEdge(game);
  assert.equal(game.action('board'), true);
  game.action('left');
  game.action('left');
  ticks(game, 24);
  assert.equal(game.state.board.active, true);
  ticks(game, 1);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.board.active, false);
  assert.equal(game.state.board.inventory, 2);
  assert.equal(game.events.filter(event => event.type === 'board-hit').length, 1);
  assert.equal(game.events.filter(event => event.type === 'crash').length, 0);
  ticks(game, 18);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.stumble.isStumbling, false);
  assert.equal(game.state.stumble.hasPendingDeath, false);
  assert.equal(game.events.filter(event => event.type === 'board-revive').length, 1);
  assert.ok(game.state.player.y > 0);
});

test('flight ignores boundary impacts and suppresses a pending stumble death at commit time', () => {
  for (const pendingBeforeFlight of [false, true]) {
    const game = emptyGame();
    reachEdge(game);
    if (pendingBeforeFlight) { game.action('left'); game.action('left'); }
    const notifications = game.events.filter(event => event.type === 'stumble').length;
    assert.equal(game.activatePowerup('jetpack'), true);
    for (let i = 0; i < 30; i++) {
      assert.equal(game.action('left'), false);
      ticks(game, 1);
    }
    assert.ok(game.state.flight);
    assert.equal(game.state.phase, 'running');
    assert.equal(game.state.stumble.hasPendingDeath, false);
    assert.equal(game.events.filter(event => event.type === 'stumble').length, notifications);
    assert.equal(game.events.filter(event => event.type === 'crash').length, 0);
  }
});

test('pause freezes recovery, pending death, guard approach and the runner before resuming', () => {
  const game = emptyGame();
  reachEdge(game);
  game.action('left'); ticks(game, 12);
  game.action('left'); ticks(game, 6);
  game.pause();
  const before = structuredClone(game.state);
  ticks(game, 1200);
  assert.deepEqual(game.state, before);
  assert.equal(game.action('left'), false);
  game.pause();
  ticks(game, 18);
  assert.equal(game.state.phase, 'running');
  ticks(game, 1);
  assert.equal(game.state.phase, 'gameover');
  assert.equal(game.state.collision.type, 'repeated-stumble');
});

test('solid authoring Stumble tag does not bypass geometry, but Hit-layer triggers notify a source stumble',()=>{
  const make=()=>{const g=new RunnerGame({acceleration:0});g.entities=[];g.nextSection=1e9;g.start();return g;};
  const solid=make(),trigger=make();
  for(const [g,isTrigger] of [[solid,false],[trigger,true]]){
    g.addEntity({type:'obstacle',x:0,distance:2,width:1,height:1,depth:1,sourceTag:'Stumble',sourceLayer:'Hit',sourceIsTrigger:isTrigger});
    for(let i=0;i<40;i++)g.advance(1/120);
  }
  assert.equal(solid.state.phase,'gameover');assert.equal(trigger.state.phase,'running');assert.ok(trigger.state.stumble.isStumbling);
});

test('different solid contact within the source one-second corner memory requests an immediate critical hit',()=>{
  const g=new RunnerGame({acceleration:0});g.entities=[];g.nextSection=1e9;g.start();
  const old=g.addEntity({type:'train',x:2,distance:2,width:1.8,depth:8});
  g.stumble('stumble_right',.833334,{collider:old});
  g.addEntity({type:'barrier',lane:1,x:0,distance:.4});g.advance(1/120);
  assert.equal(g.state.phase,'gameover');assert.equal(g.state.collision.id,old.id);
});
