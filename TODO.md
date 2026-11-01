# TODO

## Review and merge gates

- [x] Add the codex-review set (`codex-review.yml`,
      `codex-review-listener.yml`, `codex-review-check.yml`), copied
      byte for byte from mikelward/codex-review `templates/`.
- [ ] Repository settings (not expressible in files; see
      mikelward/codex-review `docs/CONSUMER.md`): a ruleset on `main`
      requiring the `codex` status, the
      `codex-review-check / codex-review-check` check (appears in the
      required-checks search only after its first run), conversation
      resolution and up-to-date branches (`CONSUMER.md` says the three
      are load-bearing together); enable the auto-merge setting.
- [ ] A CI gate once there is code to check (lands with the monorepo
      scaffold).
