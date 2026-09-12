/**
 * Upstream identity providers this app can offer for sign-in (via an OIDC broker).
 * Auth is OFF for Peepland by default (`app-env.json` → VITE_AUTH_ENABLED=false).
 */
export type AuthBrokerProvider = {
  /** Local provider id; also the OAuth callback path segment. */
  providerId: string;
  /** Upstream hint the broker forwards to (Better Auth social id). */
  idp: string;
  /** Human label for the sign-in button. */
  label: string;
};

export const AUTH_PROVIDERS: readonly AuthBrokerProvider[] = [
  { providerId: "oauth-google", idp: "google", label: "Google" },
  { providerId: "oauth-x", idp: "twitter", label: "X" },
];
