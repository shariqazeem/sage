"use client";

/** Print, or save as a PDF through the browser's own print dialog. */
export function PrintReceipt() {
  return (
    <button type="button" className="rc-print" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
