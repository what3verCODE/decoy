// Single source of truth for where the SPA dev server listens. Imported by both
// rsbuild.config.ts (server port) and playwright.config.ts (webServer url + baseURL).
export const PORT = 5180
export const BASE_URL = `http://127.0.0.1:${PORT}`
