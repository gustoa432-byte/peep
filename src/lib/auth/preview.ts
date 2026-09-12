/**
 * Optional local-dev OAuth preview client (server-only — never import from the client).
 * Peepland ships with auth disabled; these are inert defaults, not a live broker.
 */
export const PREVIEW_CLIENT_ID = "peep_preview";
export const PREVIEW_CLIENT_SECRET = "";

/** Default OIDC issuer when AUTH_ISSUER is unset (empty = auth broker not configured). */
export const AUTH_ISSUER_DEFAULT = "";

/** Host patterns allowed for dynamic OAuth base URL in local/preview setups. */
export const PREVIEW_ALLOWED_HOSTS: readonly string[] = [];
