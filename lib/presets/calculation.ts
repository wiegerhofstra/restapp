export class PresetError extends Error {}
export type Preset = {
  id: number; name: string; version: number; active: boolean;
  expense_account_id: number; vat_mode: 'none' | 'standard' | 'reverse'; rate_bps: number;
  input_vat_account_id: number | null; output_vat_account_id: number | null; project_id: number | null;
};
export type Allocation = { accountId: number; amountCents: number; memo: string };
export type PresetSelection = { id: number; version: number };
export type PresetRule = { id: number; preset_id: number; field: 'iban' | 'name' | 'description'; pattern: string; direction: 'payment' | 'refund' | 'both' };
export function parseAmount(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (normalized.length > 24 || !/^-?\d+(\.\d{1,2})?$/.test(normalized)) throw new PresetError('Enter an amount with at most two decimal places.');
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace('-', '').split('.');
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new PresetError('Amount is too large.');
  return Number(result) * (negative ? -1 : 1);
}
function roundedRatio(amount: number, numerator: number, denominator: number) {
  const result = (BigInt(amount) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new PresetError('Amount is too large.');
  return Number(result);
}
export function calculatePreset(preset: Preset, amount: number, basis: 'total' | 'net' = 'total') {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PresetError('Enter a positive amount.');
  if (!['total', 'net'].includes(basis) || !['none', 'standard', 'reverse'].includes(preset.vat_mode)) throw new PresetError('Invalid preset calculation.');
  if (!Number.isInteger(preset.rate_bps) || preset.rate_bps < 0 || preset.rate_bps > 10000) throw new PresetError('Invalid VAT rate.');
  let net = amount, tax = 0, total = amount;
  if (preset.vat_mode === 'standard' && basis === 'total') {
    net = roundedRatio(amount, 10000, 10000 + preset.rate_bps);
    tax = total - net;
  } else if (preset.vat_mode !== 'none') {
    tax = roundedRatio(net, preset.rate_bps, 10000);
    if (preset.vat_mode === 'standard') total = net + tax;
  }
  if (!Number.isSafeInteger(total)) throw new PresetError('Amount is too large.');
  const allocations: Allocation[] = [{ accountId: preset.expense_account_id, amountCents: net, memo: 'Net cost' }];
  if (preset.vat_mode !== 'none' && !preset.input_vat_account_id) throw new PresetError('Choose an input VAT account.');
  if (preset.vat_mode === 'reverse' && !preset.output_vat_account_id) throw new PresetError('Choose an output VAT account.');
  if (tax) allocations.push({ accountId: preset.input_vat_account_id!, amountCents: tax, memo: `${preset.rate_bps / 100}% ${preset.vat_mode === 'reverse' ? 'reverse-charge input' : 'input'} VAT` });
  if (tax && preset.vat_mode === 'reverse') allocations.push({ accountId: preset.output_vat_account_id!, amountCents: -tax, memo: `${preset.rate_bps / 100}% reverse-charge output VAT` });
  return { total, allocations: allocations.filter(a => a.amountCents !== 0) };
}
export function suggestPresets(presets: Preset[], rules: PresetRule[], entry: { counterparty: string; counterparty_iban: string; description: string; amount_cents: number; details: unknown[]; warning: string }) {
  if (entry.details.length > 1 || entry.warning) return [];
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const direction = entry.amount_cents < 0 ? 'payment' : 'refund';
  return presets.filter(p => p.active && rules.some(r => r.preset_id === p.id && (r.direction === direction || r.direction === 'both') && (
    r.field === 'iban' ? entry.counterparty_iban.replace(/\s/g, '').toUpperCase() === r.pattern.replace(/\s/g, '').toUpperCase()
      : normalize(r.field === 'name' ? entry.counterparty : entry.description).includes(normalize(r.pattern))
  )));
}
