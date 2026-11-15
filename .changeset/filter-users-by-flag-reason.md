---
"@reelsaw/server": minor
---

Admins can filter the Users page by why an account was flagged: shared sign-up address, sign-up burst or temporary email domain. The new Flag filter shows how many accounts each reason covers, a flag chip on a row lists everyone flagged for that reason, and the choice stays in the link. Bulk actions on "every match" follow it, and the same filter is `flag` in `list_users` / `manage_users` and `--flag` in `reelsaw users` / `users-bulk`.
