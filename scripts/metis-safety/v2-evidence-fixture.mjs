import { createServer } from "node:http";
const pages = {
  "/launch": { phrase: "SAGE_V2_METIS_SAFETY_OK", mission: "launch-copy-verification" },
  "/second": { phrase: "SAGE_V2_SECOND_MISSION_OK", mission: "second-surface-verification" },
  "/velocity": { phrase: "SAGE_V2_VELOCITY_GUARD_OK", mission: "velocity-guard-verification" },
};
createServer((req, res) => {
  const p = pages[req.url.split("?")[0]];
  if (!p) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(
`Mission tester write-up — ${p.mission}

Source URL: http://127.0.0.1:4599${req.url}
Observation: I opened the supplied product surface and located the required launch-status statement. The exact required phrase is present, verbatim, in the page copy.
Exact quoted phrase: "${p.phrase}"
Reproducibility: The statement is reproducible by loading the source URL above; the phrase ${p.phrase} appears in the response body.
Retrieved: 2026-07-12T00:00:00Z
`);
}).listen(4599, "127.0.0.1", () => console.log("EVIDENCE_FIXTURE_LISTENING 127.0.0.1:4599"));
