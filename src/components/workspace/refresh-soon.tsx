"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-read the page from the server every few seconds while something is being made (an account opening). */
export function RefreshSoon({ every = 4000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
