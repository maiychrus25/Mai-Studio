# MaiStudio project delta

- Address the operator as anh; refer to yourself as em.
- Approved design: `docs/specs/2026-11-14-mai-studio.txt`; execute M1–M5 without repeatedly asking to continue.
- This is a standalone development repository. Do not modify MaiHub or the original MuseStudio artifacts.
- No push, release, production deployment, real-data migration or paid provider jobs without explicit authorization.
- Use English code identifiers; Vietnamese and English are supported UI languages.
- Keep credentials in the OS keystore; never expose them to the renderer or logs. Do not store Linux basic_text secrets.
- SQLite is provided by Node 24.15+; do not add a native database dependency without a concrete need.
- Before completion run `make build`, `make test`, `make lint`, `node scripts/check-docs.js`, inspect the diff and perform two desktop/mobile stress rounds. Record provider/OS coverage honestly.
- Update SYSTEM_DOCUMENTATION.md with behavioral changes. The global AGENTS template and file-creation checklist were absent at the configured paths during initialization; these are only project-specific deltas.
