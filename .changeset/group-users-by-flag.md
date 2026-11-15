---
"@reelsaw/server": minor
---

Admins can group the Users page by abuse flag. "Group by flag" splits the filtered list into sections (shared sign-up address, sign-up burst, temporary email domain, then the unflagged, folded), each with its count over every match, its own "Load more" and a header checkbox; "Select all 120" in a section takes every account in it, so a bulk suspend acts on exactly one reason. The other filters still apply, and the grouping stays in the link. The same sections are `groupBy: "flag"` in `list_users` (each with the filter to page it or pass to `manage_users`) and `reelsaw users --group flag`; `--in <section>` takes one section in `users` and `users-bulk`.
