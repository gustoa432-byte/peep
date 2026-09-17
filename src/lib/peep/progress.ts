import { DYNAMITE, DYNAMITE_MAX_CHARGES, DYNAMITE_RECHARGE_MS } from "./constants";

const KEY = "peep.story";

export type Story = {
  counts: Record<number, number>;
  friday: boolean;
  hat: boolean;
  chest: boolean;
  /** 0–1 progress toward opening the buried chest. */
  chestCraft: number;
  /** Dynamite charges currently ready (0…DYNAMITE_MAX_CHARGES). */
  dynamiteCharges: number;
  /** Epoch ms when the next +1 charge unlocks; 0 if already full. */
  dynamiteRechargeAt: number;
  /** Hidden underwater troll quest completed (TNT rain). */
  trollQuestDone: boolean;
};

function empty(): Story {
  return {
    counts: {},
    friday: false,
    hat: false,
    chest: false,
    chestCraft: 0,
    dynamiteCharges: DYNAMITE_MAX_CHARGES,
    dynamiteRechargeAt: 0,
    trollQuestDone: false,
  };
}

/** Normalize partial / legacy inventory JSON into a full Story. */
export function normalizeStory(p: Partial<Story> | null | undefined): Story {
  const counts: Record<number, number> = {};
  if (p?.counts && typeof p.counts === "object") {
    for (const [k, v] of Object.entries(p.counts)) {
      const id = Number(k);
      const n = Number(v);
      if (id === DYNAMITE) continue;
      if (Number.isFinite(id) && Number.isFinite(n) && n > 0) counts[id] = Math.floor(n);
    }
  }
  const story: Story = {
    counts,
    friday: Boolean(p?.friday || p?.chest),
    hat: Boolean(p?.hat),
    chest: Boolean(p?.chest),
    chestCraft: Math.min(1, Math.max(0, Number(p?.chestCraft) || 0)),
    dynamiteCharges:
      typeof p?.dynamiteCharges === "number" && Number.isFinite(p.dynamiteCharges)
        ? Math.min(DYNAMITE_MAX_CHARGES, Math.max(0, Math.floor(p.dynamiteCharges)))
        : DYNAMITE_MAX_CHARGES,
    dynamiteRechargeAt:
      typeof p?.dynamiteRechargeAt === "number" && Number.isFinite(p.dynamiteRechargeAt)
        ? Math.max(0, Math.floor(p.dynamiteRechargeAt))
        : 0,
    trollQuestDone: Boolean(p?.trollQuestDone),
  };
  refreshDynamite(story);
  return story;
}

function slot(worldId: string, playerId: string): string {
  return `${KEY}.${worldId}.${playerId}`;
}

/** Apply elapsed recharge ticks (capped at DYNAMITE_MAX_CHARGES). */
export function refreshDynamite(story: Story, now = Date.now()): void {
  if (story.dynamiteCharges >= DYNAMITE_MAX_CHARGES) {
    story.dynamiteCharges = DYNAMITE_MAX_CHARGES;
    story.dynamiteRechargeAt = 0;
    return;
  }
  if (!story.dynamiteRechargeAt || story.dynamiteRechargeAt <= 0) {
    story.dynamiteRechargeAt = now + DYNAMITE_RECHARGE_MS;
    return;
  }
  while (story.dynamiteCharges < DYNAMITE_MAX_CHARGES && now >= story.dynamiteRechargeAt) {
    story.dynamiteCharges += 1;
    if (story.dynamiteCharges >= DYNAMITE_MAX_CHARGES) {
      story.dynamiteCharges = DYNAMITE_MAX_CHARGES;
      story.dynamiteRechargeAt = 0;
      return;
    }
    story.dynamiteRechargeAt += DYNAMITE_RECHARGE_MS;
  }
}

export function dynamiteCharges(story: Story, now = Date.now()): number {
  refreshDynamite(story, now);
  return story.dynamiteCharges;
}

/** 0…1 fill toward the next recharge tick (0 when full). */
export function dynamiteRechargeProgress(story: Story, now = Date.now()): number {
  refreshDynamite(story, now);
  if (story.dynamiteCharges >= DYNAMITE_MAX_CHARGES) return 0;
  if (!story.dynamiteRechargeAt || story.dynamiteRechargeAt <= 0) return 0;
  const left = story.dynamiteRechargeAt - now;
  if (left <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - left / DYNAMITE_RECHARGE_MS));
}

/** Spend one charge; starts recharge timer if was full. */
export function takeDynamite(story: Story, now = Date.now()): boolean {
  refreshDynamite(story, now);
  if (story.dynamiteCharges <= 0) return false;
  const wasFull = story.dynamiteCharges >= DYNAMITE_MAX_CHARGES;
  story.dynamiteCharges -= 1;
  if (wasFull || !story.dynamiteRechargeAt) {
    story.dynamiteRechargeAt = now + DYNAMITE_RECHARGE_MS;
  }
  return true;
}

export function refundDynamite(story: Story, now = Date.now()): void {
  refreshDynamite(story, now);
  if (story.dynamiteCharges >= DYNAMITE_MAX_CHARGES) return;
  story.dynamiteCharges += 1;
  if (story.dynamiteCharges >= DYNAMITE_MAX_CHARGES) {
    story.dynamiteCharges = DYNAMITE_MAX_CHARGES;
    story.dynamiteRechargeAt = 0;
  }
}

/** Fill dynamite to hardcap (full refill). */
export function fillDynamite(story: Story): void {
  story.dynamiteCharges = DYNAMITE_MAX_CHARGES;
  story.dynamiteRechargeAt = 0;
}

/** Add charges without exceeding the hardcap (quest rewards). */
export function addDynamite(story: Story, n: number, now = Date.now()): void {
  if (n <= 0) return;
  refreshDynamite(story, now);
  story.dynamiteCharges = Math.min(DYNAMITE_MAX_CHARGES, story.dynamiteCharges + Math.floor(n));
  if (story.dynamiteCharges >= DYNAMITE_MAX_CHARGES) story.dynamiteRechargeAt = 0;
}

export function loadStory(worldId: string, playerId: string): Story {
  if (typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(slot(worldId, playerId));
    if (!raw) return empty();
    return normalizeStory(JSON.parse(raw) as Partial<Story>);
  } catch {
    return empty();
  }
}

export function saveStory(worldId: string, playerId: string, story: Story) {
  if (typeof localStorage === "undefined") return;
  try {
    refreshDynamite(story);
    localStorage.setItem(slot(worldId, playerId), JSON.stringify(story));
  } catch {
    /* quota */
  }
}

export function countOf(story: Story, block: number): number {
  if (block === DYNAMITE) return dynamiteCharges(story);
  return story.counts[block] ?? 0;
}

export function addBlock(story: Story, block: number, n = 1) {
  if (block <= 0 || n <= 0 || block === DYNAMITE) return;
  story.counts[block] = (story.counts[block] ?? 0) + n;
}

export function takeBlock(story: Story, block: number): boolean {
  if (block === DYNAMITE) return takeDynamite(story);
  const n = story.counts[block] ?? 0;
  if (n <= 0) return false;
  if (n === 1) delete story.counts[block];
  else story.counts[block] = n - 1;
  return true;
}
