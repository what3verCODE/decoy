# @decoy/playwright

Drive the in-process engine over Playwright's `page.route`, isolated per browser context — no server.
Delivered as a Playwright fixture.

**Role** · the browser-edge test adapter (router mode).
**Exports** · `createPlaywrightRouter`, `createRouterFixture`, `PlaywrightRouter`.
**Depends on** · `@decoy/core`, `@decoy/config`, `@decoy/control`; peer `@playwright/test`.
**Used by** · `examples/playwright-router`.

Setup → `/integrations/playwright-router`. Generated API → `/reference/api/`.
