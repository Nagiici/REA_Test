import test from 'node:test';
import assert from 'node:assert/strict';
import { Hoverboard, HOVERBOARD_SOURCE as SOURCE } from '../src/hoverboard.js';
const cooldown = Math.fround(5 + SOURCE.crashParticleDelay);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

test('denied taps consume no inventory, and natural expiry waits the source negative timer before another activation', () => {
  const board=new Hoverboard();
  assert.equal(board.activate({flying:true}),false);assert.equal(board.activate({allowed:false}),false);
  assert.equal(board.state.inventory,3);assert.equal(board.activate(),true);assert.equal(board.activate(),false);
  assert.deepEqual(board.step(30),[{type:'expired'}]);
  assert.equal(board.activate(),false);assert.equal(board.state.inventory,2);
  board.step(cooldown-.001);assert.equal(board.activate(),false);
  assert.deepEqual(board.step(.0011),[{type:'rearmed',policy:'source-timer'}]);
  assert.equal(board.activate(),true);assert.equal(board.state.inventory,1);
});

test('Jetpack pauses positive duration and negative cooldown, preserving the original board and inventory', () => {
  const board=new Hoverboard();board.activate();board.step(12);board.step(60,{pausedForFlight:true});
  assert.equal(board.state.timeLeft,18);assert.equal(board.visible,false);assert.equal(board.hit(),false);
  board.step(0);assert.equal(board.visible,true);board.step(19);
  close(board.state.timeLeft,-1);board.step(60,{pausedForFlight:true});close(board.state.timeLeft,-1);
  assert.equal(board.activate(),false);board.step(cooldown-1-.001);assert.equal(board.canActivate,false);
  board.step(.0011);assert.equal(board.canActivate,true);assert.equal(board.state.inventory,2);
});

test('crash waits for particles and samples CURRENT normalized speed on recovery, not at impact', () => {
  const board=new Hoverboard();board.activate();assert.equal(board.hit(),true);
  assert.equal(board.state.timeLeft,0);assert.equal(board.visible,false);
  assert.deepEqual(board.step(.1,{levelSpeed:110,speedNormalized:1}),[]);
  assert.equal(board.hit(),true); // Duplicate death guard must not restart either clock.
  close(board.state.timeLeft,-.1);
  const result=board.step(SOURCE.crashParticleDelay-.1,{levelSpeed:165,speedNormalized:1.5});
  assert.deepEqual(result,[{type:'clearObstacles',distanceNative:375},{type:'revive',jumpHeightNative:15}]);
  close(board.state.cooldownRemainingNative,174);close(board.state.recoveryRemainingNative,135);
  board.step(1,{levelSpeed:165});assert.equal(board.canActivate,false);
  close(board.state.cooldownRemainingNative,39);close(board.state.recoveryRemainingNative,0);
  assert.equal(board.state.inventory,2);
});

test('reactivation uses the same 5.14-second threshold at zero, normal and high speed', () => {
  for(const speed of [0,110,220,700]){
    const board=new Hoverboard();board.activate();board.hit();
    board.step(5,{levelSpeed:speed});assert.equal(board.canActivate,false);
    const events=board.step(cooldown-5+.00001,{levelSpeed:speed});
    assert.deepEqual(events,[{type:'rearmed',policy:'source-timer'}]);assert.equal(board.canActivate,true);
    assert.deepEqual(board.step(10,{levelSpeed:speed}),[]);
  }
});

test('normal expiry never clears hazards or revives; large tick preserves negative overflow and reset clears cooldown', () => {
  const board=new Hoverboard();board.activate();
  assert.deepEqual(board.step(30+cooldown+.001),[{type:'expired'},{type:'rearmed',policy:'source-timer'}]);
  board.activate();board.hit();board.reset({inventory:1});
  assert.equal(board.state.cooldownBlocked,false);assert.equal(board.activate(),true);assert.equal(board.state.inventory,0);
});

test('a crash interrupted by Jetpack waits for resume before clearing and uses resume-time speed',()=>{
 const b=new Hoverboard();b.activate();b.hit();b.step(.05);const before=structuredClone(b.state);
 b.step(20,{pausedForFlight:true,levelSpeed:220,speedNormalized:2});
 close(b.state.crashDelay,before.crashDelay);close(b.state.timeLeft,before.timeLeft);
 const events=b.step(SOURCE.crashParticleDelay-.05,{speedNormalized:2});
 assert.deepEqual(events,[{type:'clearObstacles',distanceNative:500},{type:'revive',jumpHeightNative:15}]);
 assert.equal(b.canActivate,false);
});
