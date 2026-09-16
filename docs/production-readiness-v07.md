# SAMAI production readiness gate

This file defines the requirements for promoting the tested landing from `/test/` to `/`.

Production cutover is allowed only when all conditions below are true:

- exact landing commit passed the three-engine CI gate;
- exact `/test/` deployment passed live HTTPS verification;
- lead endpoint reports `ready: true`;
- one real lead was accepted, stored, deduplicated and delivered by the existing Telegram bot to `head_project@samaiconsulting.ru`;
- root domain remains untouched until explicit cutover;
- legal pages are approved for publication and draft-review notices are removed;
- production build changes `robots` from `noindex,nofollow` to indexable directives and keeps canonical URL on `https://samaiconsulting.ru/`;
- a rollback copy of the previous root deployment exists before replacement;
- smoke tests verify `/`, legal pages, form readiness and `app.samaiconsulting.ru` immediately after cutover.

Current boundary: `/test/` is the verified staging environment. Root publication is a separate release action.