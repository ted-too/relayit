/**
 * What `platform-admin.js` tells the operator. Apart from the command so the wording that
 * must not overclaim is tested: a role change that found no session has not been shown to
 * reach any.
 */
type Action = "grant" | "remove";

/** The lines of a change that was made and confirmed; the last is the outcome. */
export const changedLines = ({
  action,
  email,
  sessions,
  store,
}: {
  readonly action: Action;
  readonly email: string;
  /** Sessions of the user rewritten (grant) or ended (remove). */
  readonly sessions: number;
  /** Where sessions were looked for, and whether it holds any user's at all. */
  readonly store: { readonly empty: boolean; readonly host: string; readonly keyPrefix: string };
}) => {
  const now = action === "grant" ? "is a platform admin" : "is no longer a platform admin";
  if (sessions > 0) {
    return [
      action === "grant"
        ? `${email} ${now}. Open sessions updated: ${sessions}.`
        : `${email} ${now} and is signed out. Open sessions ended: ${sessions}.`,
    ];
  }
  const searched = `Redis at ${store.host}, key prefix ${store.keyPrefix === "" ? "empty" : `"${store.keyPrefix}"`}`;
  return [
    ...(store.empty
      ? [
          `Warning: ${searched}, holds no session of any user. Unless nobody is signed in to this deployment, it is not the api's session store: check REDIS_URL and REDIS_KEY_PREFIX.`,
        ]
      : []),
    `${email} ${now} in the database. No open sessions of theirs were found (${searched}). If they are signed in, this is not the api's session store and the role change has not reached their sessions.`,
  ];
};

/** The row is written and the user's sessions were not shown to follow. */
export const unconfirmedLine = (action: Action, what: string) =>
  action === "grant"
    ? `The role is granted in the database, but ${what}. Their open sessions may not have it until this is run again.`
    : `The role is removed in the database, but ${what}. Their open sessions may still have platform admin access until this is run again.`;
