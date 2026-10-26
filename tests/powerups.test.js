import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';
import { POWERUP_SECONDS, curveValue, SNEAKERS } from '../src/powerups.js';

function emptyGame(config = {}) { const g = new RunnerGame({ acceleration: 0, ...config }); g.entities = []; g.nextSection = 1e9; g.start(); return g; }
function frames(g, seconds, hz = 120) { for (let i = 0; i < Math.round(seconds * hz); i++) g.advance(1 / hz); }

test('source sphere pickup applies once, ignores an adjacent lane and uses its actual height', () => {
  const g = emptyGame();
  const pickup = g.addEntity({ type:'powerup', powerup:'magnet', x:0, distance:2, sourcePickupTrigger:{center:[0,.85,2],radius:.7} });
  const side = g.addEntity({type:'powerup', powerup:'sneakers', x:2, distance:2, sourcePickupTrigger:{center:[2,.85,2],radius:.7}});
  const above = g.addEntity({type:'powerup', powerup:'doubleScore', x:0, distance:2, sourcePickupTrigger:{center:[0,5,2],radius:.7}});
  frames(g,.5);
  assert.equal(pickup.collected,true); assert.equal(side.collected,false); assert.equal(above.collected,false);
  assert.equal(g.drainEvents().filter(e=>e.type==='powerup').length,1);
  assert.ok(g.state.powerups.magnet>9 && g.state.powerups.magnet<10);
});

test('repeat pickups refresh the full native duration; pause freezes all timers and reset clears effects', () => {
  const g=emptyGame(); g.activatePowerup('magnet'); frames(g,3); g.activatePowerup('magnet');
  assert.equal(g.state.powerups.magnet,10);
  g.pause(); frames(g,3); assert.equal(g.state.powerups.magnet,10);
  g.pause(); frames(g,10); assert.equal(g.state.powerups.magnet,undefined);
  g.activatePowerup('sneakers'); g.reset(); assert.deepEqual(g.state.powerups,{});
  assert.deepEqual(POWERUP_SECONDS,[10,11.5,13.4,15.8,19,24,30]);
});

test('distance multiplier changes prospectively, coin conversion stays raw, and 2x does not multiply its own pickup bonus', () => {
  const g=emptyGame({playerLevel:3}); frames(g,1);
  const before=g.state.baseScore, meters=g.state.scoredMeters;
  g.activatePowerup('doubleScore'); assert.equal(g.state.baseScore,before+90);
  frames(g,1);
  assert.equal(g.state.baseScore,before+90+(g.state.scoredMeters-meters)*6);
  const second=g.state.baseScore; g.activatePowerup('doubleScore'); assert.equal(g.state.baseScore,second+90);
  g.addEntity({type:'coin',x:0,y:1,distance:g.state.distance+.1}); frames(g,.1);
  assert.equal(g.state.coins,1); assert.equal(g.state.score-g.state.baseScore,6);
  const third=g.state.baseScore; g.activatePowerup('magnet'); assert.equal(g.state.baseScore,third+180);
});

test('magnet pulls across lanes with time-of-flight, finishes an in-flight coin after expiry, and respects height band', () => {
  const g=emptyGame(); g.activatePowerup('magnet');
  const coin=g.addEntity({type:'coin',x:2,y:1,distance:5});
  const high=g.addEntity({type:'coin',x:0,y:7.1,distance:5});
  frames(g,1/120); assert.ok(coin.attraction); assert.equal(g.state.coins,0); assert.equal(high.attraction,undefined);
  g.state.powerups.magnet=.001; frames(g,.6);
  assert.equal(coin.collected,true); assert.equal(g.state.powerups.magnet,undefined);
});

test('magnet trigger uses its recovered center, and sneakers long capsule can pull lower coins', () => {
  const g=emptyGame(); g.activatePowerup('magnet');
  const outside=g.addEntity({type:'coin',x:0,y:1.07,distance:7.5}); g.attractCoin(outside); assert.equal(outside.attraction,undefined);
  const shoe=emptyGame(); shoe.activatePowerup('sneakers'); shoe.state.player.y=4;
  const lower=shoe.addEntity({type:'coin',x:0,y:1,distance:2.08}); shoe.attractCoin(lower); assert.ok(lower.attraction);
  const directlyBelow=shoe.addEntity({type:'coin',x:0,y:1,distance:0}); shoe.attractCoin(directlyBelow); assert.equal(directlyBelow.attraction,undefined);
});

test('sneaker ascent samples the original curve and completes after expiry; next jump returns to ordinary height', () => {
  const g=emptyGame(); g.activatePowerup('sneakers'); g.action('jump');
  const length=g.state.player.sneakersJump.length;
  frames(g,.2);
  assert.ok(Math.abs(g.state.player.y-4*curveValue(SNEAKERS.curve,g.state.distance/length))<1e-9);
  g.state.powerups.sneakers=.001;
  let maximum=g.state.player.y; for(let i=0;i<180;i++){g.advance(1/120); maximum=Math.max(maximum,g.state.player.y);}
  assert.ok(maximum>=3.99); assert.equal(g.state.player.grounded,true);
  g.action('jump'); let normal=0; for(let i=0;i<120;i++){g.advance(1/120);normal=Math.max(normal,g.state.player.y);}
  assert.ok(normal>1.9&&normal<2.01);
});

test('roll interrupts powered ascent immediately and repeated rolls remain responsive', () => {
  const g=emptyGame(); g.activatePowerup('sneakers'); g.action('jump'); frames(g,.2); const y=g.state.player.y;
  g.action('roll'); assert.equal(g.state.player.sneakersJump,null); frames(g,.1); assert.ok(g.state.player.y<y);
  for(let i=0;i<10;i++){g.action('roll');frames(g,.1);} assert.ok(g.state.player.rollRemaining>0);
  frames(g,1); assert.equal(g.state.player.rollRemaining,0);
});

test('powerup timers, coin flight and score are deterministic across 30 and 120 fps', () => {
  const a=emptyGame(),b=emptyGame();
  for(const g of [a,b]){g.activatePowerup('magnet');g.activatePowerup('doubleScore');g.addEntity({type:'coin',x:2,y:1,distance:5});}
  frames(a,4,30);frames(b,4,120);
  assert.deepEqual(a.state,b.state); assert.equal(a.state.coins,1);
});
