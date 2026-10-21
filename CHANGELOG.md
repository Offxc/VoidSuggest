# Changelog

The version is in `package.json` and shown in the site footer. Bump it with every release: a patch
for a fix, a minor for a feature or visible change. A change to the database schema ships with a
migration and is called out here.

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
