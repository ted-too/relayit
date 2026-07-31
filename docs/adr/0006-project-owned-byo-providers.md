# Project-owned BYO Providers

BYO Providers are **Project-owned**, same tenancy as Domains: credentials do not span Projects, and Project delete removes them. Admin-wired managed backends stay platform-scoped ops infrastructure (not a product noun); Projects **use** them via Domain↔Provider pairings (omit Provider on Domain create → current ops default managed backend).

Rejected: User-owned BYO reused across Projects (old schema). That blurred the Project boundary and forced awkward sharing/claim rules when Domains moved.
