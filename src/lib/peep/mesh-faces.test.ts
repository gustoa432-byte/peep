import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AIR, STONE } from "./constants.ts";
import { buildChunkGeometry, GRASS_TUFT_KIND } from "./mesh.ts";
import { VoxelWorld } from "./world.ts";

describe("buildChunkGeometry face emission", () => {
  it("placing one solid in air adds exactly 36 verts (6×6 non-indexed)", () => {
    const world = new VoxelWorld(42, []);
    world.ensureChunk(0, 0);
    for (let y = 18; y <= 22; y++) world.set(8, y, 8, AIR, true);

    const beforeGeo = buildChunkGeometry(world, 0, 0);
    const before = beforeGeo.attributes.position!.count;
    beforeGeo.dispose();

    assert.equal(world.set(8, 20, 8, STONE, true), true);

    const afterGeo = buildChunkGeometry(world, 0, 0);
    const after = afterGeo.attributes.position!.count;
    const delta = after - before;
    assert.equal(delta, 36, `delta=${delta} before=${before} after=${after}`);
    afterGeo.dispose();
  });

  it("two solids with air gap add 72 verts (no shared face, no false merge)", () => {
    const world = new VoxelWorld(42, []);
    world.ensureChunk(0, 0);
    for (let y = 18; y <= 22; y++) world.set(8, y, 8, AIR, true);

    const beforeGeo = buildChunkGeometry(world, 0, 0);
    const before = beforeGeo.attributes.position!.count;
    beforeGeo.dispose();

    world.set(8, 19, 8, STONE, true);
    world.set(8, 21, 8, STONE, true);

    const afterGeo = buildChunkGeometry(world, 0, 0);
    const after = afterGeo.attributes.position!.count;
    const delta = after - before;
    // Two isolated cubes ⇒ 72. If each face drawn twice ⇒ 144.
    assert.equal(delta, 72, `delta=${delta} before=${before} after=${after}`);
    afterGeo.dispose();
  });

  it("stacked solids greedy-merge sides (vert count stays 36, shared face culled)", () => {
    const world = new VoxelWorld(42, []);
    world.ensureChunk(0, 0);
    for (let y = 18; y <= 22; y++) world.set(8, y, 8, AIR, true);

    world.set(8, 20, 8, STONE, true);
    world.set(8, 21, 8, STONE, true);
    const geo = buildChunkGeometry(world, 0, 0);
    // Column of 2: greedy merges side quads → still 36 verts (not 60/72).
    // Proves shared face is NOT emitted twice.
    const alone = (() => {
      const w = new VoxelWorld(42, []);
      w.ensureChunk(0, 0);
      for (let y = 18; y <= 22; y++) w.set(8, y, 8, AIR, true);
      const b = buildChunkGeometry(w, 0, 0).attributes.position!.count;
      w.set(8, 20, 8, STONE, true);
      return buildChunkGeometry(w, 0, 0).attributes.position!.count - b;
    })();
    const base = (() => {
      const w = new VoxelWorld(42, []);
      w.ensureChunk(0, 0);
      for (let y = 18; y <= 22; y++) w.set(8, y, 8, AIR, true);
      return buildChunkGeometry(w, 0, 0).attributes.position!.count;
    })();
    const stacked = geo.attributes.position!.count - base;
    assert.equal(alone, 36);
    assert.equal(stacked, 36, `stacked delta=${stacked} — duplicate shared face would be 60+`);
    geo.dispose();
  });

  it("stone never emits grass-tuft kind verts", () => {
    const world = new VoxelWorld(42, []);
    world.set(8, 20, 8, STONE, true);
    const geo = buildChunkGeometry(world, 0, 0);
    const kinds = geo.attributes.peepKind!.array as Float32Array;
    for (let i = 0; i < kinds.length; i++) {
      assert.notEqual(Math.floor(kinds[i]! + 0.1), GRASS_TUFT_KIND);
    }
    geo.dispose();
  });
});
