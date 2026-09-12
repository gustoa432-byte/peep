import { getSql } from "@/lib/db";
import {
  DEFAULT_GUEST_PERMISSIONS,
  parseGuestPermissions,
  type GuestPermissions,
} from "./guest-permissions";

/**
 * Host guest_permissions for a world id (SQLite). Server-only.
 */
export async function readGuestPermissionsForWorld(
  worldIdValue: string,
): Promise<GuestPermissions> {
  const sql = await getSql();
  const worlds = await sql.query<{ creator_id: string | null }>(
    `select creator_id from peep_worlds where id = $1`,
    [worldIdValue],
  );
  const creatorId = worlds[0]?.creator_id ?? null;
  if (!creatorId) return { ...DEFAULT_GUEST_PERMISSIONS, banned: [] };

  const rows = await sql.query<{ guest_permissions: string | null }>(
    `select guest_permissions from peep_tg_saves where tg_user_id = $1`,
    [creatorId],
  );
  if (!rows[0]?.guest_permissions) return { ...DEFAULT_GUEST_PERMISSIONS, banned: [] };
  return parseGuestPermissions(rows[0].guest_permissions);
}
