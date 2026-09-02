import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { linkify } from "./v2-board";

describe("linkify — a worker can click the links in the task", () => {
  it("links bare sagepays.xyz paths and full URLs, and leaves the prose alone", () => {
    const html = renderToStaticMarkup(<>{linkify("Read sagepays.xyz/#privacy, then write a page. See https://sagepays.xyz/docs/settlement. Name sagepays.xyz.")}</>);
    expect(html).toContain('href="https://sagepays.xyz/#privacy"');
    expect(html).toContain('href="https://sagepays.xyz/docs/settlement"');
    expect(html).toContain('href="https://sagepays.xyz"');
    expect(html).toContain("then write a page.");
    expect(html).not.toContain('href="https://sagepays.xyz/#privacy,"'); // trailing punctuation stays outside
  });
});
