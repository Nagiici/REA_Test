import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';
const ticks=(g,n)=>{for(let i=0;i<n;i++)g.advance(1/120);};
function game(config={}){const g=new RunnerGame({acceleration:0,...config});g.entities=[];g.nextSection=1e9;g.start();return g;}

test('lane speed follows current speed and remains the same in an ordinary airborne jump',()=>{
 for(const speed of [11,22])for(const air of [false,true]){
  const g=game({initialSpeed:speed});if(air)g.action('jump');g.action('right');
  assert.equal(g.state.player.laneDuration,3/speed);
  ticks(g,Math.ceil(3/speed*120));assert.equal(g.state.player.x,2);
 }
});
test('roll ignores repeated input without resetting descent and becomes available again at source clip end',()=>{
 const g=game();g.action('jump');ticks(g,12);g.action('roll');
 assert.equal(g.state.player.velocityY,-Math.sqrt(80));
 ticks(g,12);const before={...g.state.player};assert.equal(g.action('roll'),false);
 assert.equal(g.state.player.rollRemaining,before.rollRemaining);assert.equal(g.state.player.velocityY,before.velocityY);
 ticks(g,54);assert.equal(g.state.player.rollRemaining,0);assert.equal(g.action('roll'),true);
 assert.equal(g.state.player.rollToken,2);
});
test('step-off jump grace accepts falling velocity above -3, but never grants another jump at the apex',()=>{
 const g=game();const p=g.state.player;p.grounded=false;p.y=.5;p.velocityY=-2.9;
 assert.equal(g.action('jump'),true);p.velocityY=-.1;assert.equal(g.action('jump'),false);
 const h=game();Object.assign(h.state.player,{grounded:false,y:.5,velocityY:-3});
 assert.equal(h.action('jump'),false);assert.equal(h.state.player.inAirJump,true);
});
test('downward jump request is consumed on landing; roll cancels that pending request',()=>{
 for(const cancel of [false,true]){
  const g=game();g.action('jump');ticks(g,70);assert.ok(g.state.player.velocityY<0);
  assert.equal(g.action('jump'),false);if(cancel)g.action('roll');
  ticks(g,50);assert.equal(g.state.player.inAirJump,false);
  assert.equal(g.events.filter(e=>e.type==='jump').length,cancel?1:2);
 }
});
test('landing reports velocity before reset and pause freezes source roll deadline',()=>{
 const g=game();g.action('jump');ticks(g,120);
 const landed=g.events.find(e=>e.type==='land');assert.ok(landed.velocityY < -8);
 g.action('roll');ticks(g,10);g.pause();const left=g.state.player.rollRemaining;ticks(g,200);assert.equal(g.state.player.rollRemaining,left);
});
