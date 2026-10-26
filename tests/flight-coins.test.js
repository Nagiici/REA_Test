import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFlightCoins } from '../src/flight-coins.js';

test('flight coins hold center lane, curve to an adjacent lane and keep source spacing', () => {
  const { coins } = makeFlightCoins({ start: 20, length: 24, height: 9.5, random: () => 0 });
  assert.deepEqual(coins.map(c=>c.distance),[20,23,26,29,32,35,38,41]);
  assert.deepEqual(coins.map(c=>c.x),[0,0,0,-1,-2,-2,-2,-2]);
  assert.ok(coins.every(c=>c.y===9.5));
});

test('flight path clamps at track edges and stops strictly before its end', () => {
  const { coins } = makeFlightCoins({start:0,length:90,height:9.5,random:()=>.999});
  assert.equal(coins.length,30); assert.equal(coins.at(-1).distance,87);
  assert.ok(coins.every(c=>c.x>=0&&c.x<=2));
  assert.deepEqual(makeFlightCoins({start:0,length:0,height:9.5,random:()=>0}).coins,[]);
});
