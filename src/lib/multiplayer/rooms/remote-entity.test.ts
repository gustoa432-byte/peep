import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RemoteEntity } from "./remote-entity.ts";

describe("RemoteEntity smoothing", () => {
  it("lerps toward target without snapping for small deltas", () => {
    const e = new RemoteEntity("p1", { followHz: 12, snapDistance: 3 });
    e.snapTo(0, 0, 0, 0);
    e.setTarget(1, 0, 0, 0);
    e.update(1 / 60);
    assert.ok(e.mesh.position.x > 0 && e.mesh.position.x < 1);
    assert.ok(e.mesh.position.x < e.targetPosition.x);
    e.dispose();
  });

  it("hard-snaps when gap exceeds snapDistance", () => {
    const e = new RemoteEntity("p1", { snapDistance: 3 });
    e.snapTo(0, 0, 0, 0);
    e.setTarget(10, 0, 0, Math.PI);
    e.update(1 / 60);
    assert.equal(e.mesh.position.x, 10);
    assert.ok(Math.abs(e.mesh.quaternion.y - e.targetRotation.y) < 1e-6);
    e.dispose();
  });

  it("slerps yaw toward target", () => {
    const e = new RemoteEntity("p1", { followHz: 12, snapDistance: 3 });
    e.snapTo(0, 0, 0, 0);
    e.setTarget(0, 0, 0, Math.PI / 2);
    e.update(1 / 60);
    // Should have rotated partway (not still identity, not fully at target).
    assert.ok(e.mesh.quaternion.angleTo(e.targetRotation) > 0.01);
    assert.ok(e.mesh.quaternion.angleTo(e.targetRotation) < Math.PI / 2 - 0.01);
    e.dispose();
  });
});
