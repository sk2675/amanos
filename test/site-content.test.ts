import { describe, expect, it } from "vitest";

import { inspectSiteContent } from "../scripts/check-site-content.mjs";

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
});
