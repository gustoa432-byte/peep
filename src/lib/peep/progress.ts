const KEY = "peep.story";

export type Story = {
  counts: Record<number, number>;
  friday: boolean;
  hat: boolean;
  chest: boolean;
};

function empty(): Story {
  return { counts: {}, friday: false, hat: false, chest: false };
}

function slot(worldId: string, playerId: string): string {
  return `${KEY}.${worldId}.${playerId}`;
}

export function loadStory(worldId: string, playerId: string): Story {
  if (typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(slot(worldId, playerId));
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<Story>;
    const counts: Record<number, number> = {};
    if (p.counts && typeof p.counts === "object") {
      for (const [k, v] of Object.entries(p.counts)) {
        const id = Number(k);
        const n = Number(v);
        if (Number.isFinite(id) && Number.isFinite(n) && n > 0) counts[id] = Math.floor(n);
      }
    }
    return {
      counts,
      friday: Boolean(p.friday || p.chest),
      hat: Boolean(p.hat),
      chest: Boolean(p.chest),
    };
  } catch {
    return empty();
  }
}

export function saveStory(worldId: string, playerId: string, story: Story) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(slot(worldId, playerId), JSON.stringify(story));
  } catch {
    /* quota */
  }
}

export function countOf(story: Story, block: number): number {
  return story.counts[block] ?? 0;
}

export function addBlock(story: Story, block: number, n = 1) {
  if (block <= 0 || n <= 0) return;
  story.counts[block] = (story.counts[block] ?? 0) + n;
}

export function takeBlock(story: Story, block: number): boolean {
  const n = story.counts[block] ?? 0;
  if (n <= 0) return false;
  if (n === 1) delete story.counts[block];
  else story.counts[block] = n - 1;
  return true;
}
