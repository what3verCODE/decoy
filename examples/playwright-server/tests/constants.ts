// Fixed ports for `dev` (a human opens the SPA in a browser and curls the Decoy
// server's `/admin`). The e2e harness ignores these and binds ephemeral ports per
// Playwright worker instead, so parallel runs never collide.
export const DECOY_PORT = 3004
export const SPA_PORT = 5181
