import { defineConfig } from "astro/config";

import { CANONICAL_ORIGIN } from "./site-config.mjs";

export default defineConfig({
  site: CANONICAL_ORIGIN,
  output: "static",
});
