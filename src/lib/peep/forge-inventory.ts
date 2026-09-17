import {
  parseItemDocument,
  serializeItemDocument,
  type ItemDocument,
} from "./item-voxels";

/** Saved forge items — never used as the in-world held tool. */
export const FORGE_INVENTORY_KEY = "peep.forge.inventory";

export function readForgeInventory(): ItemDocument[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(FORGE_INVENTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ItemDocument[] = [];
    for (const entry of parsed) {
      try {
        const doc = parseItemDocument(typeof entry === "string" ? entry : JSON.stringify(entry));
        if (doc.voxels.length) out.push(doc);
      } catch {
        /* skip bad entry */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function writeForgeInventory(items: readonly ItemDocument[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    FORGE_INVENTORY_KEY,
    JSON.stringify(items.map((doc) => JSON.parse(serializeItemDocument(doc)))),
  );
}

/** Append a forge export to the player's forge inventory (does not equip). */
export function pushForgeInventoryItem(doc: ItemDocument): ItemDocument[] {
  if (!doc.voxels.length) return readForgeInventory();
  const next = [...readForgeInventory(), doc];
  writeForgeInventory(next);
  return next;
}
