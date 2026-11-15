---
"@reelsaw/server": patch
---

Self-hosted instances that transcribe with a local OpenAI-compatible speech server through `OPENAI_BASE_URL` (Speaches in the local-ai setup) boot again. The word-timestamp check read the server's phrase-level segments instead of the per-word times it returns alongside them, judged the model unusable and stopped startup. A result stored by the old check is tested again at the next boot.
