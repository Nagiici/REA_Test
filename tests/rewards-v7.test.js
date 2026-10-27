import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame, mulberry32 } from '../src/game-core.js';
import { makeHeadstartRewards, HEADSTART_REWARDS } from '../src/headstart-rewards.js';
import { HEADSTART } from '../src/jetpack.js';

const dt=1/120, tick=g=>g.advance(dt);
function empty(config={}){const g=new RunnerGame({acceleration:0,...config});g.entities=[];g.nextSection=1e9;g.start();return g;}
const rewards=g=>g.entities.filter(e=>e.headstartReward);

test('source reward gates, unique retry draw and exact parent sphere geometry across all tiers',()=>{
  for(let tier=0;tier<3;tier++){
    const draws=[.1,.1,.9,.9,.4];let n=0;
    const flight={headstart:true,headstartTier:tier,targetZ:234};
    const row=makeHeadstartRewards({flight,random:()=>draws[n++]});
    assert.equal(n,5);assert.deepEqual(row.map(e=>e.powerup),['doubleScore','magnet','sneakers']);
    assert.deepEqual(row.map(e=>e.x),[-2,0,2]);
    for(const e of row){
      assert.equal(e.pickupRootY,HEADSTART[tier].height-.5);
      assert.deepEqual(e.sourcePickupTrigger,{center:[e.x,e.pickupRootY+.85,234],radius:.7});
      assert.equal(e.visual.matrix[7],e.pickupRootY);
    }
    for(const version of [0,3])assert.deepEqual(makeHeadstartRewards({flight,random:mulberry32(3),pickupSystemVersion:version}),[]);
    assert.equal(makeHeadstartRewards({flight,random:mulberry32(3),pickupSystemVersion:2}).length,3);
    assert.deepEqual(makeHeadstartRewards({flight,random:mulberry32(3),gameType:304}),[]);
    assert.deepEqual(makeHeadstartRewards({flight:{...flight,headstart:false},random:mulberry32(3)}),[]);
  }
});

test('each turbo relocates and rerolls exactly one row; old row is removed and pause cannot relocate it',()=>{
  const g=empty();g.activateHeadstart();let old=rewards(g);
  for(let tier=1;tier<3;tier++){
    while(g.state.distance<65+(tier-1)*25)tick(g);
    assert.equal(g.action('turbo'),true);
    g.pause();g.advance(.1);assert.deepEqual(rewards(g),old);g.pause();tick(g);
    const row=rewards(g);assert.equal(row.length,3);
    assert.ok(row.every(e=>!old.includes(e)&&e.distance===g.state.flight.targetZ&&e.provenance.tier===tier));
    assert.deepEqual(row.map(e=>e.powerup).sort(),[...HEADSTART_REWARDS].sort());old=row;
  }
  g.reset();assert.equal(rewards(g).length,0);
});

test('all three lane choices collect once before flight exit and unchosen rewards persist after exit',()=>{
  for(let tier=0;tier<3;tier++)for(let lane=0;lane<3;lane++){
    const g=empty({seed:40});g.activateHeadstart();
    while(g.state.distance<65)tick(g);
    for(let i=0;i<tier;i++){assert.equal(g.action('turbo'),true);tick(g);}
    if(lane!==1)g.action(lane===0?'left':'right');
    const row=rewards(g),choice=row[lane];let sawFlightCollection=false;
    for(let i=0;i<2400&&g.state.flight;i++){
      tick(g);if(choice.collected&&g.state.flight)sawFlightCollection=true;
    }
    assert.equal(sawFlightCollection,true,`tier${tier} lane${lane}`);
    assert.equal(g.state.phase,'running');assert.ok(g.state.powerups[choice.powerup]>0);
    assert.equal(row.filter(e=>e.collected).length,1);
    assert.equal(g.events.filter(e=>e.type==='powerup'&&!e.headstart).length,1);
    assert.equal(rewards(g).length,3,'ordinary exit does not reset clones');
    for(let i=0;i<10;i++)tick(g);
    assert.equal(g.events.filter(e=>e.type==='powerup'&&!e.headstart).length,1);
  }
});

test('pickup gate compares root altitude at strict 7 boundary and takeoff collider stays disabled',()=>{
  for(const [playerY,rootY,collect] of [[7,7,true],[7,6.999,false],[6.999,7,false],[6.999,6.999,true]]){
    const g=empty();Object.assign(g.state.player,{y:playerY,grounded:false});
    // Flight cruise keeps Y exact so the gate boundary is not crossed by gravity.
    g.activatePowerup('jetpack');g.jetpack.y=playerY;
    g.jetpack.step=()=>({...g.jetpack.snapshot(),active:true,takingOff:false,y:playerY,characterColliderEnabled:true});
    const e=g.addEntity({type:'powerup',powerup:'magnet',x:0,y:rootY+.85,pickupRootY:rootY,distance:.3});
    tick(g);assert.equal(e.collected,collect);
  }
  const g=empty();g.activateHeadstart();const e=g.addEntity({type:'powerup',powerup:'magnet',x:0,y:.85,pickupRootY:0,distance:.3});
  tick(g);assert.equal(e.collected,false);
});

test('reward collection and expiry are stable across 30 and 120 fps on the fixed simulation',()=>{
  function run(frame){const g=empty({seed:48709});g.activateHeadstart();g.action('left');for(let t=0;t<9-1e-8;t+=frame)g.advance(frame);return {state:g.state,rewards:rewards(g),events:g.events};}
  assert.deepEqual(run(1/30),run(1/120));
});
