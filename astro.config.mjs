import { defineConfig } from "astro/config";

// Deployed under GitHub Pages' project-site path (username.github.io/<repo>/),
// so every internal link and asset URL needs this prefix baked in. Astro
// (unlike this template's original Vite config) doesn't infer it from `./`
// relative URLs, so it has to be set explicitly here. Every hand-written
// internal link is instead written relative to the current page so it
// resolves the same way locally and once deployed.
export default defineConfig({
  base: "/comp4020-crit4-attwelveDev",
  // Inlines the one global stylesheet into each page instead of emitting a
  // base-prefixed `<link>` to a separate hashed CSS file. That prefixed link
  // is the one asset URL Astro always writes as absolute, which is exactly
  // right once deployed but doesn't resolve against a flat local `dist/` —
  // inlining removes the broken link instead of leaving it for the deployed
  // check alone to paper over, and costs nothing for a single small stylesheet.
  build: {
    inlineStylesheets: "always",
  },
});
