import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { BootLoader } from "@/components/peep/boot-loader";
import { KeyboardBindsPanel } from "@/components/peep/keyboard-binds-panel";
import { LanguageSwitch } from "@/components/peep/language-switch";
import { IconClose, IconGear, IconHammer, IconPhone, IconPlay, IconSend, IconTrash, IconUser } from "@/components/peep/peep-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  claimLinkChallenge,
  createLinkChallenge,
  getAccountStatus,
  loadUserSettings,
  mergeLegacyPlayer,
  pollLinkChallenge,
  saveUserSettings,
} from "@/lib/peep/account.functions";
import { ISLAND_SLUG_RE, MAX_WORLDS_PER_ACCOUNT } from "@/lib/peep/constants";
import { type Keybinds } from "@/lib/peep/keybinds";
import { loadWorldFromServer } from "@/lib/peep/lazy-save";
import {
  adoptPlayerId,
  getLegacyBrowserPlayerId,
  getPlayerId,
  getTelegramSaveId,
  parseJoinCode,
} from "@/lib/peep/player-id";
import {
  countOwnedWorlds,
  consumeHomeMenuPrefer,
  consumeInviteAutoJoin,
  dismissInstallNudge,
  forgetWorld,
  listSavedWorlds,
  rememberWorld,
  setSavedWorldRole,
  shouldShowInstallNudge,
  updateSavedWorldMeta,
  worldLabel,
  type SavedWorld,
} from "@/lib/peep/remember-world";
import { useInstallPrompt } from "@/lib/peep/install";
import { usePhoneUi, writeOrient, lockOrient, unlockOrient } from "@/lib/peep/settings";
import {
  initTelegramWebApp,
  getTelegramStartParam,
  parseInviteHostId,
  parseInviteWorldId,
  fridayAccountLinkUrl,
} from "@/lib/peep/telegram";
import { stashTelegramInventory } from "@/lib/peep/tg-boot-cache";
import {
  applyLocalUserSettings,
  readLocalUserSettings,
} from "@/lib/peep/user-settings";
import {
  createWorld,
  deleteWorld,
  listOwnedWorlds,
  resolveWorldId,
  updateWorldMeta,
} from "@/lib/peep/world.functions";
import { useTranslation } from "@/lib/i18n/react";
import type { TranslationKey } from "@/lib/i18n/ru";

export const Route = createFileRoute("/")({ component: Home });

const THUMBS = [
  "linear-gradient(145deg, #6b8f71 0%, #2a4038 42%, #c47a3a 78%, #1a1520 100%)",
  "linear-gradient(145deg, #c4a574 0%, #8a6a40 40%, #3a2a18 100%)",
  "linear-gradient(145deg, #2a3550 0%, #1a2038 45%, #0e1428 100%)",
  "linear-gradient(145deg, #4a7a8a 0%, #2a4a58 50%, #1a2830 100%)",
  "linear-gradient(145deg, #7a5a8a 0%, #3a2a48 48%, #181020 100%)",
] as const;

function worldThumb(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 3)) % THUMBS.length;
  return THUMBS[h]!;
}

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

function monthKey(m: number): TranslationKey {
  return `common.month.${m}` as TranslationKey;
}

function formatCreated(at: number, t: TranslateFn): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  return t("common.createdAt", {
    day: d.getDate(),
    month: t(monthKey(d.getMonth())),
    year: d.getFullYear(),
  });
}

function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [join, setJoin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<SavedWorld[]>([]);
  const [nudge, setNudge] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileHint, setProfileHint] = useState<string | null>(null);
  const [draftKeybinds, setDraftKeybinds] = useState<Keybinds>(() => readLocalUserSettings().keybinds);
  const [settingsHint, setSettingsHint] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [accountLinked, setAccountLinked] = useState(false);
  const [tgPlayerId, setTgPlayerId] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editWorld, setEditWorld] = useState<SavedWorld | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [tgBoot, setTgBoot] = useState(false);
  const [menuBootProgress, setMenuBootProgress] = useState(0.08);
  const phone = usePhoneUi();
  const install = useInstallPrompt();
  const ownedCount = worlds.filter((w) => w.role === "mine").length;
  const atWorldCap = ownedCount >= MAX_WORLDS_PER_ACCOUNT;
  const sortedWorlds = [...worlds].sort((a, b) => b.at - a.at);
  const megaWorldId = sortedWorlds.find((w) => w.role === "mine")?.id ?? null;
  const emptyWorlds = worlds.length === 0;

  useEffect(() => {
    setWorlds(listSavedWorlds());
    setNudge(shouldShowInstallNudge());
    writeOrient("landscape");
    let cancelled = false;
    void (async () => {
      try {
        let pid = getPlayerId();
        const legacy = getLegacyBrowserPlayerId();
        if (pid.startsWith("tg_") && legacy) {
          await mergeLegacyPlayer({
            data: { tgPlayerId: pid, browserPlayerId: legacy },
          }).catch(() => null);
          adoptPlayerId(pid);
        }
        pid = getPlayerId();
        const [owned, status, remote] = await Promise.all([
          listOwnedWorlds({ data: { playerId: pid } }),
          getAccountStatus({ data: { playerId: pid } }).catch(() => null),
          loadUserSettings({ data: { playerId: pid } }).catch(() => null),
        ]);
        if (cancelled) return;
        const ownedIds = new Set(owned.map((w) => w.id));
        for (const w of owned) {
          rememberWorld(w.id, "mine", { name: w.name, slug: w.slug });
        }
        // Demote local "mine" ghosts that the server does not recognize as ours.
        for (const local of listSavedWorlds()) {
          if (local.role === "mine" && !ownedIds.has(local.id)) {
            setSavedWorldRole(local.id, "visited");
          }
        }
        setWorlds(listSavedWorlds());
        if (status) {
          setAccountLinked(status.linked || status.inTelegram);
          setTgPlayerId(status.tgPlayerId);
          if (status.linked && status.tgPlayerId && !pid.startsWith("tg_")) {
            adoptPlayerId(status.tgPlayerId);
          }
        }
        if (remote?.settings) {
          applyLocalUserSettings(remote.settings);
          setDraftKeybinds(remote.settings.keybinds);
        }
      } catch {
        /* offline / first boot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!phone) {
      unlockOrient();
      return;
    }
    void lockOrient("landscape");
    return () => unlockOrient();
  }, [phone]);

  useEffect(() => {
    initTelegramWebApp();
    const tg = getTelegramSaveId();
    if (!tg) return;
    let cancelled = false;
    setTgBoot(true);
    setBusy(true);
    setMenuBootProgress(0.12);
    void (async () => {
      try {
        // Peep → home must win over sticky Telegram start_param invites.
        if (consumeHomeMenuPrefer()) {
          setBusy(false);
          setTgBoot(false);
          return;
        }

        setMenuBootProgress(0.22);
        const startParam = getTelegramStartParam();
        // Browser asked to link this Telegram account (startapp=lnk_<token>).
        if (startParam?.startsWith("lnk_")) {
          const token = startParam.slice(4);
          if (/^[a-zA-Z0-9]{16,48}$/.test(token)) {
            setMenuBootProgress(0.55);
            const claimed = await claimLinkChallenge({
              data: { token, tgPlayerId: tg },
            });
            if (cancelled) return;
            if (claimed.ok) {
              setMenuBootProgress(1);
              setBusy(false);
              setTgBoot(false);
              setProfileOpen(true);
              setProfileHint(t("home.hint.linkSuccessCloseApp"));
              return;
            }
            setError(
              claimed.error === "expired"
                ? t("home.hint.linkExpired")
                : t("home.hint.linkFailed"),
            );
            setBusy(false);
            setTgBoot(false);
            return;
          }
        }
        const inviteWorld = parseInviteWorldId(startParam);
        if (inviteWorld && consumeInviteAutoJoin(`w:${inviteWorld}`)) {
          setMenuBootProgress(0.7);
          await navigate({ to: "/world/$worldId", params: { worldId: inviteWorld } });
          return;
        }
        const inviteHost = parseInviteHostId(startParam);
        if (inviteHost && consumeInviteAutoJoin(`h:${inviteHost}`)) {
          setMenuBootProgress(0.4);
          const snap = await loadWorldFromServer(inviteHost);
          if (cancelled) return;
          if (!snap.ok || snap.empty || !snap.world_id) {
            setError(t("home.error.hostIslandNotSaved"));
            setBusy(false);
            setTgBoot(false);
            return;
          }
          setMenuBootProgress(0.75);
          await navigate({ to: "/world/$worldId", params: { worldId: snap.world_id } });
          return;
        }

        // Cold open / Peep icon: stay on the menu. Prefetch owned worlds + TG save
        // so the list is ready, but never auto-enter an island.
        setMenuBootProgress(0.45);
        const legacy = getLegacyBrowserPlayerId();
        if (legacy) {
          await mergeLegacyPlayer({
            data: { tgPlayerId: tg, browserPlayerId: legacy },
          }).catch(() => null);
          adoptPlayerId(tg);
        }
        const snap = await loadWorldFromServer(tg);
        if (cancelled) return;
        setMenuBootProgress(0.72);
        const owned = await listOwnedWorlds({ data: { playerId: getPlayerId() } });
        if (cancelled) return;
        const ownedIds = new Set(owned.map((w) => w.id));
        for (const w of owned) rememberWorld(w.id, "mine", { name: w.name, slug: w.slug });
        if (snap.ok && !snap.empty && snap.world_id) {
          stashTelegramInventory(snap.world_id, snap.inventory);
          // Only "mine" when server agrees — TG save alone can pin a guest visit.
          rememberWorld(snap.world_id, ownedIds.has(snap.world_id) ? "mine" : "visited");
        }
        for (const local of listSavedWorlds()) {
          if (local.role === "mine" && !ownedIds.has(local.id)) {
            setSavedWorldRole(local.id, "visited");
          }
        }
        setWorlds(listSavedWorlds());
        setMenuBootProgress(1);
        setBusy(false);
        setTgBoot(false);
      } catch {
        if (!cancelled) {
          setError(t("home.error.tgLoadFailed"));
          setBusy(false);
          setTgBoot(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const openCreate = () => {
    if (atWorldCap) {
      setError(t("home.error.worldLimit", { max: MAX_WORLDS_PER_ACCOUNT }));
      return;
    }
    setDraftName("");
    setDraftSlug("");
    setError(null);
    setCreateOpen(true);
  };

  const openSettings = () => {
    setDraftKeybinds(readLocalUserSettings().keybinds);
    setSettingsHint(null);
    setSettingsOpen(true);
    void loadUserSettings({ data: { playerId: getPlayerId() } })
      .then((r) => {
        applyLocalUserSettings(r.settings);
        setDraftKeybinds(r.settings.keybinds);
      })
      .catch(() => {
        /* keep local draft */
      });
  };

  const onSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsHint(null);
    try {
      const payload = { keybinds: draftKeybinds };
      applyLocalUserSettings(payload);
      await saveUserSettings({
        data: { playerId: getPlayerId(), settings: payload },
      });
      setSettingsHint(t("common.saved"));
    } catch {
      setSettingsHint(t("common.saveFailed"));
    } finally {
      setSettingsSaving(false);
      window.setTimeout(() => setSettingsHint(null), 2200);
    }
  };

  const openProfile = () => {
    setProfileHint(null);
    setProfileOpen(true);
    void getAccountStatus({ data: { playerId: getPlayerId() } })
      .then((s) => {
        setAccountLinked(s.linked || s.inTelegram);
        setTgPlayerId(s.tgPlayerId);
      })
      .catch(() => {
        /* ignore */
      });
  };

  const startLinkTelegram = async () => {
    if (linkBusy) return;
    setLinkBusy(true);
    setProfileHint(null);
    try {
      const pid = getPlayerId();
      if (pid.startsWith("tg_")) {
        setAccountLinked(true);
        setTgPlayerId(pid);
        setProfileHint(t("home.hint.alreadyInMiniApp"));
        setLinkBusy(false);
        return;
      }
      const created = await createLinkChallenge({ data: { playerId: pid } });
      if (!created.ok) {
        setProfileHint(
          created.error === "already_linked"
            ? t("home.hint.alreadyLinked")
            : t("home.hint.linkStartFailed"),
        );
        setLinkBusy(false);
        return;
      }
      const url = fridayAccountLinkUrl(created.token);
      setProfileHint(t("home.hint.openTelegramLink"));
      window.open(url, "_blank", "noopener,noreferrer");
      const token = created.token;
      const started = Date.now();
      while (Date.now() - started < 120_000) {
        await new Promise((r) => window.setTimeout(r, 1600));
        const poll = await pollLinkChallenge({ data: { token, playerId: pid } });
        if (poll.status === "linked") {
          adoptPlayerId(poll.tgPlayerId);
          setAccountLinked(true);
          setTgPlayerId(poll.tgPlayerId);
          setProfileHint(t("home.hint.linkSuccess"));
          setWorlds(listSavedWorlds());
          setLinkBusy(false);
          return;
        }
        if (poll.status === "error") {
          setProfileHint(
            poll.error === "expired" ? t("home.hint.linkTimeout") : t("home.hint.linkError"),
          );
          setLinkBusy(false);
          return;
        }
      }
      setProfileHint(t("home.hint.linkTimeout"));
    } catch {
      setProfileHint(t("home.hint.linkFailedGeneric"));
    } finally {
      setLinkBusy(false);
    }
  };

  const onCreate = async () => {
    if (draftSlug.trim() && !ISLAND_SLUG_RE.test(draftSlug.trim().toLowerCase())) {
      setError(t("home.error.slugInvalid"));
      return;
    }
    const pid = getPlayerId();
    if (pid === "p-tgpending" || pid === "p-ssr") {
      setError(t("home.error.telegramLoading"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const world = await createWorld({
        data: {
          playerId: pid,
          name: draftName.trim() || undefined,
          slug: draftSlug.trim() || undefined,
        },
      });
      rememberWorld(world.id, "mine", { name: world.name, slug: world.slug });
      setCreateOpen(false);
      await navigate({ to: "/world/$worldId", params: { worldId: world.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg && msg.length < 160
          ? msg
          : t("home.error.createFailed"),
      );
      setBusy(false);
    }
  };

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = parseJoinCode(join);
    if (!code) {
      setError(t("home.error.joinEmpty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resolved = await resolveWorldId({ data: { code } });
      if ("error" in resolved) {
        setError(t("home.error.worldNotFound"));
        setBusy(false);
        return;
      }
      await navigate({ to: "/world/$worldId", params: { worldId: resolved.id } });
    } catch {
      setError(t("home.error.joinFailed"));
      setBusy(false);
    }
  };

  const hideNudge = () => {
    dismissInstallNudge();
    setNudge(false);
  };

  const onRemove = async (world: SavedWorld) => {
    setRemoving(true);
    setError(null);
    try {
      if (world.role === "mine") {
        const legacy = getLegacyBrowserPlayerId();
        const r = await deleteWorld({
          data: {
            worldId: world.id,
            playerId: getPlayerId(),
            ...(legacy ? { legacyPlayerId: legacy } : {}),
          },
        });
        if (!r.ok) {
          if ("error" in r && r.error === "forbidden") {
            // Ghost card (wrong id / guest pin): drop locally, no server orphan of *ours*.
            forgetWorld(world.id);
            setWorlds(listSavedWorlds());
            setConfirmId(null);
            setRemoving(false);
            return;
          }
          setError(t("home.error.deleteFailed"));
          setRemoving(false);
          return;
        }
      }
      forgetWorld(world.id);
      setWorlds(listSavedWorlds());
      setConfirmId(null);
    } catch {
      setError(t("home.error.deleteFailedRetry"));
    }
    setRemoving(false);
  };

  const openEdit = (w: SavedWorld) => {
    setEditWorld(w);
    setDraftName(w.name ?? "");
    setDraftSlug(w.slug ?? "");
    setError(null);
  };

  const onSaveMeta = async () => {
    if (!editWorld) return;
    if (draftSlug.trim() && !ISLAND_SLUG_RE.test(draftSlug.trim().toLowerCase())) {
      setError(t("home.error.slugInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await updateWorldMeta({
        data: {
          worldId: editWorld.id,
          playerId: getPlayerId(),
          name: draftName.trim() || undefined,
          slug: draftSlug.trim() || undefined,
        },
      });
      if (!r.ok) {
        setError(
          r.error === "slug_taken"
            ? t("home.error.slugTaken")
            : r.error === "slug_invalid"
              ? t("home.error.slugInvalidServer")
              : t("common.saveFailed"),
        );
        setBusy(false);
        return;
      }
      updateSavedWorldMeta(editWorld.id, { name: r.name, slug: r.slug });
      setWorlds(listSavedWorlds());
      setEditWorld(null);
      setBusy(false);
    } catch {
      setError(t("home.error.saveMetaFailed"));
      setBusy(false);
    }
  };

  return (
    <main className="peep-home relative h-dvh max-h-dvh overflow-hidden text-fg">
      <div id="game-wrapper" className="peep-home-stage">
      <div className="peep-home-bg absolute inset-0" aria-hidden />
      {tgBoot ? (
        <BootLoader
          progress={menuBootProgress}
          autoFinish={false}
          onDone={() => {}}
        />
      ) : null}

      <div className="peep-home-layout peep-safe">
        <header className="peep-home-top">
          <div className="peep-home-brand">
            <h1>Peep</h1>
          </div>
          <form onSubmit={(e) => void onJoin(e)} className="peep-home-join">
            <Input
              value={join}
              onChange={(ev) => setJoin(ev.target.value)}
              placeholder={t("home.join.placeholder")}
              aria-label={t("home.join.ariaLabel")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="shadow-none"
            />
            <Button type="submit" className="peep-home-join-btn shadow-none" disabled={busy}>
              {t("home.join.submit")}
            </Button>
            <button
              type="button"
              aria-label={t("home.profile.ariaLabel")}
              className="peep-home-gear"
              onClick={openProfile}
            >
              <IconUser className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("home.settings.ariaLabel")}
              className="peep-home-gear"
              onClick={openSettings}
            >
              <IconGear className="size-4" />
            </button>
          </form>
        </header>

        <div className="peep-home-panel">
          <Button
            size="lg"
            className={
              emptyWorlds
                ? "peep-home-cta peep-home-cta-mega shadow-none"
                : "peep-home-cta shadow-none"
            }
            onClick={openCreate}
            disabled={busy || atWorldCap}
            title={atWorldCap ? t("home.createWorld.maxTitle", { max: MAX_WORLDS_PER_ACCOUNT }) : undefined}
          >
            {busy ? t("home.createWorld.busy") : t("home.createWorld")}
          </Button>

          {sortedWorlds.length > 0 ? (
            <section className="peep-home-worlds">
              <p className="peep-home-worlds-head mb-2">
                {t("home.worlds.title")} <span>›</span>
              </p>
              <div className="peep-home-worlds-rail">
                {sortedWorlds.map((w) => (
                  <div
                    key={w.id}
                    className="peep-world-card"
                    data-active={confirmId === w.id || w.id === megaWorldId ? "true" : "false"}
                    data-mega={w.id === megaWorldId ? "true" : "false"}
                    style={confirmId === w.id ? undefined : { ["--thumb" as string]: worldThumb(w.id) }}
                  >
                    {confirmId === w.id ? (
                      <div className="flex h-full min-h-[5.5rem] flex-col justify-between p-3">
                        <p className="text-sm font-medium leading-snug">
                          {w.role === "mine"
                            ? t("home.world.deleteConfirmOwner", { name: worldLabel(w) })
                            : t("home.world.removeConfirmGuest", { name: worldLabel(w) })}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="flex-1 rounded-full border border-white/20 bg-white/10 shadow-none"
                            disabled={removing}
                            onClick={() => setConfirmId(null)}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            type="button"
                            className="flex-1 rounded-full bg-danger text-primary-fg shadow-none"
                            disabled={removing}
                            onClick={() => void onRemove(w)}
                          >
                            {removing ? "…" : t("home.world.delete")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Link
                          to="/world/$worldId"
                          params={{ worldId: w.id }}
                          className="peep-world-card-link"
                        >
                          <span className="peep-world-thumb" />
                          <span className="peep-world-meta">
                            <span className="peep-world-title">
                              <strong>{worldLabel(w)}</strong>
                              {w.role === "mine" ? <span className="peep-world-badge">{t("home.world.badgeMine")}</span> : null}
                            </span>
                            <span className="peep-world-sub">{formatCreated(w.at, t)}</span>
                            <span className="peep-world-sub">
                              {w.role === "mine" ? t("home.world.roleOwner") : t("home.world.roleGuest")}
                              {w.slug ? ` · ${w.slug}` : ""}
                            </span>
                          </span>
                          <span className="peep-world-play" aria-hidden>
                            <IconPlay className="size-3.5" />
                          </span>
                        </Link>
                        <div className="peep-world-actions">
                          {w.role === "mine" ? (
                            <button
                              type="button"
                              aria-label={t("home.world.settingsAria", { name: worldLabel(w) })}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openEdit(w);
                              }}
                            >
                              <IconGear className="size-3.5" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={t("home.world.deleteAria", { name: worldLabel(w) })}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setConfirmId(w.id);
                            }}
                          >
                            <IconTrash className="size-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <p className="font-mono text-xs text-white/50">{t("home.worlds.empty")}</p>
          )}

          {nudge && !install.installed ? (
            <aside className="flex shrink-0 items-start gap-3 rounded-2xl border border-white/15 bg-white/8 p-3">
              <IconPhone className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold leading-tight">{t("home.install.title")}</p>
                <button
                  type="button"
                  onClick={() => void install.addToHome()}
                  className="mt-2 font-mono text-xs font-bold uppercase tracking-wide underline"
                >
                  {install.canNative ? t("home.install.addNative") : t("home.install.howTo")}
                </button>
              </div>
              <button
                type="button"
                onClick={hideNudge}
                aria-label={t("common.close")}
                className="flex size-10 shrink-0 items-center justify-center"
              >
                <IconClose className="size-4" />
              </button>
            </aside>
          ) : null}

          {error ? <p className="shrink-0 text-sm font-bold text-danger">{error}</p> : null}

          <footer className="peep-home-footer">
            <Link to="/editor" className="peep-home-forge">
              <IconHammer className="size-4" />
              {t("home.forgeLink")}
            </Link>
            <a
              href="https://t.me/peepland"
              target="_blank"
              rel="noopener noreferrer"
              className="peep-home-tg"
            >
              <IconSend className="size-4" />
              Telegram
            </a>
          </footer>
        </div>
      </div>

      {createOpen ? (
        <div className="peep-safe absolute inset-0 z-[300] flex items-center justify-center bg-black/70">
          <div className="peep-sheet">
            <div className="peep-sheet-head">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em]">{t("home.createSheet.title")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                className="flex size-10 items-center justify-center"
                onClick={() => setCreateOpen(false)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="peep-sheet-body">
              <p className="text-sm">{t("home.createSheet.hint")}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wide">{t("home.createSheet.nameLabel")}</span>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    maxLength={48}
                    placeholder={t("home.createSheet.namePlaceholder")}
                    className="mt-1 rounded-xl border border-white/20 shadow-none"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wide">{t("home.createSheet.slugLabel")}</span>
                  <Input
                    value={draftSlug}
                    onChange={(e) => setDraftSlug(e.target.value.toLowerCase())}
                    maxLength={24}
                    placeholder={t("home.createSheet.slugPlaceholder")}
                    autoCapitalize="off"
                    className="mt-1 rounded-xl border border-white/20 font-mono shadow-none"
                  />
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 rounded-full border border-white/20 bg-white/10 shadow-none"
                  disabled={busy}
                  onClick={() => setCreateOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  className="peep-home-cta flex-1 shadow-none"
                  disabled={busy}
                  onClick={() => void onCreate()}
                >
                  {busy ? "…" : t("home.createSheet.submit")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editWorld ? (
        <div className="peep-safe absolute inset-0 z-[300] flex items-center justify-center bg-black/70">
          <div className="peep-sheet">
            <div className="peep-sheet-head">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em]">{t("home.editSheet.title")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                className="flex size-10 items-center justify-center"
                onClick={() => setEditWorld(null)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="peep-sheet-body">
              <p className="font-mono text-xs text-fg/70">{t("home.editSheet.systemId", { id: editWorld.id })}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wide">{t("home.createSheet.nameLabel")}</span>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    maxLength={48}
                    className="mt-1 rounded-xl border border-white/20 shadow-none"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wide">{t("home.createSheet.slugLabel")}</span>
                  <Input
                    value={draftSlug}
                    onChange={(e) => setDraftSlug(e.target.value.toLowerCase())}
                    maxLength={24}
                    autoCapitalize="off"
                    className="mt-1 rounded-xl border border-white/20 font-mono shadow-none"
                  />
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 rounded-full border border-white/20 bg-white/10 shadow-none"
                  disabled={busy}
                  onClick={() => setEditWorld(null)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  className="peep-home-cta flex-1 shadow-none"
                  disabled={busy}
                  onClick={() => void onSaveMeta()}
                >
                  {busy ? "…" : t("common.save")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="peep-safe absolute inset-0 z-[300] flex items-center justify-center bg-black/70"
          onClick={() => setSettingsOpen(false)}
        >
          <div className="peep-sheet peep-sheet-solid" onClick={(e) => e.stopPropagation()}>
            <div className="peep-sheet-head">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em]">{t("home.settingsSheet.title")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                className="flex size-10 items-center justify-center"
                onClick={() => setSettingsOpen(false)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="peep-sheet-body peep-sheet-body-solid space-y-3">
              <LanguageSwitch />
              <p className="text-sm leading-relaxed text-muted">
                {t("home.settingsSheet.landscapeHint")}
              </p>
              {!phone ? (
                <KeyboardBindsPanel
                  compact
                  binds={draftKeybinds}
                  onChange={setDraftKeybinds}
                />
              ) : (
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  {t("home.settingsSheet.phoneKeybindHint")}
                </p>
              )}
            </div>
            <div className="peep-sheet-foot">
              {settingsHint ? (
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted">{settingsHint}</p>
              ) : (
                <span />
              )}
              <Button
                type="button"
                className="peep-home-cta shadow-none"
                disabled={settingsSaving}
                onClick={() => void onSaveSettings()}
              >
                {settingsSaving ? "…" : t("common.saveCapitalized")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {profileOpen ? (
        <div
          className="peep-safe absolute inset-0 z-[300] flex items-center justify-center bg-black/70"
          onClick={() => setProfileOpen(false)}
        >
          <div className="peep-sheet peep-sheet-solid" onClick={(e) => e.stopPropagation()}>
            <div className="peep-sheet-head">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em]">{t("home.profileSheet.title")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                className="flex size-10 items-center justify-center"
                onClick={() => setProfileOpen(false)}
              >
                <IconClose className="size-4" />
              </button>
            </div>
            <div className="peep-sheet-body peep-sheet-body-solid space-y-3">
              <p className="text-sm leading-relaxed text-muted">
                {accountLinked || getTelegramSaveId()
                  ? t("home.profileSheet.linked")
                  : t("home.profileSheet.browserPrompt")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
                {t("home.profileSheet.idLine", { id: tgPlayerId ?? getPlayerId() })}
              </p>
              {profileHint ? (
                <p className="text-sm text-[#7dff8a]">{profileHint}</p>
              ) : null}
              {!accountLinked && !getTelegramSaveId() ? (
                <Button
                  type="button"
                  className="peep-home-cta w-full shadow-none"
                  disabled={linkBusy}
                  onClick={() => void startLinkTelegram()}
                >
                  {linkBusy ? t("home.profileSheet.linkWaiting") : t("home.profileSheet.linkButton")}
                </Button>
              ) : (
                <p className="font-mono text-xs uppercase tracking-wide text-[#7dff8a]">
                  {t("home.profileSheet.accountLinked")}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </main>
  );
}

