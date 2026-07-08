import { redirect } from "next/navigation";

// The old /hire landing is retired — the front door is now the Sage landing at /.
export default function HirePage() {
  redirect("/");
}
