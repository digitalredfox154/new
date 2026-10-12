# SAMAI root cutover

Production root promotion is intentionally separate from `/lead-gen-agency/` publication.

## Required approvals for the exact staging SHA

- `SAMAI_LEGAL_APPROVED=<source sha>` — legal pages reviewed and their draft notice removed.
- `SAMAI_DEVICE_QA_APPROVED=<source sha>` — staging checked on at least one physical iPhone/Safari-class device and one physical Android/Chrome-class device.

`production/build_candidate.py` refuses to generate an indexable root artifact without both approvals. It also refuses a landing artifact that is not targeted at `/lead-gen-agency/`.

## Cutover sequence

1. Use the exact landing build that passed GitHub CI and live `/lead-gen-agency/` verification.
2. Build the production candidate; it changes only production metadata/robots and preserves the tested content/assets.
3. Back up any existing root deployment before replacement.
4. Publish the candidate atomically to the root site directory; do not reuse the landing release directory as the production working directory.
5. Verify `/`, `privacy.html`, `consent.html`, form readiness and `app.samaiconsulting.ru` over HTTPS.
6. Verify the exact production manifest hashes.
7. If any smoke check fails, restore the backup before investigating.

The current REG GitOps integration owns `/lead-gen-agency/` only. Root-domain publication requires a separately scoped root deployment target; it must not be added to the automatic landing timer by accident.
