import { defineConfig, presetWind3 } from 'unocss'

// shadcn dark (zinc) HSL component triples (ADR-0017 / prototype SPEC).
const tokens: Record<string, string> = {
  background: '240 10% 3.9%',
  foreground: '0 0% 98%',
  card: '240 10% 5.5%',
  'card-foreground': '0 0% 98%',
  muted: '240 3.7% 15.9%',
  'muted-foreground': '240 5% 64.9%',
  border: '240 3.7% 15.9%',
  input: '240 3.7% 15.9%',
  primary: '0 0% 98%',
  'primary-foreground': '240 5.9% 10%',
  accent: '240 3.7% 18%',
  'accent-foreground': '0 0% 98%',
  ring: '240 4.9% 83.9%',
  // semantic (badges)
  emerald: '160 84% 39%',
  sky: '199 89% 48%',
  amber: '38 92% 50%',
  rose: '347 77% 50%',
  violet: '263 70% 60%',
}

// map token name -> hsl(var(--name)) so `bg-background`, `text-emerald`, etc. work.
const colors = Object.fromEntries(Object.keys(tokens).map((k) => [k, `hsl(var(--${k}))`]))

// inject the CSS variables onto :root so the hsl(var(--x)) references resolve.
const rootVars = Object.entries(tokens)
  .map(([k, v]) => `--${k}: ${v};`)
  .join('\n  ')

export default defineConfig({
  presets: [presetWind3()],
  content: {
    filesystem: ['client/**/*.{tsx,ts}', 'client/index.html'],
  },
  theme: {
    colors,
    fontFamily: {
      mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    },
  },
  preflights: [
    {
      getCSS: () => `
:root {
  ${rootVars}
  color-scheme: dark;
}
* { border-color: hsl(var(--border)); }
html, body, #root { height: 100%; margin: 0; }
body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: hsl(var(--muted)); border-radius: 6px; }
::-webkit-scrollbar-track { background: transparent; }
`,
    },
  ],
})
