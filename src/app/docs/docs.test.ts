import { describe, expect, it } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { DOCS_PAGES } from "@/lib/site/docs-pages";
import { DOCS_REDIRECTS } from "@/lib/site/redirects-docs";

/**
 * THE DOCS ARE SEVERAL LISTS THAT HAVE TO AGREE: the pages on disk, the sidebar's list, the old
 * addresses and where they now go, and the section ids those redirects and the pages' own links
 * point at. Each pair is type-checked or nothing, and a broken anchor fails silently in a browser
 * (the page loads, at the top), so this reads all of them together.
 */
const APP = join(process.cwd(), "src/app");
const DOCS = join(APP, "docs");

/** Every address the docs had before they were folded into five (19 Oct 2026). */
const BEFORE = [
  "/docs",
  "/docs/how-it-works",
  "/docs/architecture",
  "/docs/missions",
  "/docs/judging",
  "/docs/settlement",
  "/docs/arc",
  "/docs/safety",
  "/docs/operator",
  "/docs/privacy",
  "/docs/compliance",
  "/docs/interfaces",
  "/docs/build-on-sage",
];

function files(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, match, out);
    else if (match(e)) out.push(p);
  }
  return out;
}

const pageFiles = files(DOCS, (n) => n === "page.tsx");
const hrefOf = (file: string) => `/${relative(APP, dirname(file))}`;
const sourceOf = (href: string) => readFileSync(join(APP, href, "page.tsx"), "utf8");
const listed = new Set<string>(DOCS_PAGES.map((p) => p.href));

describe("the docs pages", () => {
  it("are exactly the five the sidebar lists", () => {
    expect(pageFiles.map(hrefOf).sort()).toEqual([...listed].sort());
    expect(DOCS_PAGES).toHaveLength(5);
  });

  it("keep every old address alive, as a page or a permanent redirect", () => {
    const moved = new Set(DOCS_REDIRECTS.map((r) => r.source));
    for (const href of BEFORE) expect(listed.has(href) || moved.has(href), href).toBe(true);
    for (const r of DOCS_REDIRECTS) expect(r.permanent, r.source).toBe(true);
  });

  it("never redirect away from a live page", () => {
    for (const r of DOCS_REDIRECTS) expect(listed.has(r.source), r.source).toBe(false);
  });

  it("send each old address to a page and a section that exist", () => {
    for (const r of DOCS_REDIRECTS) {
      const [path, anchor] = r.destination.split("#");
      expect(listed.has(path), r.destination).toBe(true);
      if (anchor) expect(sourceOf(path), r.destination).toContain(`id="${anchor}"`);
    }
  });

  it("link only to docs pages and sections that exist", () => {
    for (const file of pageFiles) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/href="(\/docs[^"]*)"/g)) {
        const [path, anchor] = m[1].split("#");
        expect(listed.has(path), `${hrefOf(file)} links to ${m[1]}`).toBe(true);
        if (anchor) expect(sourceOf(path), `${hrefOf(file)} links to ${m[1]}`).toContain(`id="${anchor}"`);
      }
    }
  });

  it("each render, with a heading and every section an old address points at", async () => {
    const pages: Record<string, () => Promise<{ default: ComponentType }>> = {
      "/docs": () => import("./page"),
      "/docs/how-it-works": () => import("./how-it-works/page"),
      "/docs/trust": () => import("./trust/page"),
      "/docs/payments": () => import("./payments/page"),
      "/docs/build": () => import("./build/page"),
    };
    expect(Object.keys(pages).sort()).toEqual([...listed].sort());
    for (const [href, load] of Object.entries(pages)) {
      const { default: Page } = await load();
      const html = renderToStaticMarkup(createElement(Page));
      expect(html, href).toMatch(/<h1 class="doc-title">[^<]+<\/h1>/);
      expect(html, href).not.toMatch(/\sstyle="/);
      for (const r of DOCS_REDIRECTS) {
        const [path, anchor] = r.destination.split("#");
        if (path === href && anchor) expect(html, r.destination).toContain(`id="${anchor}"`);
      }
    }
  });

  it("are written in the house style: classes only, no em dashes", () => {
    const own = [
      ...pageFiles,
      join(DOCS, "layout.tsx"),
      join(DOCS, "parts.tsx"),
      join(process.cwd(), "src/components/site/docs-nav.tsx"),
    ];
    for (const file of own) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/style=\{/);
      expect(src, file).not.toMatch(/—|&mdash;/);
    }
  });
});
