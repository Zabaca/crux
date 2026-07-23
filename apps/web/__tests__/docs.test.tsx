import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";

import { docHref } from "../lib/docs-links.js";
import { DocMarkdown } from "../components/doc-markdown.js";
import { DocsRotBanner } from "../components/docs-rot-banner.js";

describe("docHref", () => {
  test("rewrites an internal doc link to the docs route", () => {
    expect(docHref("README.md", "docs/adr/0002-x.md")).toEqual({
      kind: "doc",
      href: "/docs/docs/adr/0002-x.md",
    });
  });

  test("resolves relative links against the containing doc", () => {
    expect(docHref("docs/agents/domain.md", "../adr/0001-x.md")).toEqual({
      kind: "doc",
      href: "/docs/docs/adr/0001-x.md",
    });
  });

  test("leaves external links and anchors alone", () => {
    expect(docHref("README.md", "https://bun.sh")).toEqual({
      kind: "external",
      href: "https://bun.sh",
    });
    expect(docHref("README.md", "#why")).toEqual({ kind: "external", href: "#why" });
  });

  test("treats code paths and agent machinery as paths, not doc routes", () => {
    expect(docHref("README.md", "packages/core/src/transitions/")).toEqual({
      kind: "path",
      target: "packages/core/src/transitions",
    });
    expect(docHref("README.md", ".claude/skills/dev-start/SKILL.md")).toEqual({
      kind: "path",
      target: ".claude/skills/dev-start/SKILL.md",
    });
  });
});

describe("DocMarkdown", () => {
  test("renders internal doc links into the docs route and external links in a new tab", () => {
    const { container } = render(
      <DocMarkdown from="README.md" source="[glossary](CONTEXT.md) and [bun](https://bun.sh)\n" />,
    );

    const [internal, external] = Array.from(container.querySelectorAll("a"));
    expect(internal?.getAttribute("href")).toBe("/docs/CONTEXT.md");
    expect(internal?.getAttribute("target")).toBeNull();
    expect(external?.getAttribute("href")).toBe("https://bun.sh");
    expect(external?.getAttribute("target")).toBe("_blank");
  });

  test("renders a code path as text rather than a broken doc route", () => {
    const { container } = render(
      <DocMarkdown from="README.md" source="[transitions](packages/core/src/transitions/)\n" />,
    );

    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.textContent).toContain("packages/core/src/transitions");
  });
});

describe("DocsRotBanner", () => {
  test("renders nothing when there is no rot", () => {
    const { container } = render(<DocsRotBanner rot={{ brokenLinks: [], orphans: [] }} />);

    expect(container.textContent).toBe("");
  });

  test("names each broken link and orphan when rot exists", () => {
    const { container } = render(
      <DocsRotBanner
        rot={{
          brokenLinks: [{ from: "README.md", raw: "./gone.md", target: "gone.md" }],
          orphans: ["docs/lost.md"],
        }}
      />,
    );

    expect(container.textContent).toContain("README.md");
    expect(container.textContent).toContain("gone.md");
    expect(container.textContent).toContain("docs/lost.md");
  });
});
