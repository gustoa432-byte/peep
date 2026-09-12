#!/usr/bin/env node
/**
 * Brand-asset gate shared by browser-smoke.mjs: canvas / game apps should ship
 * a custom share card at public/og.jpg and declare identity in site.json.
 *
 *   node scripts/brand-check.mjs [--game] [--placeholder-ok] [--root <dir>]
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainModule } from "./with-app-env.mjs";

export const OG_SITE_REL_PATH = "src/lib/og/site.json";

export function readOgSite(cwd = process.cwd()) {
  try {
    const raw = readFileSync(join(cwd, OG_SITE_REL_PATH), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function siteHasCustomCard(site = {}) {
  return String(site.card ?? "").toLowerCase() === "custom";
}

export const MAX_CARD_BYTES = 600 * 1024;

export const OG_PENDING_REL_PATH = ".local/og-pending";
export const OG_PENDING_MAX_AGE_MS = 10 * 60 * 1000;

export function siteDeclaresOgTypeGame(site) {
  return String(site?.type ?? "").toLowerCase() === "x:game";
}

export function ogPendingActive(workspaceRoot, now = Date.now()) {
  try {
    const { mtimeMs } = statSync(join(workspaceRoot, OG_PENDING_REL_PATH));
    return now - mtimeMs < OG_PENDING_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function computeBrandWarnings({
  hasCanvas,
  workspaceRoot = process.cwd(),
  now = Date.now(),
}) {
  if (ogPendingActive(workspaceRoot, now)) return [];
  return brandWarningsOnDisk({ hasCanvas, workspaceRoot });
}

function brandWarningsOnDisk({
  hasCanvas,
  workspaceRoot = process.cwd(),
  cardRequired = false,
}) {
  const sitePath = join(workspaceRoot, OG_SITE_REL_PATH);
  const site = readOgSite(workspaceRoot);
  const cardPath = [
    join(workspaceRoot, "public/og.jpg"),
    join(workspaceRoot, "public/og.png"),
  ].find(existsSync);
  const warnings = [];

  if (cardPath !== undefined) {
    if (statSync(cardPath).size > MAX_CARD_BYTES) {
      warnings.push(
        `BRAND WARNING: ${cardPath} is over 600 KB — re-encode as JPEG under 600 KB.`,
      );
    }
    if (!siteHasCustomCard(site)) {
      warnings.push(
        `BRAND WARNING: ${cardPath} exists but ${sitePath} is missing "card": "custom".`,
      );
    }
  } else if (hasCanvas) {
    warnings.push(
      `BRAND WARNING: game/canvas app is missing ${workspaceRoot}/public/og.jpg.`,
    );
  } else if (cardRequired) {
    warnings.push(`BRAND WARNING: ${workspaceRoot}/public/og.jpg is missing.`);
  }

  if (hasCanvas && !siteDeclaresOgTypeGame(site)) {
    warnings.push(
      `BRAND WARNING: game/canvas app should set "type": "x:game" in ${sitePath}.`,
    );
  }

  if (hasCanvas && cardPath !== undefined) {
    const bannerPath = join(workspaceRoot, "public/x-banner.jpg");
    if (!existsSync(bannerPath)) {
      warnings.push(`BRAND WARNING: missing ${bannerPath} (1200×264 feed card).`);
    } else if (statSync(bannerPath).size > MAX_CARD_BYTES) {
      warnings.push(`BRAND WARNING: ${bannerPath} is over 600 KB.`);
    }
  }

  return warnings;
}

export function parseBrandCheckArgs(argv) {
  const usage =
    "usage: node scripts/brand-check.mjs [--game] [--placeholder-ok] [--root <dir>]";
  let game = false;
  let placeholderOk = false;
  let root = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--game") {
      game = true;
      continue;
    }
    if (argv[i] === "--placeholder-ok") {
      placeholderOk = true;
      continue;
    }
    if (argv[i] === "--root") {
      const value = argv[++i];
      if (!value) return { error: "--root needs a directory" };
      root = value;
      continue;
    }
    return { error: `unexpected argument: ${argv[i]}` };
  }
  return { game, placeholderOk, root };
}

export function brandCheckMain(argv, { cwd = process.cwd(), log = console.log } = {}) {
  const parsed = parseBrandCheckArgs(argv);
  if (parsed.error) {
    log(parsed.error);
    return 2;
  }
  const workspaceRoot = parsed.root ? parsed.root : cwd;
  const warnings = brandWarningsOnDisk({
    hasCanvas: parsed.game,
    workspaceRoot,
    cardRequired: !parsed.placeholderOk,
  });
  for (const warning of warnings) log(warning);
  return warnings.some((w) => w.startsWith("BRAND WARNING")) ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = brandCheckMain(process.argv.slice(2));
}
