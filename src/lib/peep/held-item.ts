import type { Group } from "three";
import { createPickaxe } from "./pickaxe";
import { ITEM_DRAFT } from "./item-draft";
import { buildItemFromJSON, ITEM_DEBUG, readStoredItem } from "./item-voxels";

export function createHeldItem(): Group {
  const draft = readStoredItem() ?? ITEM_DRAFT;
  if (draft && draft.length > 0) {
    const g = buildItemFromJSON(JSON.stringify(draft));
    g.position.set(ITEM_DEBUG.x, ITEM_DEBUG.y, ITEM_DEBUG.z);
    g.rotation.set(ITEM_DEBUG.rx, ITEM_DEBUG.ry, ITEM_DEBUG.rz);
    g.scale.setScalar(ITEM_DEBUG.scale);
    return g;
  }
  return createPickaxe();
}

export { buildItemFromJSON } from "./item-voxels";
