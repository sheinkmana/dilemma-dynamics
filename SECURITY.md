# Security

Game Field is a personal local app. It binds to `127.0.0.1`, checks Host and
Origin, and requires a local token for mutations. It has no multi-user
authentication. Publishing this repository does not deploy the app. Public
proxy hosting requires a separate security design.

Keep API keys in an ignored `.env` file. Never place them in browser code,
screenshots, exported replays, issues or commits. `data/`, `output/` and local
operational evidence are ignored. Replays contain prompts and responses; review
them before sharing. Missing request usage can leave a conservative reservation;
local dollar limits are not provider-enforced invoice caps.

Report a suspected vulnerability privately through the repository's security
advisory feature if enabled. Do not post credentials or exploit details in a
public issue. If a key is exposed, revoke it with the provider before rewriting
repository history.

Run `npm run verify:public` before a publication commit. It checks tracked and
unignored candidate files and HEAD/branch/tag history for selected private-data
patterns and accidental evidence/reference inclusion. This supplements manual
review; it is not a comprehensive secret scanner.
