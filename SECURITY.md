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
  it: `public`, `member`, `owner`, or (for the one endpoint Discord itself calls) `discord`, which
  requires a valid Discord signature instead of a session. The check runs before the handler. A test walks every route file
  and fails if one lacks a declaration, if anything under `/api/admin` is not owner-only, if the set
  of public routes changes, if any route other than the Discord endpoint skips sessions, or if a signed-out visitor, an ordinary member, a person without the
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
  what is wrong. In production `SITE_URL` must be https (plain http is accepted only for localhost).
- Docker: the site binds to loopback only, the database has no published port, the runtime image
  runs as an unprivileged user and contains only what is needed to serve.
- Fonts are served from the site itself. There are no third-party scripts, analytics or trackers.

### A03 Software supply chain failures

- The lockfile is committed and installs use `--frozen-lockfile`. Dependabot watches npm, Docker and
  GitHub Actions.
- CI runs `pnpm audit --prod` (fails on high or critical) and builds the Docker images. CodeQL with
  the security-extended queries runs as well, on public repositories (on a private one it needs
  GitHub Advanced Security, and is skipped).
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
- Nothing untrusted is deserialised into objects. The only inbound calls from another service are
  Discord's button clicks, and those are accepted only with a valid signature (see below).

### Image uploads

Members can attach up to four pictures to a suggestion. A file is the classic way into a web
application, so the design is built around never trusting one:

- **The uploaded file is never stored or served.** It is read once by an image library, and what is
  kept is a **new WebP the server makes from the pixels** (`src/server/images.ts`). That removes
  everything else a file can carry: script or HTML hidden after a valid image (a "polyglot"; tested),
  location and camera details, colour-profile tricks, extra frames. Everything the owner or other members
  see is that new file.
- **Before that, the upload must clear:** a size limit (8 MB) enforced while the body streams in, so an
  oversized upload is stopped early; the first bytes being PNG, JPEG or WebP (no SVG, no GIF, nothing
  else) *and* the library agreeing with that; a limit on the number of pixels (50 million), checked from
  the header before anything is decoded, so a tiny file that expands to gigabytes is refused (tested with
  both a 144 million and a 1.6 billion pixel file, including a check that the tests fail if the limit is
  removed); and not being animated. The browser's idea of the file's type is only an early filter.
- **Stored in the database**, not on disk: no file paths to traverse or guess, backed up with everything
  else, and deleted with the suggestion. The database itself refuses a picture that isn't a WebP, is over
  2 MB, has silly dimensions, or would be a fifth on a suggestion.
- **Served safely:** always as `image/webp` with `X-Content-Type-Options: nosniff`. A picture on an
  approved suggestion is public; on one that isn't approved yet it is visible to its author and the owner
  only, and anyone else gets the same "not found" as for a made-up address (tested). Those are never cached.
- **Who may add or remove:** the owner at any time; the author only while the suggestion waits for approval,
  like editing its text. Enforced in the domain functions as well as the routes (tested). Uploads are rate
  limited per person, processing runs a couple at a time, and the audit log records each one (not the picture).
- **Deleted on a schedule.** Each status has a "delete images after N days" setting, and "Completed" starts
  at 30. An hourly job removes the pictures of suggestions that have been in such a status that long (the
  clock restarts if a suggestion leaves and returns), notes it on the suggestion's public history and in the
  audit log, and takes the picture out of the Discord post. Tested, including the boundary at 29 and 31 days.
- The content-security policy allows `blob:` images, only so the form can preview a picture a person has
  just chosen, before it is sent.

### The Discord board (optional)

If the owner switches it on, approved suggestions are posted to a Discord channel with a Vote
button, and Discord sends each click to `/api/discord/interactions`.

- **Signature first.** Every request must carry Discord's Ed25519 signature over the timestamp and
  the exact body, checked against the application's public key (`DISCORD_PUBLIC_KEY`) before the body
  is parsed or anything is read from the database. A bad, missing or wrongly keyed signature is a
  401, recorded in the audit log (once a minute per address). Requests whose timestamp is more than
  five minutes from the server's clock are refused, so a captured request can't be replayed. With no
  key configured, everything is refused. Tested, including a mutation check that the tests fail if the
  verifier is weakened.
- **The endpoint has no session and no cross-site check** (Discord's servers send no `Origin`); the
  signature is the only door, and the access-matrix test insists it is the only route that works this way.
- **Who clicked is believed only because the request is signed.** The click names the person and the
  roles they hold in the server. It must be for this application and this server. The person is matched
  to a site account by Discord ID; someone who has never visited the site gets an account on their
  first vote **only if they hold the Member role**, and never as the owner (ownership can only be
  claimed by signing in on the site).
- **Same rules as the site.** Voting runs through the same code as the site, so vote slots (shared
  between Discord and the site), stages where voting is closed, blocked people, the Member role and the
  minimum time in the server all apply identically. A vote takes two clicks, the second on a message
  only the voter can see. A person's own identity is taken from the signed request, never from the
  button, so one person can't vote as another (tested).
- **Limits.** Per Discord account (20 clicks a minute) and per address.
- **Posted text is untrusted.** Posts and replies disable all mentions, neutralise `@` and `<`, escape
  Discord formatting, never include links other than ones the site chose, and stay inside Discord's size
  limits (tested with hostile titles and bodies). Channel and message IDs are validated as Discord IDs,
  and the database refuses anything else.
- **The bot's permissions** needed for this are View Channel, Send Messages and Embed Links, in the
  channel(s) the owner chooses.

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
- **Pictures are the one kind of file the site accepts**, and they are unscanned for content: the site
  makes sure a picture is a picture and nothing else, not that it is appropriate. The owner sees every
  suggestion's pictures before approving it and can remove any of them afterwards.
- A picture that Discord has already fetched for a post may stay in Discord's own image cache for a
  while after the site deletes it. The post stops showing it, but the site can't recall Discord's copy.
- **The Discord board trusts Discord.** Whoever controls the Discord application (its token, or by
  changing its public key and endpoint) controls what that endpoint accepts. Keep the application's
  settings and the bot token private, and only give the developer portal to people you'd trust with
  the server.
- If the server's clock is wrong by more than five minutes, Discord's requests are refused. Keep time
  synchronised (most hosts do this already).
- Container images aren't pinned by digest, and the project isn't signed or attested.

## For people running it

- Put it behind HTTPS and keep the port on loopback. Set `CLIENT_IP_HEADER` to match your proxy.
- Keep `.env` private (`SESSION_SECRET`, the Discord client secret and the bot token are secrets).
  If one leaks, rotate it in the Discord portal and in `.env`.
- Sign in as the owner yourself before announcing the address, or set `OWNER_DISCORD_ID`.
- Keep the Discord bot's permissions minimal: for sign-in it needs none, only to be in the server. If you
  use the Discord board it also needs View Channel, Send Messages and Embed Links, in those channels only.
- Back up the database, and keep Docker, the host and this project up to date.
