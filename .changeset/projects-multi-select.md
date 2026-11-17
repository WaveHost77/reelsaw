---
"@reelsaw/server": minor
---

Select several projects on the Projects page and act on them at once: a compact bar retries the failed ones, re-renders their clips or deletes them (restorable, with Undo), each after a confirmation. New MCP tools `delete_projects`, `retry_projects` and `rerender_projects`, and CLI `reelsaw delete-projects`, `retry-projects` and `rerender-projects`. Group actions now show that they are running everywhere: confirm dialogs keep a spinner until the work is done (and show a failure in place), selection bars show a spinner while their action runs, and actions started from a menu or ⌘K show a loading toast that turns into the result.
