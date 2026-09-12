import type { Story } from "./progress";

let pending: { worldId: string; inventory: Story } | null = null;

export function stashTelegramInventory(worldId: string, inventory: Story) {
  pending = { worldId, inventory: structuredClone(inventory) };
}

export function takeTelegramInventory(worldId: string): Story | null {
  if (!pending || pending.worldId !== worldId) return null;
  const inv = pending.inventory;
  pending = null;
  return inv;
}
