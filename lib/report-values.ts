export type ReportAmounts = { side: string; legacy_column?: string | null; debit: number; credit: number; legacy_in?: number; legacy_out?: number };
export function reportValue(row: ReportAmounts) {
  if (row.legacy_column === "in") return row.legacy_in ?? 0;
  if (row.legacy_column === "out") return row.legacy_out ?? 0;
  if (row.side === "debit") return row.debit;
  if (row.side === "credit") return row.credit;
  if (row.side === "net_credit") return row.credit - row.debit;
  return row.debit - row.credit;
}
export function reportSideLabel(row: Pick<ReportAmounts, "side" | "legacy_column">) {
  if (row.legacy_column) return `Oorspronkelijk ${row.legacy_column === "out" ? "uit" : "in"}`;
  return ({ debit: "Debet", credit: "Credit", net: "Debet − credit", net_debit: "Debetsaldo", net_credit: "Creditsaldo" })[row.side] ?? row.side;
}
