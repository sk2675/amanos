import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  checkSiteContent,
  inspectClientDataProcessing,
  inspectSiteContent,
} from "../scripts/check-site-content.mjs";

describe("site content policy", () => {
  it("rejects the known incorrect domain", () => {
    expect(inspectSiteContent("Email info@amanto.dev", "imprint.astro")).toEqual([
      "imprint.astro: known incorrect domain amanto.dev",
    ]);
  });

  it.each(["[VAT ID]", "[placeholder]", "[TODO]", "CHANGEme", "Lorem ipsum"])(
    "rejects visible placeholder %s",
    (placeholder) => {
      expect(inspectSiteContent(placeholder, "page.astro")).toHaveLength(1);
    },
  );

  it("accepts ordinary rendered content", () => {
    expect(inspectSiteContent("Last updated: 6 September 2026", "imprint.astro")).toEqual([]);
  });

  it.each([
    '<script src="https://plausible.io/js/script.js"></script>',
    'import { Analytics } from "@vercel/analytics/react";',
    "localStorage.setItem('consent', 'yes')",
    '@font-face { src: url("https://fonts.example/font.woff2"); }',
    '@import "https://fonts.example/font.css";',
  ])("blocks undisclosed client-side data processing: %s", (content) => {
    expect(inspectClientDataProcessing(content, "component.astro").length).toBeGreaterThan(0);
  });

  it("accepts local client-side behavior", () => {
    expect(inspectClientDataProcessing("requestAnimationFrame(render)", "component.astro")).toEqual([]);
  });

  it("keeps the current site aligned with its privacy disclosures", async () => {
    const siteDirectory = fileURLToPath(new URL("../site", import.meta.url));
    await expect(checkSiteContent(siteDirectory)).resolves.toEqual([]);
  });
});
