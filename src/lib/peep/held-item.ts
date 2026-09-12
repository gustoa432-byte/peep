import type { Group } from "three";
import { createPickaxe } from "./pickaxe";
import { ITEM_DRAFT } from "./item-draft";
import {
  applyItemTransform,
  buildItemFromVoxels,
  defaultTransform,
  poseHeldGroup,
  readStoredDocument,
  type ItemDocument,
} from "./item-voxels";

function resolveDocument(): ItemDocument | null {
  const stored = readStoredDocument();
  if (stored && stored.voxels.length) return stored;
  if (ITEM_DRAFT && ITEM_DRAFT.length) {
    return { voxels: ITEM_DRAFT, transform: stored?.transform ?? defaultTransform() };
  }
  return null;
}

export function createHeldItem(): Group {
  const doc = resolveDocument();
  const transform = defaultTransform();
  applyItemTransform(transform);
  if (doc && doc.voxels.length) {
    const g = buildItemFromVoxels(doc.voxels);
    poseHeldGroup(g, transform);
    return g;
  }
  return createPickaxe();
}

export { buildItemFromJSON } from "./item-voxels";
