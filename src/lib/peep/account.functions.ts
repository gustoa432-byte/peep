import { createServerFn } from "@tanstack/react-start";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { sanitizeUserSettings, type UserSettingsPayload } from "./user-settings";

const playerId = z.string().regex(/^[a-zA-Z0-9_-]{4,48}$/);
const tgPlayerId = z.string().regex(/^tg_\d{1,16}$/);
const linkToken = z.string().regex(/^[a-zA-Z0-9]{16,48}$/);

function nowMs(): number {
  return Date.now();
}

function botToken(): string | null {
  const t =
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    process.env.TG_BOT_TOKEN?.trim() ||
    process.env.BOT_TOKEN?.trim() ||
    "";
  return t || null;
}

/** Telegram Login Widget HMAC (secret = SHA256(bot_token)). */
function verifyTelegramLoginHash(
  fields: Record<string, string>,
  hash: string,
): boolean {
  const token = botToken();
  if (!token) return false;
  const check = Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  const computed = createHmac("sha256", secret).update(check).digest("hex");
  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function resolveCanonicalId(
  sql: Awaited<ReturnType<typeof getSql>>,
  id: string,
): Promise<string> {
  if (id.startsWith("tg_")) return id;
  const rows = await sql.query<{ tg_player_id: string }>(
    `select tg_player_id from peep_account_links where browser_player_id = $1 limit 1`,
    [id],
  );
  return rows[0]?.tg_player_id ?? id;
}

export async function migratePlayerOwnership(
  sql: Awaited<ReturnType<typeof getSql>>,
  fromId: string,
  toId: string,
) {
  if (fromId === toId) return;
  await sql.query(`update peep_worlds set creator_id = $1 where creator_id = $2`, [toId, fromId]);
  await sql.query(`update peep_worlds set guest_id = $1 where guest_id = $2`, [toId, fromId]);
  await sql.query(`update peep_worlds set guest_id_2 = $1 where guest_id_2 = $2`, [toId, fromId]);
  // Merge settings: keep newer row.
  const rows = await sql.query<{ player_id: string; settings: string; updated_at: number }>(
    `select player_id, settings, updated_at from peep_user_settings where player_id in ($1, $2)`,
    [fromId, toId],
  );
  const from = rows.find((r) => r.player_id === fromId);
  const to = rows.find((r) => r.player_id === toId);
  if (from && (!to || from.updated_at >= to.updated_at)) {
    await sql.query(
      `insert into peep_user_settings (player_id, settings, updated_at)
       values ($1, $2, $3)
       on conflict(player_id) do update set
         settings = excluded.settings,
         updated_at = excluded.updated_at`,
      [toId, from.settings, from.updated_at],
    );
  }
  await sql.query(`delete from peep_user_settings where player_id = $1`, [fromId]);
}

/**
 * Fold a Mini App WebView `p-*` (minted before Telegram user id was ready)
 * onto the real `tg_*` identity so owned worlds are deletable / listed.
 */
export const mergeLegacyPlayer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ tgPlayerId, browserPlayerId: playerId }))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; merged: boolean } | { ok: false; error: string }> => {
      if (!data.browserPlayerId.startsWith("p-")) {
        return { ok: false, error: "not_browser" };
      }
      if (data.browserPlayerId === "p-tgpending" || data.browserPlayerId === "p-ssr") {
        return { ok: true, merged: false };
      }
      const sql = await getSql();
      const existing = await sql.query<{ tg_player_id: string }>(
        `select tg_player_id from peep_account_links where browser_player_id = $1 limit 1`,
        [data.browserPlayerId],
      );
      const linked = existing[0]?.tg_player_id;
      if (linked && linked !== data.tgPlayerId) {
        return { ok: false, error: "linked_other" };
      }
      await sql.query(
        `insert into peep_account_links (browser_player_id, tg_player_id, linked_at)
         values ($1, $2, $3)
         on conflict(browser_player_id) do update set
           tg_player_id = excluded.tg_player_id,
           linked_at = excluded.linked_at`,
        [data.browserPlayerId, data.tgPlayerId, nowMs()],
      );
      await migratePlayerOwnership(sql, data.browserPlayerId, data.tgPlayerId);
      return { ok: true, merged: true };
    },
  );

export const loadUserSettings = createServerFn({ method: "GET" })
  .inputValidator(z.object({ playerId }))
  .handler(async ({ data }): Promise<{ settings: UserSettingsPayload; playerId: string }> => {
    const sql = await getSql();
    const id = await resolveCanonicalId(sql, data.playerId);
    const rows = await sql.query<{ settings: string }>(
      `select settings from peep_user_settings where player_id = $1 limit 1`,
      [id],
    );
    let parsed: unknown = {};
    try {
      parsed = rows[0]?.settings ? JSON.parse(rows[0].settings) : {};
    } catch {
      parsed = {};
    }
    return { settings: sanitizeUserSettings(parsed), playerId: id };
  });

export const saveUserSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      playerId,
      settings: z.unknown(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true; playerId: string }> => {
    const sql = await getSql();
    const id = await resolveCanonicalId(sql, data.playerId);
    const clean = sanitizeUserSettings(data.settings);
    await sql.query(
      `insert into peep_user_settings (player_id, settings, updated_at)
       values ($1, $2, $3)
       on conflict(player_id) do update set
         settings = excluded.settings,
         updated_at = excluded.updated_at`,
      [id, JSON.stringify(clean), nowMs()],
    );
    return { ok: true, playerId: id };
  });

export const getAccountStatus = createServerFn({ method: "GET" })
  .inputValidator(z.object({ playerId }))
  .handler(
    async ({
      data,
    }): Promise<{
      playerId: string;
      linked: boolean;
      tgPlayerId: string | null;
      inTelegram: boolean;
    }> => {
      const sql = await getSql();
      const inTelegram = data.playerId.startsWith("tg_");
      if (inTelegram) {
        return {
          playerId: data.playerId,
          linked: true,
          tgPlayerId: data.playerId,
          inTelegram: true,
        };
      }
      const rows = await sql.query<{ tg_player_id: string }>(
        `select tg_player_id from peep_account_links where browser_player_id = $1 limit 1`,
        [data.playerId],
      );
      const tg = rows[0]?.tg_player_id ?? null;
      return {
        playerId: data.playerId,
        linked: Boolean(tg),
        tgPlayerId: tg,
        inTelegram: false,
      };
    },
  );

/** Browser starts a link challenge; open Mini App with startapp=lnk_<token>. */
export const createLinkChallenge = createServerFn({ method: "POST" })
  .inputValidator(z.object({ playerId }))
  .handler(async ({ data }): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    if (data.playerId.startsWith("tg_")) {
      return { ok: false, error: "already_telegram" };
    }
    const sql = await getSql();
    const existing = await sql.query<{ tg_player_id: string }>(
      `select tg_player_id from peep_account_links where browser_player_id = $1 limit 1`,
      [data.playerId],
    );
    if (existing[0]) return { ok: false, error: "already_linked" };

    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 24);
    await sql.query(
      `insert into peep_link_challenges (token, browser_player_id, created_at)
       values ($1, $2, $3)`,
      [token, data.playerId, nowMs()],
    );
    // Drop stale challenges for this browser id (keep latest).
    await sql.query(
      `delete from peep_link_challenges
       where browser_player_id = $1 and token != $2 and claimed_at is null
         and created_at < $3`,
      [data.playerId, token, nowMs() - 15 * 60_000],
    );
    return { ok: true, token };
  });

/** Mini App claims a challenge after user opens the deep link. */
export const claimLinkChallenge = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: linkToken,
      tgPlayerId,
      /** Optional Login Widget / raw fields for HMAC when bot token is set. */
      auth: z.record(z.string(), z.string()).optional(),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; browserPlayerId: string; tgPlayerId: string }
      | { ok: false; error: string }
    > => {
      const sql = await getSql();
      const rows = await sql.query<{
        browser_player_id: string;
        claimed_at: number | null;
        created_at: number;
      }>(
        `select browser_player_id, claimed_at, created_at from peep_link_challenges where token = $1`,
        [data.token],
      );
      const row = rows[0];
      if (!row) return { ok: false, error: "not_found" };
      if (row.claimed_at) return { ok: false, error: "already_claimed" };
      if (nowMs() - row.created_at > 20 * 60_000) return { ok: false, error: "expired" };

      if (data.auth?.hash && botToken()) {
        const { hash, ...rest } = data.auth;
        if (!verifyTelegramLoginHash(rest, hash)) {
          return { ok: false, error: "bad_auth" };
        }
        const authId = rest.id;
        if (authId && `tg_${authId}` !== data.tgPlayerId) {
          return { ok: false, error: "id_mismatch" };
        }
      }

      const browserId = row.browser_player_id;
      const tgId = data.tgPlayerId;

      await sql.query(
        `insert into peep_account_links (browser_player_id, tg_player_id, linked_at)
         values ($1, $2, $3)
         on conflict(browser_player_id) do update set
           tg_player_id = excluded.tg_player_id,
           linked_at = excluded.linked_at`,
        [browserId, tgId, nowMs()],
      );
      await sql.query(
        `update peep_link_challenges
         set tg_player_id = $1, claimed_at = $2
         where token = $3`,
        [tgId, nowMs(), data.token],
      );
      await migratePlayerOwnership(sql, browserId, tgId);
      return { ok: true, browserPlayerId: browserId, tgPlayerId: tgId };
    },
  );

/** Browser polls until Mini App claims the challenge. */
export const pollLinkChallenge = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: linkToken, playerId }))
  .handler(
    async ({
      data,
    }): Promise<
      | { status: "pending" }
      | { status: "linked"; tgPlayerId: string }
      | { status: "error"; error: string }
    > => {
      const sql = await getSql();
      const rows = await sql.query<{
        browser_player_id: string;
        tg_player_id: string | null;
        claimed_at: number | null;
        created_at: number;
      }>(
        `select browser_player_id, tg_player_id, claimed_at, created_at
         from peep_link_challenges where token = $1`,
        [data.token],
      );
      const row = rows[0];
      if (!row) return { status: "error", error: "not_found" };
      if (row.browser_player_id !== data.playerId) return { status: "error", error: "forbidden" };
      if (nowMs() - row.created_at > 20 * 60_000 && !row.claimed_at) {
        return { status: "error", error: "expired" };
      }
      if (row.claimed_at && row.tg_player_id) {
        return { status: "linked", tgPlayerId: row.tg_player_id };
      }
      return { status: "pending" };
    },
  );
