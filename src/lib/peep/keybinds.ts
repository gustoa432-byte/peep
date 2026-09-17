/** Desktop build / movement keybinds — local only, never sent to peers. */

export type KeybindAction = "break" | "place" | "jump" | "crouch";

export type Keybinds = Record<KeybindAction, string>;

export const KEYBINDS_KEY = "peep.keybinds";

export const DEFAULT_KEYBINDS: Keybinds = {
  break: "Mouse0",
  place: "Mouse2",
  jump: "Space",
  crouch: "ControlLeft",
};

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  break: "Ломать",
  place: "Ставить",
  jump: "Прыжок",
  crouch: "Присесть",
};

const ACTIONS: KeybindAction[] = ["break", "place", "jump", "crouch"];

export function isMouseCode(code: string): boolean {
  return code.startsWith("Mouse");
}

export function mouseButtonIndex(code: string): number | null {
  if (code === "Mouse0") return 0;
  if (code === "Mouse1") return 1;
  if (code === "Mouse2") return 2;
  return null;
}

export function codeFromMouseButton(button: number): string | null {
  if (button === 0) return "Mouse0";
  if (button === 1) return "Mouse1";
  if (button === 2) return "Mouse2";
  return null;
}

/** Human label for a KeyboardEvent.code or MouseN. */
export function formatKeyCode(code: string): string {
  if (code === "Mouse0") return "ЛКМ";
  if (code === "Mouse1") return "СКМ";
  if (code === "Mouse2") return "ПКМ";
  if (code === "Space") return "Space";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5);
  return code;
}

function sanitize(raw: unknown): Keybinds {
  const next: Keybinds = { ...DEFAULT_KEYBINDS };
  if (!raw || typeof raw !== "object") return next;
  const obj = raw as Record<string, unknown>;
  for (const action of ACTIONS) {
    const v = obj[action];
    if (typeof v === "string" && v.trim()) next[action] = v.trim();
  }
  return next;
}

export function readKeybinds(): Keybinds {
  if (typeof localStorage === "undefined") return { ...DEFAULT_KEYBINDS };
  try {
    const raw = localStorage.getItem(KEYBINDS_KEY);
    if (!raw) return { ...DEFAULT_KEYBINDS };
    return sanitize(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
}

export function writeKeybinds(binds: Keybinds) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEYBINDS_KEY, JSON.stringify(sanitize(binds)));
  } catch {
    /* quota / private */
  }
}

export function resetKeybinds(): Keybinds {
  const next = { ...DEFAULT_KEYBINDS };
  writeKeybinds(next);
  return next;
}

/** Pure assign — does not touch localStorage (for draft editors). */
export function patchKeybind(binds: Keybinds, action: KeybindAction, code: string): Keybinds {
  const next = { ...binds };
  for (const other of ACTIONS) {
    if (other !== action && next[other] === code) next[other] = "";
  }
  next[action] = code;
  if (!next.jump) next.jump = DEFAULT_KEYBINDS.jump;
  if (!next.crouch) next.crouch = DEFAULT_KEYBINDS.crouch;
  if (!next.break) next.break = DEFAULT_KEYBINDS.break;
  if (!next.place) next.place = DEFAULT_KEYBINDS.place;
  return next;
}

/** Assign `code` to `action`, clearing any other action that held the same code. */
export function assignKeybind(binds: Keybinds, action: KeybindAction, code: string): Keybinds {
  const next = patchKeybind(binds, action, code);
  writeKeybinds(next);
  return next;
}

export const KEYBIND_ACTIONS = ACTIONS;
