# Ops default managed Provider (no per-Project sticky baseline)

~~Superseded sticky baseline.~~

When Domain create omits `providerId`, Relayit uses the **current** ops-marked default platform email Provider (fallback: oldest platform email Provider). There is **no** per-Project stored baseline — changing the ops default affects the next omit-path Domain create, not existing Domain↔Provider pairings. Sandbox send continues to use Sandbox Domain provider identities.

Rejected: persisting `organization.managedEmailProviderId` as a sticky Project binding (unnecessary state; omit should mean “use whatever ops says is default now”).
