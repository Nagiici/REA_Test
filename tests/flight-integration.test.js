import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';
const frames = (g, seconds, hz = 120) => { for(let i=0;i<Math.round(seconds*hz);i++) g.advance(1/hz); };
function emptyGame(config={}) { const g=new RunnerGame({acceleration:0,...config});g.entities=[];g.nextSection=1e9;g.start();return g; }

test('flight pauses shoes and board, continues magnet, blocks ground actions and clears hazards',()=>{
  const g=emptyGame();g.activatePowerup('sneakers');g.activatePowerup('magnet');g.action('board');
  g.activatePowerup('jetpack');g.addEntity({type:'train',lane:1,distance:3});
  assert.equal(g.action('jump'),false);assert.equal(g.action('roll'),false);assert.equal(g.action('board'),false);
  frames(g,2);assert.equal(g.state.phase,'running');assert.equal(g.state.player.y,9.5);
  assert.equal(g.state.powerups.sneakers,10);assert.equal(g.state.board.timeLeft,30);assert.ok(g.state.powerups.magnet<8.01);
  assert.equal(g.state.speed,22);g.action('left');frames(g,6/22);assert.ok(Math.abs(g.state.player.x+2)<1e-8);
  g.pause();const d=g.state.distance;frames(g,2);assert.equal(g.state.distance,d);
  g.pause();frames(g,9);assert.equal(g.state.flight,null);assert.equal(g.state.speed,11);assert.equal(g.state.player.y,0);
  assert.ok(g.state.board.timeLeft<30);assert.ok(g.hoverboard.visible);assert.ok(g.state.powerups.sneakers<10);
});

test('flight coins can be collected on their source height and flight ends at target before normal gravity',()=>{
  const g=emptyGame();g.activatePowerup('jetpack');const target=g.state.flight.targetZ;
  g.entities=[];g.addEntity({type:'coin',x:0,y:9.5,distance:55,flightCoin:true});frames(g,3);
  assert.equal(g.state.coins,1);
  while(g.state.distance<target) g.advance(1/120);
  assert.ok(g.state.flight);g.advance(1/120);assert.equal(g.state.flight,null);
  assert.ok(g.state.player.y<9.5&&g.state.player.y>9.49);assert.ok(g.state.player.velocityY<0);
  frames(g,1);assert.equal(g.state.player.y,0);
});

test('board absorbs one fatal hit, clears upcoming hazards and rearms by distance without freezing roll',()=>{
  const g=emptyGame();g.action('board');g.addEntity({type:'barrier',lane:1,distance:2});
  g.addEntity({type:'train',lane:1,distance:16});frames(g,.35);
  assert.equal(g.state.phase,'running');assert.equal(g.state.board.active,false);assert.equal(g.state.board.inventory,2);
  assert.equal(g.entities.filter(e=>e.type==='train').length,0);assert.ok(g.state.player.velocityY>0);
  assert.equal(g.action('board'),false);frames(g,1.2);assert.equal(g.action('board'),true);
  for(let i=0;i<30;i++){g.action('roll');frames(g,.1);}assert.equal(g.state.phase,'running');assert.ok(g.state.player.rollRemaining>0);
  frames(g,1);assert.equal(g.state.player.rollRemaining,0);
});

test('board gap recovery returns to the cleared surface while an unprotected fall ends the run',()=>{
  const a=emptyGame(),b=emptyGame();a.action('board');
  for(const g of[a,b]){g.addEntity({type:'gap',x:0,distance:15,width:2,depth:30});frames(g,2);}
  assert.equal(a.state.phase,'running');assert.equal(a.state.player.y,0);assert.equal(b.state.phase,'gameover');
});

test('flight state, timers and scoring are independent of render frame rate',()=>{
  const a=emptyGame({acceleration:.055}),b=emptyGame({acceleration:.055});
  for(const [g,hz] of [[a,30],[b,120]]){g.action('board');g.activatePowerup('jetpack');frames(g,11,hz);}
  assert.deepEqual(a.state,b.state);
});

test('board clearing removes source train visuals with their collision group, preserving scenery and later instances',()=>{
  const g=emptyGame();
  const scope='chunk/group:1',p={graph:scope,chunkStart:0};
  g.addEntity({type:'train',lane:1,distance:10,depth:18,visual:null,provenance:p});
  const near=g.addEntity({type:'decoration',x:0,distance:6,provenance:{graph:scope+'/car:1',chunkStart:0}});
  const later=g.addEntity({type:'decoration',x:0,distance:106,provenance:{graph:scope+'/car:1',chunkStart:100}});
  const scenery=g.addEntity({type:'decoration',x:0,distance:6,provenance:{environment:'station'}});
  const coin=g.addEntity({type:'coin',x:0,y:1,distance:6,provenance:p});
  g.clearObstacles(0,25);
  assert.ok(!g.entities.includes(near));assert.ok(g.entities.includes(later));assert.ok(g.entities.includes(scenery));assert.ok(g.entities.includes(coin));
});
