import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { EnvironmentRouteGenerator } from '../src/environment-layout.js';

const root = new URL('../public/assets/recovered/', import.meta.url);
const read = path => JSON.parse(fs.readFileSync(new URL(path, root)));
const library = read('route-library.json');
library.modelBindings = read(library.modelBindingsFile);
const bindings = read(read('manifest.json').environmentBindings);
const generator = seed => new EnvironmentRouteGenerator(new SourceRouteGenerator(library, { seed }), bindings);

test('48 real-course flights stay safe until first ground contact at original minimum and maximum running speeds', () => {
  for (const speed of [11, 22]) for (let seed = 1; seed <= 24; seed++) {
    const game = new RunnerGame({ seed, initialSpeed: speed, maximumSpeed: speed, acceleration: 0 });
    game.setRouteGenerator(generator(seed));
    const built = JSON.stringify(game.routeTrace), builtCount = game.routeTrace.length;
    game.start();
    game.activatePowerup('jetpack');
    const target = game.state.flight.targetZ;
    let ended = false, firstTouch = null;
    for (let frame = 0; frame < 4000; frame++) {
      game.advance(1 / 120);
      assert.equal(game.state.phase, 'running', `speed ${speed}, seed ${seed}, distance ${game.state.distance}: ${JSON.stringify(game.state.collision)}`);
      if (!game.state.flight) ended = true;
      if (ended && game.state.player.grounded) { firstTouch = game.state.distance; break; }
    }
    assert.ok(ended && firstTouch !== null, `seed ${seed}: flight never landed`);
    assert.equal(game.state.player.y, 0);
    assert.equal(game.state.player.floor, 0);
    assert.equal(JSON.stringify(game.routeTrace.slice(0, builtCount)), built, 'pre-existing scene must not be replaced');
    const landing = game.routeTrace.find(chunk => chunk.jetpackLanding?.kind === 'landing');
    assert.equal(landing.startDistance, target);
    assert.equal(landing.length, 18);
    const padding = game.routeTrace.filter(chunk => chunk.jetpackLanding?.kind === 'landing-safety-padding');
    assert.equal(padding.length, speed === 22 ? 1 : 0);
    const safeEnd = target + landing.length + padding.reduce((sum, chunk) => sum + chunk.length, 0);
    assert.ok(firstTouch + game.config.playerRadius <= safeEnd);
    for (const chunk of padding) {
      assert.equal(chunk.chunkId, 'routes/default/chunks/routechunk_default_fallback');
      assert.equal(chunk.length, 18);
      assert.equal(chunk.jetpackLanding.adapter, 'browser-landing-runout');
    }
    if (speed === 22 && seed === 5) {
      // Before the explicit runout adapter: target414, landing414..432;
      // obstacle404 killed the falling player at432.3000000000052, Y2.7625.
      // Preserve this concrete regression; do not hide it with invulnerability.
      assert.equal(target, 414);
      assert.ok(firstTouch > 432 && firstTouch < 436);
      assert.equal(game.state.board.active, false);
      assert.equal(game.hoverboard.protects, false);
    }
  }
});

test('4000 emitted chunks retain continuous bounds while repeated landing requests pack before their deadlines', () => {
  let landings = 0, safetyBlocks = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const route = generator(seed);
    let edge = 0, activeTarget = null, sawLanding = false;
    for (let index = 0; index < 500; index++) {
      if (index % 37 === 4) {
        activeTarget = route.scheduleJetpackLanding(edge + 19 + index % 11 * 18, edge, 22);
        sawLanding = false;
      }
      const chunk = route.nextChunk({ startDistance: edge, speed: index % 2 ? 11 : 22 });
      assert.ok(chunk.length > 0 && Number.isFinite(chunk.length));
      const marker = chunk.provenance.jetpackLanding;
      if (marker?.kind === 'landing') {
        assert.equal(edge, activeTarget);
        assert.equal(chunk.length, 18);
        assert.ok(chunk.entities.every(entity => entity.type === 'decoration'));
        landings++; sawLanding = true;
      } else if (marker?.kind === 'landing-safety-padding') {
        assert.equal(edge, activeTarget + 18);
        assert.equal(chunk.length, 18);
        assert.ok(sawLanding);
        safetyBlocks++;
      } else if (route.pendingJetpackLanding) {
        assert.ok(edge + chunk.length <= activeTarget + 1e-7);
        const section = route.source.currentSection;
        assert.ok(section.startDistance + section.fields._lengthMin * .1 <= activeTarget + 1e-7);
      }
      for (const entity of chunk.entities) assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.distance));
      edge += chunk.length;
    }
    assert.ok(edge > 15000);
  }
  assert.ok(landings >= 100 && safetyBlocks >= 100);
  assert.equal(landings, safetyBlocks);
});

test('36 long upgraded flights preserve a continuous runway through touchdown in all lanes while speed ramps', () => {
  for (const initialSpeed of [11, 17, 22]) for (const lane of [0, 1, 2]) for (let seed = 1; seed <= 4; seed++) {
    const game = new RunnerGame({ seed, initialSpeed, maximumSpeed: 22, powerupTier: 6 });
    game.setRouteGenerator(generator(seed)); game.start();
    // Takeoff from an elevated surface must still settle to the native 9.5.
    game.state.player.y = seed % 2 ? 3 : 0;
    game.activatePowerup('jetpack');
    if (lane !== 1) game.action(lane === 0 ? 'left' : 'right');
    const target = game.state.flight.targetZ; let landed = false;
    for (let i = 0; i < 5000; i++) {
      game.advance(1 / 120);
      assert.equal(game.state.phase, 'running', `speed=${initialSpeed}, lane=${lane}, seed=${seed}, z=${game.state.distance}`);
      if (!game.state.flight && game.state.player.grounded) { landed = true; break; }
    }
    assert.ok(landed); assert.equal(game.state.player.y, 0);
    assert.equal(game.state.player.lane, lane);
    const runway = game.routeTrace.filter(c => ['landing', 'landing-safety-padding'].includes(c.jetpackLanding?.kind));
    assert.equal(runway[0].startDistance, target);
    for (let i = 1; i < runway.length; i++) assert.equal(runway[i].startDistance, runway[i - 1].startDistance + runway[i - 1].length);
    const safeEnd = runway.at(-1).startDistance + runway.at(-1).length;
    assert.ok(game.state.distance + game.config.playerRadius <= safeEnd, 'reserve includes touchdown capsule, not just takeoff-speed prediction');
    if (initialSpeed === 17) {
      assert.equal(runway.length, 2);
      assert.ok(game.state.speed > 18.6);
      assert.ok(game.state.distance > target + 18, 'regression: old runway ended before touchdown');
    }
    // Ground contact and animation landing are distinct native iterations.
    game.drainEvents(); game.advance(1 / 120);
    assert.equal(game.drainEvents().filter(e => e.type === 'land').length, 1);
    game.advance(1 / 120);
    assert.equal(game.drainEvents().filter(e => e.type === 'land').length, 0);
  }
});
