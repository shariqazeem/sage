/**
 * WHAT SAGE COULD NOT SEE, IN A BUILDER'S WORDS. The inspection writes its limits for engineers ("3 additional
 * same-origin page(s) were discovered but not inspected within the page budget"); a builder reads the same fact
 * plainly. A limit this does not know is shown as written: never dropped, never reworded into something else.
 */
export function plainLimit(raw: string): string {
  const t = raw.trim();
  const pages =
    /^(\d+) additional same-origin page\(s\) were discovered but not inspected/i.exec(
      t,
    );
  if (pages) {
    const n = Number(pages[1]);
    return `Sage read the main pages and left ${n === 1 ? "1 more page" : `${n} more pages`} for the people who try it.`;
  }
  if (
    /anything behind a login, or a specific interaction Sage didn't perform, may still be under-observed/i.test(
      t,
    )
  ) {
    return "Screens behind a sign-in, and anything Sage did not click, are for the people who try it.";
  }
  if (/^No specific goal was given/i.test(t)) {
    return "You did not name a goal, so the missions follow a first-time visitor. Name one to steer them.";
  }
  return t;
}
