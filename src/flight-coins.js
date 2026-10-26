import { curveValue } from './powerups.js';

// JetpackState.SpawnCoins 82417 and <SpawnCoinCurve>.MoveNext 82470.
// Native: hold a lane for 60 units, transition over characterChangeTrackLength
// (serialized 60), then clamp a random {-1,0,1} lane step. Coins every 30 units.
export function makeFlightCoins({ start, length, height, random, laneSpacing = 2, changeLength = 6 }) {
  const keys = [];
  let lane = 1;
  function key(time, value) {
    if (keys.at(-1)?.time === time) return;
    keys.push({ time, value, inSlope: 0, outSlope: 0 });
  }
  for (let z = start; z < start + length; z += 6 + changeLength) {
    key(z, (lane - 1) * laneSpacing);
    key(z + 6, (lane - 1) * laneSpacing);
    lane = Math.max(0, Math.min(2, lane + Math.floor(random() * 3) - 1));
    key(z + 6 + changeLength, (lane - 1) * laneSpacing);
  }
  const coins = [];
  for (let distance = start; distance < start + length; distance += 3) {
    coins.push({ type: 'coin', x: curveValue(keys, distance), y: height, distance, flightCoin: true });
  }
  return { keys, coins };
}
