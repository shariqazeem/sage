"use client";
export function PrintButton() {
  return (
    <button type="button" className="st-print" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
