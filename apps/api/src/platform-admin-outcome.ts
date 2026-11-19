/**
 * What `platform-admin.js` tells the operator. Apart from the command so the wording that
 * must not overclaim is tested: a change that found no session has not been shown to
 * reach any.
 */
type Action = "grant" | "remove" | "ban" | "unban";

const DONE = {
  ban: "is banned",
  grant: "is a platform admin",
  remove: "is no longer a platform admin",
  unban: "is no longer banned",
} satisfies Record<Action, string>;

/** The lines of a change that was made and confirmed; the last is the outcome. */
export const changedLines = ({
  action,
  email,
  sessions,
  store,
}: {
  readonly action: Action;
  readonly email: string;
  /** Sessions of the user ended (remove, ban) or rewritten (grant, unban). */
  readonly sessions: number;
  /** Where sessions were looked for, and whether it holds any user's at all. */
  readonly store: { readonly empty: boolean; readonly host: string; readonly keyPrefix: string };
}) => {
  const now = DONE[action];
  if (sessions > 0) {
    return [
      action === "grant" || action === "unban"
        ? `${email} ${now}. Open sessions updated: ${sessions}.`
        : `${email} ${now} and is signed out. Open sessions ended: ${sessions}.`,
    ];
  }
  // A ban made with this command ended the user's sessions, so finding none is what lifting
  // one expects, and there is nothing a wrong session store would leave undone.
  if (action === "unban") {
    return [`${email} ${now} and can sign in again.`];
  }
  const searched = `Redis at ${store.host}, key prefix ${store.keyPrefix === "" ? "empty" : `"${store.keyPrefix}"`}`;
  return [
    ...(store.empty
      ? [
          `Warning: ${searched}, holds no session of any user. Unless nobody is signed in to this deployment, it is not the api's session store: check REDIS_URL and REDIS_KEY_PREFIX.`,
        ]
      : []),
    `${email} ${now} in the database. No open sessions of theirs were found (${searched}). If they are signed in, this is not the api's session store and ${action === "ban" ? "the ban has not ended their sessions" : "the role change has not reached their sessions"}.`,
  ];
};

/** The row is written and the user's sessions were not shown to follow. */
export const unconfirmedLine = (action: Action, what: string) => {
  switch (action) {
    case "grant":
      return `The role is granted in the database, but ${what}. Their open sessions may not have it until this is run again.`;
    case "remove":
      return `The role is removed in the database, but ${what}. Their open sessions may still have platform admin access until this is run again.`;
    case "ban":
      return `The user is banned in the database, but ${what}. Their open sessions may still be signed in until this is run again.`;
    case "unban":
      return `The ban is lifted in the database, but ${what}. A session of theirs may still be refused until this is run again.`;
  }
};
