/** Client-side user settings shape synced with peep_user_settings. */

import {
  DEFAULT_KEYBINDS,
  readKeybinds,
  writeKeybinds,
  type Keybinds,
} from "./keybinds";

export type UserSettingsPayload = {
  keybinds: Keybinds;
};

export function defaultUserSettings(): UserSettingsPayload {
  return { keybinds: { ...DEFAULT_KEYBINDS } };
}

export function readLocalUserSettings(): UserSettingsPayload {
  return { keybinds: readKeybinds() };
}

export function applyLocalUserSettings(settings: UserSettingsPayload) {
  if (settings.keybinds) writeKeybinds(settings.keybinds);
}

export function sanitizeUserSettings(raw: unknown): UserSettingsPayload {
  const base = defaultUserSettings();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  if (obj.keybinds && typeof obj.keybinds === "object") {
    const kb = obj.keybinds as Record<string, unknown>;
    const next = { ...DEFAULT_KEYBINDS };
    for (const k of Object.keys(DEFAULT_KEYBINDS) as (keyof Keybinds)[]) {
      const v = kb[k];
      if (typeof v === "string" && v.trim()) next[k] = v.trim();
    }
    base.keybinds = next;
  }
  return base;
}
