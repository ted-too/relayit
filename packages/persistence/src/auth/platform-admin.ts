import type { Auth } from "./server";

/**
 * Grants or removes the platform admin role, the one way it is changed outside
 * better-auth's own `/auth/admin/set-role` (which needs an admin to call it, so cannot make
 * a deployment's first). Both write through better-auth's `updateUser`, which also rewrites
 * the copy of the user that every live session of theirs holds in Redis. That copy is what
 * `/auth/admin/*` authorises on, so an update of the user's row alone leaves a removed
 * admin with those endpoints until their sessions end.
 *
 * Resolves to the user's role after the change, or `null` when no user has that email.
 */
export const setPlatformAdmin = async (
  auth: Auth,
  { admin, email }: { readonly admin: boolean; readonly email: string },
) => {
  const { internalAdapter } = await auth.$context;
  const found = await internalAdapter.findUserByEmail(email);
  if (!found) {
    return null;
  }
  // The two roles better-auth's admin plugin has here; no others are configured.
  const role = admin ? "admin" : "user";
  await internalAdapter.updateUser(found.user.id, { role });
  return role;
};
