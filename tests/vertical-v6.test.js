import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { classicVerticalMotion } from '../src/classic-vertical.js';
import { SourceRouteGenerator } from '../src/route-generator.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const defaults={y:1,velocityY:-1,dt:1/120,gravity:20,jumping:true,
  ceiling:{hit:true,minY:2,evaded:false},triggerMaxY:2.05,sneakersJump:null,oldDistance:4,nextDistance:4.1};
function empty(){const g=new RunnerGame({acceleration:0});g.entities=[];g.nextSection=1e9;g.start();return g;}

test('shoe upper impact holds vertical motion and keeps record through old-Z endpoint',()=>{
  const jump={startDistance:0,length:5,startY:0};
  const held=classicVerticalMotion({...defaults,sneakersJump:jump,velocityY:-20,nextDistance:5.01});
  assert.equal(held.dy,0);assert.equal(held.sneakersJump,jump);assert.equal(held.velocityY,-20);
  const ended=classicVerticalMotion({...defaults,sneakersJump:jump,oldDistance:5,nextDistance:5.1});
  assert.equal(ended.sneakersJump,null);assert.equal(ended.velocityY,0);assert.equal(ended.dy,0);
  const falling=classicVerticalMotion({...defaults,velocityY:-20/120});
  assert.ok(falling.dy<0);
});

test('ceiling evasion equality and rising/falling branches use the trigger top',()=>{
  near(classicVerticalMotion({...defaults,velocityY:2}).dy,-20/120**2);
  const equal=classicVerticalMotion({...defaults,triggerMaxY:2,velocityY:2});
  assert.equal(equal.ceiling.evaded,true);assert.equal(equal.dy,0);
  const falling=classicVerticalMotion({...defaults,triggerMaxY:2,velocityY:-3});
  assert.equal(falling.ceiling.evaded,true);near(falling.dy,-3/120);
  assert.equal(classicVerticalMotion({...defaults,triggerMaxY:2.000001}).ceiling.evaded,false);
});

test('game retains sneakers record after upper contact and falls only after its distance cap',()=>{
  const g=empty();g.activatePowerup('sneakers');g.action('jump');assert.equal(g.state.player.velocityY,0);
  g.advance(1/120);const p=g.state.player;assert.ok(p.y>0);assert.ok(p.velocityY<0);
  // An actual upper contact records the height. It may then leave geometrically
  // while the source curve remains suppressed.
  g.ceiling={hit:true,minY:p.y+.9,evaded:false};p.velocityY=0;
  const heldY=p.y,record=p.sneakersJump;
  for(let i=0;i<10;i++)g.advance(1/120);
  near(p.y,heldY);assert.equal(p.sneakersJump,record);
  g.state.distance=record.startDistance+record.length;g.advance(1/120);
  near(p.y,heldY);assert.equal(p.sneakersJump,null);assert.equal(p.velocityY,0);
  g.advance(1/120);assert.ok(p.y<heldY);
  for(let i=0;i<120;i++)g.advance(1/120);
  assert.equal(p.grounded,true);assert.equal(g.ceiling.hit,false);assert.equal(g.ceiling.evaded,true);
});

test('upper collision action itself preserves sneaker curve while lower hop interrupts it',()=>{
  const g=empty();g.activatePowerup('sneakers');g.action('jump');
  g.state.player.y=1;g.state.player.sneakersJump.startY=1;g.state.player.sneakersJump.length=100;
  g.addEntity({type:'obstacle',x:0,distance:0,width:2,depth:10,bottom:2.02,height:3,sourceLayer:'Hit'});
  g.advance(1/120);assert.equal(g.ceiling.hit,true);assert.ok(g.state.player.sneakersJump);
});

test('repeated high-air Down changes velocity only with an actual containing route',()=>{
  const g=empty(),p=g.state.player;p.y=25;p.grounded=false;p.lastGroundedY=8;
  g.routeGenerator={relativePosition:position=>position};
  g.action('roll');near(p.velocityY,-Math.sqrt(2*20*25));
  const token=p.rollToken,time=p.rollRemaining;p.y=24;p.velocityY=-50;
  assert.equal(g.action('roll'),false);near(p.velocityY,-Math.sqrt(2*20*24));
  assert.equal(p.rollToken,token);assert.equal(p.rollRemaining,time);
  p.y=20;p.velocityY=-50;g.action('roll');assert.equal(p.velocityY,-50);
  g.routeGenerator.relativePosition=()=>null;p.y=25;g.action('roll');assert.equal(p.velocityY,-50);
});

test('flat default route membership ends at 9 units and cannot activate the >20 override',()=>{
  const l=JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json',import.meta.url)));
  const generator=new SourceRouteGenerator(l);
  assert.deepEqual(generator.relativePosition([3,9,50],{end:50}),[3,9,50]);
  assert.equal(generator.relativePosition([0,9.00001,40],{end:50}),null);
  assert.equal(generator.relativePosition([0,25,40],{end:50}),null);
  assert.equal(generator.relativePosition([0,5,51],{end:50}),null);
});
