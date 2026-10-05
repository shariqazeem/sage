// What the deck points at on the day. Every value can be overridden from the URL, so staging on
// Saturday is a link, not a deploy:
//   https://sagepays.xyz/stage/index.html?live=<job>&backup=<job>&worker=<0x…>&pay=J$160&usd=1.02&network=Arc&refusals=26
// The presenter window (P) opens with the same query, so both windows always agree.
(function () {
  var q = new URLSearchParams(location.search);
  var v = function (k, d) { var x = q.get(k); return x && x.trim() ? x.trim() : d; };
  window.STAGE = {
    // The fresh job posted for the live run. ONE submission ever: the one made on stage.
    live: v("live", "gig-fhD0wboTcy"),
    // A job from the last rehearsal, already paid. Press B on the live slide to show it.
    backup: v("backup", "grant-g0EREoF2rv"),
    // The worker wallet submitted from on the phone. Its record is the "credit record" slide.
    worker: v("worker", "0x04CA1a9d6D6A118cdf9f116087B90d6192C99237"),
    // The job as posted, shown on the live slide exactly as the founder wrote it.
    job: {
      title: v("title", "Put your shop's price list online"),
      ask: v("ask", "Three items, each priced in J$, on a public page. Send the link."),
      pay: v("pay", "J$160"),
      payUsd: "≈ $" + v("usd", "1.02") + " in USDC",
      network: v("network", "Arc"),
    },
    // Read off /explorer during staging ("Refusals on record"); the script says it aloud.
    refusals: v("refusals", "26"),
    // Same origin when served from sagepays.xyz (Privy only runs inside frames whose parent is
    // sagepays.xyz; anywhere else every framed page retries its sign-in frame and stops painting).
    site: /(^|\.)sagepays\.xyz$/.test(location.hostname) ? location.origin : "https://sagepays.xyz",
  };
})();
