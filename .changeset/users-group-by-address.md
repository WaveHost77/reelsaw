---
"@reelsaw/server": minor
---

The Users page now shows which accounts share a sign-up address. Grouped by flag, the shared ip and signup burst sections are split by address, busiest first, each with its own count, paging and "Select all", so you can review or suspend one address's accounts together. "Group by address" groups the whole list the same way, and "Only this address" narrows the page to one. Over MCP, `list_users` takes `groupBy: "ip"` and the `signupIp` and `sharedIp` filters (also in `manage_users`); on the box, `reelsaw users --group ip`, `--ip` and `--shared-ip`.
