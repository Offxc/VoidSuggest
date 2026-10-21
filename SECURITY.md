# Security

## Reporting a problem

Please report vulnerabilities through a **private security advisory** on this repository (Security →
Report a vulnerability), not a public issue. Include what you found, how to reproduce it, and the
version (shown in the footer). Fixes go out as a new release with a note in the [changelog](CHANGELOG.md).

## Approach

The design was checked against the [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/)
and the [OWASP API Security Top 10 (2023)](https://api-security.owasp.org/), and the
[ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/) Level 2
requirements were used as a checklist. **That is not an audit or a certification.** Nothing here has
been independently reviewed, and ASVS conformance has not been formally verified.

What follows says what is done and where to look. Claims that a test covers something refer to the
tests in `tests/`.

### A01 Broken access control (includes SSRF)

- Every API route is built with `defineApi` (`src/server/http.ts`) and **must declare** who may call
  it: `public`, `member` or `owner`. The check runs before the handler. A test walks every route file
  and fails if one lacks a declaration, if anything under `/api/admin` is not owner-only, if the set
  of public routes changes, or if a signed-out visitor, an ordinary member, a person without the
  Member role, or a blocked person can reach a route they shouldn't.
- Domain functions re-check permission themselves (owner-only functions assert the owner; member
  functions check the Member role, block state and limits), so a route can't be the only barrier.
- Unapproved suggestions are filtered in one place (`src/server/queries.ts`). To everyone but the
  author and the owner they behave exactly like a page that doesn't exist.
- Ids in URLs are checked against the exact format of the ids we generate before any query runs.
  Public ids are random, not sequential.
- Data sent to the browser is built from explicit shapes (`src/server/dto.ts`). Discord IDs, roles,
  block state and who voted never appear in public pages (tested).
- **CSRF:** every request that changes data must carry an `Origin` equal to the site's address and
  must not be marked cross-site by `Sec-Fetch-Site`; bodies must be JSON; session cookies are
  `SameSite=Lax`. Tested for every state-changing route.
- **SSRF:** the server only calls Discord, at a fixed address. The one URL an owner can enter, the
  webhook, must be a genuine Discord webhook address (https, Discord host, exact path shape, no
  credentials, port or redirects); everything else is refused. Outbound requests never follow
  redirects and have timeouts.

### A02 Security misconfiguration

- A per-request **Content-Security-Policy** with a nonce: scripts and styles run only if they carry
  it. No `unsafe-inline` or `unsafe-eval` in production; no framing; no plugins. Checked in a real
  browser with no violations.
- `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`,
  and HSTS when the site is on https. The framework version is not advertised.
- Cookies are `HttpOnly`, `SameSite=Lax`, and on https `Secure` with the `__Host-` prefix.
- Configuration is validated when the server starts and fails with the names (never the values) of
  what is wrong. In production `SITE_URL` must be https.
- Docker: the site binds to loopback only, the database has no published port, the runtime image
  runs as an unprivileged user and contains only what is needed to serve.
- Fonts are served from the site itself. There are no third-party scripts, analytics or trackers.

### A03 Software supply chain failures

- The lockfile is committed and installs use `--frozen-lockfile`. Dependabot watches npm, Docker and
  GitHub Actions.
- CI runs `pnpm audit --prod` (fails on high or critical), CodeQL with the security-extended
  queries, and builds the Docker images.
- GitHub Actions are pinned to full commit SHAs, workflows request read-only permissions, and
  checkouts don't keep credentials.
- Container base images are pinned by tag (`node:22-alpine`, `postgres:18-alpine`), **not** by digest.
- Install scripts are blocked except for an explicit short list (`pnpm-workspace.yaml`).

### A04 Cryptographic failures

- Sessions are signed (HS256) with a key derived from `SESSION_SECRET`. Separate keys are derived for
  each purpose (sessions, the sign-in step, the stored webhook), so one can't be replayed as another.
- The stored webhook URL is encrypted at rest (AES-256-GCM).
- Discord access tokens are used once during sign-in and never stored. There are no passwords.
- Transport security is expected from your reverse proxy; the app enforces https in production
  configuration, sets Secure cookies and HSTS.

### A05 Injection

- All database access goes through Prisma, or tagged raw SQL where every value is a bound
  parameter. The one text-search query builds its operators from letters and digits only.
- Input is validated with strict schemas (length, format, palette-only colours) and cleaned of
  control, zero-width and bidirectional-override characters.
- User markdown is rendered through an allow-list: no raw HTML, no images, only `http(s)` and
  `mailto` links, which open with `rel="nofollow ugc noopener"`.
- Colours come from a fixed palette by name, never as free text, so there is no CSS injection.
- CSV exports neutralise spreadsheet formulas. Log entries are stripped of line breaks.
- Webhook messages disable mentions and never include user text as a clickable link.

### A06 Insecure design

- The abuse cases that matter here were designed against rather than patched: vote stuffing, voting
  for everything, spam, brigading by new accounts, impersonation through nicknames, and a
  stale permission after someone loses their role.
- **Vote slots** limit how many open suggestions one person can vote for. The limit is enforced inside
  a transaction that locks the voter, so simultaneous requests cannot slip past it (tested, and the
  test was confirmed to fail without the lock).
- Rules that must always hold are enforced by the **database**, not only the application: one owner,
  one default status, an approved suggestion always has a status, counts can't go negative, one row
  of settings, one vote per person per suggestion, and an append-only audit log.
- The owner is shown with a badge next to their name so a nickname can't pass for them.

### A07 Authentication failures

- Discord OAuth with a random `state`, **PKCE**, an exact redirect URI, and the post-sign-in
  destination restricted to same-site paths (no open redirect). All tested.
- Whether someone may sign in is decided on the server from their Member role at that moment.
  Refused sign-ins create no account and no session.
- The first-owner claim is atomic (a database index), so simultaneous first sign-ins produce exactly
  one owner (tested). `OWNER_DISCORD_ID` can restrict who may claim it.
- Sessions last 14 days. Blocking someone, or signing out, **ends every session for that account at
  once**, because sessions are checked against a version number in the database.
- Roles are re-checked against Discord before any write if the stored copy is older than five minutes.
  If Discord can't be reached, writes are refused (fail closed) while reading keeps working.
- Sign-in routes are rate limited.

### A08 Software or data integrity failures

- Database changes only arrive through reviewed migrations, applied by a separate one-off container
  before the new version starts. The app never changes its own schema.
- Nothing untrusted is deserialised into objects, and the app accepts no inbound webhooks.

### A09 Security logging and alerting failures

- An **append-only audit log** (enforced by a database trigger) records sign-ins and refusals,
  sign-outs, ownership claims, denied access by signed-in people, rate-limit hits, and every
  moderation and settings change, with time, actor, target, address and browser.
- Entries never contain secrets (sensitive keys are redacted), are bounded in size, and have control
  characters stripped. The log can be exported as CSV.
- **There is no automated alerting on security events.** The optional Discord notifications are about
  new suggestions and status changes, not about attacks. Look at the log.

### A10 Mishandling of exceptional conditions

- Errors shown to people carry a short message and a code, never a stack trace or query text.
- If Discord is slow or down: sign-in and writes fail cleanly with a clear message, reads continue,
  and Discord's rate limits are honoured with a bounded wait. The member sweep never marks anyone as
  having left unless the whole member list was read.
- Multi-step changes (moving a suggestion, closing comments, notifying voters, freeing votes) happen
  in one transaction, all or nothing.

### API6:2023 Unrestricted access to sensitive business flows

Voting and submitting are the flows that could be abused. Besides the vote slots above: per-person
limits on waiting suggestions and suggestions per day, per-person and per-address rate limits, an
optional minimum time in the server, votes withdrawn when someone leaves or loses the role, and
owner tools to see who voted, strike a vote, and block someone.

## What this does not protect against

- **One person with several Discord accounts that all hold the Member role** can still cast several
  sets of votes. The role requirement, minimum time in the server and owner tools make it costly and
  visible, not impossible.
- **Rate limits and the member refresh job live in the process's memory.** Run one instance. A
  restart resets the counters.
- **The audit log's protection is a database trigger.** Someone who owns the database can remove it.
  Give the app's database user only the rights it needs, and keep backups.
- A stolen session cookie works until the account signs out, is blocked, or the cookie expires.
- There is no CAPTCHA or bot detection. Everyone who can write has already passed Discord and the
  Member role.
- Suggestions are text only, by design, to avoid file uploads.
- Container images aren't pinned by digest, and the project isn't signed or attested.

## For people running it

- Put it behind HTTPS and keep the port on loopback. Set `CLIENT_IP_HEADER` to match your proxy.
- Keep `.env` private (`SESSION_SECRET`, the Discord client secret and the bot token are secrets).
  If one leaks, rotate it in the Discord portal and in `.env`.
- Sign in as the owner yourself before announcing the address, or set `OWNER_DISCORD_ID`.
- Keep the Discord bot's permissions minimal: it needs no permissions, only to be in the server.
- Back up the database, and keep Docker, the host and this project up to date.
