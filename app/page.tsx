import { StatementWorkspace } from "@/components/StatementWorkspace";
import { getViewer } from "@/lib/viewer";

export default async function Page() {
  return <StatementWorkspace viewer={await getViewer()} section="review" />;
}
