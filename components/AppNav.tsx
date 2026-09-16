"use client";

import {
  ChartPie,
  FileStack,
  Layers,
  ListChecks,
  MessageCircle,
  SlidersHorizontal,
  Wallet
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  readInitialMonthsSnapshot,
  readMonthsSnapshot,
  subscribeToMonths
} from "@/lib/monthsClientStore";

/**
 * Every destination is a route, so the browser's own history, the back button,
 * a bookmark and a middle-click all work on them. They used to be one client
 * component's `section` state, which meant the back button left the app and a
 * link to "the income table" did not exist.
 *
 * The nav renders the same markup in both layouts: a sticky column beside the
 * content above 900px, a fixed bottom tab bar below it (see `.app-nav`).
 */
export type SectionId =
  | "review"
  | "cashflow"
  | "income"
  | "chat"
  | "all"
  | "setup"
  | "files";

export const WORKSPACE_SECTIONS: {
  id: SectionId;
  label: string;
  /** Shown as the page's heading in the header bar. */
  title: string;
  href: string;
  Icon: LucideIcon;
}[] = [
  {
    id: "review",
    label: "Review",
    title: "Expense review",
    href: "/",
    Icon: ListChecks
  },
  {
    id: "cashflow",
    label: "Cash flow",
    title: "Cash flow",
    href: "/cash-flow",
    Icon: ChartPie
  },
  {
    id: "income",
    label: "Income",
    title: "Income",
    href: "/income",
    Icon: Wallet
  },
  {
    id: "chat",
    label: "Chat",
    title: "Expense chat",
    href: "/chat",
    Icon: MessageCircle
  },
  {
    id: "all",
    label: "All months",
    title: "All months",
    href: "/all-months",
    Icon: Layers
  },
  {
    id: "setup",
    label: "Setup",
    title: "Statements and setup",
    href: "/setup",
    Icon: SlidersHorizontal
  },
  {
    id: "files",
    label: "Files",
    title: "Documents",
    href: "/documents",
    Icon: FileStack
  }
];

export function sectionTitle(id: SectionId) {
  return (
    WORKSPACE_SECTIONS.find((entry) => entry.id === id)?.title ||
    WORKSPACE_SECTIONS[0].title
  );
}

/**
 * Counts come from the month store rather than from props, so the nav is
 * mountable on any page - including `/documents`, which owns no month state -
 * without threading them through.
 */
export function AppNav() {
  const pathname = usePathname();
  const months = useSyncExternalStore(
    subscribeToMonths,
    readMonthsSnapshot,
    readInitialMonthsSnapshot
  );
  const document = months.document;
  const counts: Partial<Record<SectionId, number>> = {
    review: document?.expenses.length || 0,
    income: document?.incomes.length || 0,
    all: months.months.length,
    setup: document?.statements.length || 0
  };

  return (
    <nav className="app-nav" aria-label="Sections">
      {WORKSPACE_SECTIONS.map(({ id, label, href, Icon }) => {
        const active = pathname === href;

        return (
          <Link
            className={`app-nav-item ${active ? "active" : ""}`}
            key={id}
            href={href}
            title={label}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={18} aria-hidden="true" suppressHydrationWarning />
            <span>{label}</span>
            {counts[id] ? <em>{counts[id]}</em> : null}
          </Link>
        );
      })}
    </nav>
  );
}
