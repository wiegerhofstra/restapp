// This adapter describes the old Rails chart, not the meaning of debit/credit
// in the current application. Keep the original in/out fields as source evidence.
export type LegacyAccount = { id: number; name: string; kind: string; parent_id: number | null; inverted: number };
const overrides: Record<number, { name: string; kind: string; parent_id?: number | null; inDebit: boolean }> = {
  9: { name: "Taxes", kind: "liability", parent_id: null, inDebit: true },
  10: { name: "BTW 21%", kind: "liability", inDebit: true },
  11: { name: "Inc Taxes", kind: "asset", parent_id: 2, inDebit: true },
  12: { name: "BTW advanced 21%", kind: "asset", inDebit: true },
  16: { name: "Tax returns", kind: "asset", inDebit: false },
  17: { name: "BTW advanced 19%", kind: "asset", inDebit: true },
  19: { name: "BTW 19%", kind: "liability", inDebit: true },
  24: { name: "Turnover tax", kind: "liability", inDebit: false },
  30: { name: "BTW advanced 21% verlegd", kind: "asset", inDebit: true },
  31: { name: "BTW 21% verlegd", kind: "liability", inDebit: true },
};
export function standardAccount(account: LegacyAccount) {
  const override = overrides[account.id];
  if (override && override.name !== account.name) throw new Error(`Legacy account ${account.id} does not match the reviewed chart: ${account.name}`);
  if (!override && account.inverted) throw new Error(`Unrecognised inverted legacy account ${account.id}`);
  return { ...account, kind: override?.kind ?? account.kind,
    parent_id: override && "parent_id" in override ? override.parent_id! : account.parent_id,
    inverted: 0, inDebit: override?.inDebit ?? account.kind === "asset" };
}
type SourceLine = { id: number; transaction_id: number; account_id: number; source_in_cents: number; source_out_cents: number };

export function standardLegacyLine(line: SourceLine, account: LegacyAccount) {
  if (![line.source_in_cents, line.source_out_cents].every(Number.isSafeInteger)) throw new Error(`Missing or unsafe source amount on line ${line.id}`);
  let signed = (line.source_in_cents - line.source_out_cents) * (standardAccount(account).inDebit ? 1 : -1);
  // Two source refunds used inconsistent in/out signs. Their separate, equal
  // incoming bank lines establish the offset. Guard every identifying field.
  if (line.id === 2968) {
    if (line.transaction_id !== 1017 || line.account_id !== 36 || line.source_in_cents !== -482 || line.source_out_cents !== 0) throw new Error("Netcup refund no longer matches the reviewed source");
    signed = -482;
  }
  if (line.id === 3333) {
    if (line.transaction_id !== 1135 || line.account_id !== 6 || line.source_in_cents !== 0 || line.source_out_cents !== 14300) throw new Error("Megekko refund no longer matches the reviewed source");
    signed = -14300;
  }
  if (!Number.isSafeInteger(signed)) throw new Error(`Unsafe converted amount on line ${line.id}`);
  return { debit_cents: Math.max(signed, 0), credit_cents: Math.max(-signed, 0) };
}

export function standardReportSide(account: LegacyAccount, column: string, separateSides: boolean) {
  if (column !== "in" && column !== "out") throw new Error("Unknown legacy report column");
  const debit = (column === "in") === standardAccount(account).inDebit;
  // Bank/cash movement reports and reports explicitly listing both directions
  // retain separate gross columns. Other reports include refunds/credit notes.
  return account.kind === "asset" || separateSides ? (debit ? "debit" : "credit") : (debit ? "net_debit" : "net_credit");
}
