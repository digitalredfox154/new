# SAMAI v11 release QA

## Release

- Landing merge SHA: `5d69b2a86523d125b4fc838e8a82ea57965770ae`
- Release: `11-ci-5d69b2a86523`
- Release branch SHA: `be439f26af9cf9450b1f188945f368bfd3e33d44`
- `index.html` SHA-256: `0e1f6ac210e6a3cc20f11c1f2e3fd82ed71c22d189d04caa3f41373eec4a83f1`
- Publishing workflow: `35207298346`
- Live verification workflow: `35207298308`

## Automated live result

- 71 of 71 checks passed.
- Chromium, Firefox and WebKit passed.
- Viewports from 360 to 1920 px passed without horizontal overflow.
- Runtime exceptions: none.
- Form readiness: ready.
- Laboratory mobile run: LCP 1620 ms, CLS 0.

## Controlled production lead

- One synthetic lead was created with an explicit QA label.
- HTTP result: `201`, accepted.
- Telegram delivery result: `sent`.
- A repeated request with the same key returned `duplicate: true` and the same lead.
- The raw idempotency key is not stored in this document.
- No cleanup was performed because the lead and audit event are part of the release record.

## Isolation

- `samaiconsulting.ru/` remained unchanged and returned 404 during verification.
- `app.samaiconsulting.ru` remained healthy on version `b1751412877322ee16b14e5d7d6cb86f36e9445b`.
- No manual files were copied to the VPS.
