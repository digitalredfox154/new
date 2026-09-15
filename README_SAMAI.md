# SAMAI landing — isolated test deployment

Source branch: `samai-landing`. This branch is deliberately separate from the repository's original main branch and from hmn-platform. No application deployment is triggered.

`site/` contains the complete versioned HTML, CSS, JavaScript and the original deduplicated logo. `tools/import_source.py` was a one-time verified import; normal builds never fetch source from the live site.

Pushes run: JS syntax -> immutable build -> Chromium/Firefox browser gate -> tested release branch `samai-landing-releases`. Artifacts contain checks, screenshots and browser traces. Failed checks block publication.

REG uses a narrowly scoped pull agent: HTTPS read-only GitHub access, exact workflow/SHA verification, static-file allowlist, SHA-256 validation, immutable assets and atomic index replacement, plus rollback on public verification failure. No SSH key, root access, application source or customer data is needed.

Only `/test/` is authorized. The form is deliberately a demo and never submits user input. Search indexing stays disabled. Production promotion to `/` requires separate approval.

Local checks: Python 3.12+, Node 22, `pip install -r requirements-ci.txt`, `python -m playwright install --with-deps chromium firefox`, `python tools/build.py`, `python tools/browser_gate.py`.

Operational caveat: the scoped Remote Desktop container has no service manager or crontab. The pull agent can run continuously there, but automatic restart after container/host reboot requires the host administrator to add a supervised service. Do not claim reboot resilience before that is configured.
