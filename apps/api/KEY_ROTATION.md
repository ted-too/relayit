# Secret rotation (`BETTER_AUTH_SECRETS`)

Relayit uses Better Auth’s versioned secrets for auth **and** for sealing provider credentials / DKIM private keys (`symmetricEncrypt` / `symmetricDecrypt` from `better-auth/crypto`).

Format: `currentVersion:currentSecret[,olderVersion:olderSecret…]` — **first entry is current**.

See: https://better-auth.com/docs/reference/security

## Initial setup

```bash
# openssl rand -base64 32
BETTER_AUTH_SECRETS=1:your-long-random-secret-at-least-32-chars
```

## Rotate

1. Generate a new secret and prepend it as a new version (keep the old version for decrypt):

```bash
NEW=$(openssl rand -base64 32)
# Was: BETTER_AUTH_SECRETS=1:old-secret
# Become:
BETTER_AUTH_SECRETS=2:${NEW},1:old-secret
```

2. Deploy all api / worker / combined processes with the new env value.
3. New ciphertext and auth material use version `2`. Existing `$ba$1$…` rows still decrypt via the retained `1:` entry.
4. After you are sure nothing still needs version `1` (sessions re-issued, no old sealed rows if you re-sealed), drop it:

```bash
BETTER_AUTH_SECRETS=2:${NEW}
```

There is **no** DB-wide re-encrypt job. Rotation is non-destructive while old versions remain in `BETTER_AUTH_SECRETS`.

## Notes

- Builder does not need `BETTER_AUTH_SECRETS`.
- Unsubscribe HMAC uses the **current** (first) secret value.
- Old custom `CREDENTIAL_ENCRYPTION_KEY_*` / `version:iv:data:tag` ciphertext is not supported (clean break).
