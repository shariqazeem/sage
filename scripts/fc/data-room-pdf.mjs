/**
 * Render the Future Caribbean package to PDFs for the Data Room (Google Drive). Markdown → HTML
 * (marked, from cdnjs) → PDF with Playwright, in the product's type. No local converter needed.
 *   node scripts/fc/data-room-pdf.mjs docs/fc/data-room/00-index.md docs/fc/submission-overview.md …
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
const files = process.argv.slice(2);
const outDir = resolve("docs/fc/data-room");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of files) {
  const md = readFileSync(f, "utf8");
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? basename(f)).replace(/[*_`]/g, "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<style>
body{font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#1a1d21;font-size:10.5pt;line-height:1.5;margin:0;padding:0}
h1{font-size:22pt;letter-spacing:-.02em;margin:0 0 6pt;line-height:1.15}h2{font-size:14pt;margin:18pt 0 6pt;letter-spacing:-.01em;border-bottom:1px solid #e6e4de;padding-bottom:4pt}h3{font-size:11.5pt;margin:14pt 0 4pt}
p{margin:6pt 0}blockquote{margin:8pt 0;padding:6pt 12pt;border-left:3px solid #c2410c;background:#faf5f1;color:#4a473f}
code{font-family:"JetBrains Mono",Menlo,monospace;font-size:9pt;background:#f3f2ed;padding:1px 4px;border-radius:3px}pre{background:#f3f2ed;padding:8pt 10pt;border-radius:6px;overflow:hidden;white-space:pre-wrap;font-size:8.5pt}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:9pt}th,td{border:1px solid #e6e4de;padding:5pt 7pt;vertical-align:top;text-align:left}th{background:#f3f2ed;font-weight:600}
a{color:#c2410c;text-decoration:none;word-break:break-all}ul,ol{padding-left:18pt}li{margin:2pt 0}hr{border:0;border-top:1px solid #e6e4de;margin:14pt 0}
.foot{position:fixed;bottom:0;font-size:8pt;color:#8a8578}
</style></head><body><div id="c"></div><script>document.getElementById("c").innerHTML = marked.parse(${JSON.stringify(md)});</script></body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const out = `${outDir}/${basename(f).replace(/\.md$/, "")}.pdf`;
  await page.pdf({ path: out, format: "A4", margin: { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" }, printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="width:100%;font-size:8px;color:#8a8578;padding:0 16mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial"><span>Sage · sagepays.xyz · Future Caribbean 2026 · ${title.replace(/</g, "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
  console.log(out);
}
await browser.close();
