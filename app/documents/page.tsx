import type { Metadata } from "next";
import { DocumentManager } from "@/components/DocumentManager";

export const metadata: Metadata = {
  title: "Documents - Statement Ledger"
};

export default function Page() {
  return <DocumentManager />;
}
