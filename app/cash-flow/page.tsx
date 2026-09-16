import type { Metadata } from "next";
import { StatementWorkspace } from "@/components/StatementWorkspace";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Cash flow - Any Statement"
};

export default async function Page() {
  return <StatementWorkspace viewer={await getViewer()} section="cashflow" />;
}
