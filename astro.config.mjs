import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const BASE = "/comp4020-crit4-attwelveDev";

/**
 * Rewrite base-prefixed absolute asset URLs to page-relative ones.
 *
 * Astro writes `<script src="/comp4020-crit4-attwelveDev/_astro/x.js">`, which
 * is right on the deployed project page and unresolvable anywhere else. CI's
 * links check crawls the built `dist/` as a flat directory, so that URL points
 * at `dist/comp4020-crit4-attwelveDev/_astro/x.js`, which does not exist, and
 * the check fails on a site that is actually fine once deployed.
 *
 * Making the URLs relative fixes the check by making the local build and the
 * deployed build genuinely equivalent, rather than by teaching the check to
 * ignore a difference. It is also what this repo's original Vite config did
 * (`base: "./"`), which Astro has no direct equivalent for.
 */
function relativeAssetUrls() {
  return {
    name: "relative-asset-urls",
    hooks: {
      "astro:build:done": ({ dir, pages }) => {
        for (const { pathname } of pages) {
          const file = fileURLToPath(new URL(`${pathname}index.html`, dir));
          // A page one directory deep needs `../`, not `./`.
          const depth = pathname.split("/").filter(Boolean).length;
          const prefix = depth === 0 ? "./" : "../".repeat(depth);
          const html = readFileSync(file, "utf8");
          writeFileSync(file, html.replaceAll(`"${BASE}/`, `"${prefix}`));
        }
      },
    },
  };
}

export default defineConfig({
  // Deployed under GitHub Pages' project-site path
  // (username.github.io/<repo>/), so internal links and asset URLs need this
  // prefix. The integration above turns the emitted ones relative afterwards.
  base: BASE,
  // Inlines the one global stylesheet into each page instead of emitting a
  // base-prefixed `<link>` to a separate hashed CSS file, for the same reason.
  build: {
    inlineStylesheets: "always",
  },
  integrations: [relativeAssetUrls()],
});
