import type { Metadata } from "next";
import { DocumentManager } from "@/components/DocumentManager";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Documents - Any Statement"
};

export default async function Page() {
  return <DocumentManager viewer={await getViewer()} />;
}
