import type { Metadata } from "next";
import { StatementWorkspace } from "@/components/StatementWorkspace";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Income - Any Statement"
};

export default async function Page() {
  return <StatementWorkspace viewer={await getViewer()} section="income" />;
}
