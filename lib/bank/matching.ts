export type MatchEntry = { id: number; booking_date: string; amount_cents: number; counterparty: string; description: string; reference: string; warning: string };
export type LedgerCandidate = { id: number; transaction_date: string; description: string; reference: string; amount_cents: number; difference: number };
export type MatchCandidate = LedgerCandidate & { days: number; reasons: string[]; strong: boolean };
export type Match = { candidates: MatchCandidate[]; suggestedId: number | null };
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function matchEntries(entries: MatchEntry[], ledger: LedgerCandidate[]): Map<number, Match> {
  const matches = new Map<number, Match>();
  const claims = new Map<number, number>();
  for (const e of entries) {
    const bankTokens = new Set(tokens(`${e.counterparty} ${e.description} ${e.reference}`));
    const candidates = ledger.filter(t => t.amount_cents === e.amount_cents)
      .map(t => {
        const days = Math.round(Math.abs(Date.parse(t.transaction_date) - Date.parse(e.booking_date)) / 86400000);
        const common = tokens(`${t.description} ${t.reference}`).filter(token => bankTokens.has(token));
        const reference = common.some(token => token.length >= 6 && /\d/.test(token));
        const merchant = common.some(token => token.length >= 5 && !/^(payment|invoice|betaling|factuur|limited|commerce|kosten)$/.test(token));
        return { ...t, days, strong: !e.warning && t.difference === 0 && (reference && days <= 3 || merchant && days === 0),
          reasons: ["Zelfde bedrag en betalingsrichting", days === 0 ? "Zelfde datum" : `${days} ${days === 1 ? "dag" : "dagen"} verschil`, ...(reference ? ["Overeenkomstig betalingskenmerk"] : merchant ? ["Overeenkomstige omschrijving"] : []), ...(t.difference !== 0 ? ["Bestaande boeking is niet in evenwicht"] : [])] };
      }).filter(t => t.days <= 7).sort((a, b) => Number(b.strong) - Number(a.strong) || a.days - b.days || a.id - b.id);
    // No fuzzy score is allowed to conceal a competing amount/date match.
    const suggestedId = candidates.length === 1 && candidates[0].strong ? candidates[0].id : null;
    for (const candidate of candidates) claims.set(candidate.id, (claims.get(candidate.id) ?? 0) + 1);
    matches.set(e.id, { candidates, suggestedId });
  }
  for (const match of matches.values()) if (match.suggestedId && claims.get(match.suggestedId) !== 1) match.suggestedId = null;
  return matches;
}
