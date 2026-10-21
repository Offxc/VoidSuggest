<h1 align="center">VoidSuggest</h1>

<p align="center">
  <strong>A self-hosted feature and update request board for a community, with Discord sign-in, owner approval, and limited vote slots so players have to choose what they want most.</strong>
</p>

<p align="center">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black.svg">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-336791.svg">
  <img alt="Self-hosted" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ED.svg">
  <img alt="License: PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue.svg">
</p>

---

Anyone can read the board without signing in. People with a particular role in your Discord server
can sign in to suggest ideas, vote and comment. You review every suggestion before it goes public,
then move the ones you take on through lists such as Planned, In Progress and Completed.

## How it works

1. A member **submits** a suggestion. It waits in your queue, visible only to them and you.
2. You **approve** it (it joins the board) or **reject** it (with an optional reason the author sees).
3. Members **vote**. Each person has a small number of **vote slots** and one vote per suggestion.
   The board is sorted by votes.
4. You **move** suggestions between statuses. Moving one somewhere voting is closed frees the slots
   of everyone who voted for it, and tells them.

### Why vote slots

If votes are free, people vote for everything, and the ranking tells you nothing. Here, every member
has a limited number of votes on open suggestions (5 by default, set by you). To back a new idea
they either have to take a vote off another one or wait for something to move on. A vote counts
toward a suggestion's total even after its slot is freed, so the history is kept.

There is also an optional minimum number of days in the server before someone can take part (off by
default), and the owner can see who voted, remove a vote, or block someone.

## Features

**For everyone**
- Browse the board, the roadmap and every suggestion without signing in
- Search, filter by tag and type, sort by votes or newest
- Names are the person's **server nickname** from Discord (then display name, then username), kept up to date automatically
- Works on phones; keyboard accessible

**For members**
- Submit, edit (while it waits for approval) and withdraw suggestions
- Vote, with a clear "3 of 5 votes left" counter and a "my votes" page
- Comment, on the suggestions where the owner has switched comments on
- A "similar suggestions" check while typing a title, to cut down on duplicates
- In-site notices for approvals, status changes and returned votes

**For the owner** (the first person to sign in)
- Approval queue with approve, reject (with reason), edit and delete
- **Statuses** you create and rename, each with switches for *voting open*, *close comments when something moves here*, *show on the roadmap* and *default for new approvals*
- **Types** (for example "Feature request" and "Update request") you create, rename, recolour and turn on or off
- **Tags** you create and edit
- **Guidelines** you write, optionally per type, shown beside the form, with an optional "I've read them" confirmation
- **Comments** switched on per suggestion, closing by themselves on any status you choose
- Limits: votes per member, waiting suggestions per person, suggestions per day, tags per suggestion, days in server
- Block people, strike votes, and an append-only **audit log** with CSV export
- Optional Discord channel notifications through a webhook

## Tech stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Database | PostgreSQL 18, Prisma |
| Sign-in | Discord OAuth2 with PKCE, signed session cookies |
| Deploy | Docker Compose |

No Redis, no queue, no search service.

## Install

You need Docker with Compose, a domain name, a reverse proxy that handles HTTPS, and a Discord server you manage.

### 1. Create the Discord application

1. In the [Discord Developer Portal](https://discord.com/developers/applications) create an application.
2. **OAuth2**: copy the *Client ID* and *Client Secret*. Under *Redirects*, add
   `https://your-domain.example/api/auth/callback` (your `SITE_URL` followed by `/api/auth/callback`, exactly).
3. **Bot**: copy the bot token, and switch on **Server Members Intent** (used to keep names and roles up to date).
4. Invite the bot to your server (OAuth2 → URL Generator, scope `bot`, no permissions needed).
5. In Discord, turn on Developer Mode, right-click your server and choose *Copy Server ID*.

The sign-in only asks for the `identify` scope. The bot token is used server-side to read a person's
nickname and roles.

### 2. Configure and start

```bash
git clone https://github.com/Offxc/VoidSuggest.git
cd VoidSuggest
cp .env.example .env     # fill in the values; see the table below
docker compose build
docker compose up -d
```

The first start applies the database migrations, then the site listens on `127.0.0.1:3400`. Point
your reverse proxy at it. The database is never published.

### 3. Become the owner

Open the site and sign in with Discord. **The first account to sign in becomes the owner**, so do
this before you share the address. (To lock this down, set `OWNER_DISCORD_ID` and only that account can claim it.)

Then open **Admin → Settings** and choose which Discord role counts as "Member". Until you do, only you can sign in.

### Reverse proxy

Any proxy that terminates HTTPS works. With [Caddy](https://caddyserver.com/):

```
suggest.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3400
}
```

Caddy sets `X-Forwarded-For` to the visitor's address, which the site uses for rate limiting and
the audit log (`CLIENT_IP_HEADER`, last entry trusted). If another proxy or CDN sits in front, set
`CLIENT_IP_HEADER` to the header it uses, for example `cf-connecting-ip`. Don't expose the site's
port to the internet directly, or those headers can be forged.

### Updating

```bash
git pull
docker compose build
docker compose up -d
```

Migrations run automatically before the new version starts.

### Backups

```bash
docker compose exec db pg_dump -U voidsuggest voidsuggest > backup-$(date +%F).sql
```

Run **one** copy of the site. Rate limits and the member refresh job live in the process's memory.

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Compose | Password for the bundled database |
| `SESSION_SECRET` | yes | 32+ random characters (`openssl rand -base64 48`). Rotating it signs everyone out and clears the stored webhook |
| `SITE_URL` | yes | Public address. `https` in production |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | yes | OAuth application |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` | yes | Reads nicknames and roles in your server |
| `OWNER_DISCORD_ID` | no | Only this account can claim ownership |
| `CLIENT_IP_HEADER` | no | Header holding the visitor's address. Default `x-forwarded-for` |
| `CONTACT_EMAIL` | no | Shown on the privacy page |
| `MEMBER_SYNC_MINUTES` | no | How often names and roles refresh from Discord. Default 15, `0` is off |
| `WEB_PORT` | no | Host port on loopback. Default 3400 |

Everything else (site name, accent colour, limits, statuses, types, tags, guidelines, webhook) is set
in **Admin → Settings**.

## Local development

You need Node 20+ and pnpm. PostgreSQL runs as a child process, so no Docker or system install is needed.

```bash
pnpm install
cp .env.example .env       # set SESSION_SECRET, SITE_URL=http://localhost:3000 and the Discord values
pnpm dev:db                # leave running in its own terminal; prints the DATABASE_URL to use
# put that DATABASE_URL in .env, then:
pnpm db:deploy
pnpm dev
```

PostgreSQL refuses to run as root, so run `pnpm dev:db` as a normal user.
For sign-in to work locally, add `http://localhost:3000/api/auth/callback` as a redirect in your Discord application.

### Checks

```bash
pnpm typecheck
pnpm lint
pnpm test        # needs no setup: it starts a throwaway PostgreSQL
pnpm build
```

Set `TEST_DATABASE_URL` to use a Postgres you already have (CI does). Use an empty database whose
name contains "test": every test empties the tables first, and the suite refuses to run otherwise.

The tests include a route-by-route access check (every API route must declare who may call it, and
that is enforced), the vote-slot limit under concurrent requests, the privacy of unapproved
suggestions, and the sign-in flow against a stand-in for Discord.

Schema changes need a migration (`pnpm db:migrate`) committed with the code. Keep the hand-written SQL
at the bottom of the first migration (single owner, single default status, append-only audit log) if
you regenerate it.

## Project layout

```
prisma/               Schema and migrations
src/app/              Pages and API routes
src/components/       Interface components
src/server/           Everything that runs on the server: auth, voting, rules, Discord
src/shared/           Limits, validation and types shared with the browser
tests/                Integration and unit tests
```

## Security

See [SECURITY.md](SECURITY.md) for how the project approaches the OWASP Top 10, what it does not
protect against, and how to report a problem. Please use a private security advisory on this
repository rather than a public issue.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). You can use, modify and share VoidSuggest for any
noncommercial purpose, including running it for your own community. You can't sell it or use it to
make money. See the licence for the full terms.
