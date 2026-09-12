import { PICKAXE_CELLS } from "./item-templates";
import type { ItemVoxel } from "./item-voxels";

/**
 * Built-in held item. localStorage (`peep.forge.item`) still wins if present.
 */
export const ITEM_DRAFT: ItemVoxel[] = PICKAXE_CELLS;
