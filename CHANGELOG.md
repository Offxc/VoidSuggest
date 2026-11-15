# Changelog

The version is in `package.json` and shown in the site footer. Bump it with every release: a patch
for a fix, a minor for a feature or visible change. A change to the database schema ships with a
migration and is called out here.

## 0.2.0

Adds the Discord board. **The database schema changes** (a new migration, applied automatically
before the site starts).

- Post approved suggestions to a Discord channel, each showing its stage and vote count with a Vote
  button. Posts follow the site: votes, moves between stages, renames and deletions are reflected
  automatically
- Vote from Discord: the button shows how many votes you have left and asks you to confirm; if you
  have none left it says so. Votes are the same votes as on the site and use the same slots, and a
  member who has never visited the site gets an account on their first vote
- Voting is locked in exactly the stages where the site locks it: the button becomes a disabled
  "Voting closed"
- The channel only gets a new message for a new suggestion; everything else edits the post. Every post
  has a "Suggest an idea" button (ideas can only be submitted on the site), and the settings page offers
  a line for the channel topic
- Optional self-updating overview of the stages in its own channel
- Admin page to connect it, choose channels (checked with Discord) and post everything already approved
- New optional setting `DISCORD_PUBLIC_KEY`, and a new signed endpoint, `/api/discord/interactions`
- Plainer wording on the board and a clearer vote-limit note; the VoidSuggest logo and icons

## 0.1.0

First release.

- Public board, roadmap and suggestion pages that anyone can read without signing in
- Discord sign-in with PKCE; the first account to sign in becomes the owner; members are the people
  holding a Discord role the owner chooses
- Suggestions go to an approval queue first; the owner approves or rejects (with a reason)
- One vote per person per suggestion, with limited vote slots per member that come back when a
  suggestion moves to a status where voting is closed
- Owner-defined statuses (voting open, close comments, roadmap column, default), types, tags and
  guidelines, all editable in settings
- Comments switched on per suggestion, closing automatically on statuses the owner picks
- Server nicknames shown everywhere, refreshed from Discord
- In-site notices, optional Discord webhook notifications, owner tools to block people and strike votes
- Append-only audit log with CSV export
- Docker Compose deployment; strict Content-Security-Policy; route-by-route access tests
