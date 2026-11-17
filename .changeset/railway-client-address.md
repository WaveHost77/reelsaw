---
"@reelsaw/server": patch
---

On Railway, the server now warns at boot when `TRUSTED_PROXY_HEADER` is left on `x-forwarded-for`. Railway's edge puts the visitor's address in `X-Real-IP`, so read from `X-Forwarded-For` every sign-up shares one address, which floods the `shared_ip` abuse flag and makes the per-address sign-up cap meaningless. The configuration docs and README now say to set `TRUSTED_PROXY_HEADER=x-real-ip` there.
