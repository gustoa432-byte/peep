import type { Group } from "three";
import { createPickaxe } from "./pickaxe";
import { ITEM_DRAFT } from "./item-draft";
import {
  buildItemFromVoxels,
  defaultTransform,
  poseHeldGroup,
} from "./item-voxels";

/**
 * In-world held tool. Never reads forge storage — кузница has its own draft/library.
 */
export function createHeldItem(): Group {
  const transform = defaultTransform();
  if (ITEM_DRAFT.length) {
    const g = buildItemFromVoxels(ITEM_DRAFT);
    poseHeldGroup(g, transform);
    return g;
  }
  return createPickaxe();
}

export { buildItemFromJSON } from "./item-voxels";
