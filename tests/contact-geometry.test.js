import test from 'node:test';import assert from 'node:assert/strict';
import {horizontalContact} from '../src/contact-geometry.js';
const train={x:2,distance:10,previousDistance:10,width:1.8,depth:8};
const contact=(a,b,e=train)=>horizontalContact({previousX:a[0],previousDistance:a[1],x:b[0],distance:b[1],radius:.32},e);
test('a lane entry alongside a train hits its side; forward entry hits its front',()=>{
  assert.equal(contact([0,10],[1,10.1]).side,true);
  assert.equal(contact([2,5],[2,6]).side,false);
  assert.equal(contact([0,5],[0,12]),null);
});
test('corner impact follows the last entering plane and moving train velocity remains relative',()=>{
  assert.equal(contact([0,5],[2,6]).side,false);
  assert.equal(contact([0,5],[1,7]).side,true);
  assert.equal(contact([2,5],[2,5],{...train,distance:8}).side,false);
});
