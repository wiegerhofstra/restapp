"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseAmount, PresetError } from '@/lib/presets/calculation';
import type { Preset } from '@/lib/presets/calculation';
import { applyManualPreset, savePreset, saveRule } from '@/lib/presets/service';
import type { ActionState } from '../../bank/actions';
async function actor() { const user = await currentUser(); if (!user) redirect('/login'); return String(user.id); }
function id(value: FormDataEntryValue | null) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new PresetError("Kies een geldig record.");
  return number;
}
function errorState(error: unknown) {
  if (error instanceof PresetError) return { error: error.message };
  console.error('Preset operation failed', error);
  return { error: "Opslaan is niet gelukt. Vernieuw de pagina en probeer het opnieuw. Er is geen gedeeltelijke boeking opgeslagen." };
}
function refresh() {
  revalidatePath('/settings/presets'); revalidatePath('/bank', 'layout');
  revalidatePath('/transactions', 'layout'); revalidatePath('/reports', 'layout'); revalidatePath('/accounts', 'layout'); revalidatePath('/');
}
export async function savePresetAction(presetId: number | null, _state: ActionState, data: FormData): Promise<ActionState> {
  await actor();
  try {
    const mode = String(data.get('vat_mode')) as Preset['vat_mode'];
    const preset = { name: String(data.get('name') ?? ''), active: data.get('active') === 'on', expense_account_id: id(data.get('expense_account_id')),
      vat_mode: mode, rate_bps: mode === 'none' ? 0 : parseAmount(String(data.get('rate') ?? '')),
      input_vat_account_id: mode === 'none' ? null : id(data.get('input_vat_account_id')),
      output_vat_account_id: mode === 'reverse' ? id(data.get('output_vat_account_id')) : null,
      project_id: data.get('project_id') ? id(data.get('project_id')) : null };
    await savePreset(presetId, presetId ? id(data.get('version')) : null, preset);
    refresh(); return { message: "Boekingssjabloon opgeslagen. Bestaande boekingen zijn ongewijzigd." };
  } catch (error) { return errorState(error); }
}
export async function addRuleAction(presetId: number, _state: ActionState, data: FormData): Promise<ActionState> {
  await actor();
  try { await saveRule(presetId, String(data.get('field')), String(data.get('pattern') ?? ''), String(data.get('direction'))); refresh(); return { message: "Herkenningsregel opgeslagen." }; }
  catch (error) { return errorState(error); }
}
export async function removeRuleAction(ruleId: number): Promise<ActionState> {
  await actor();
  try { await db.prepare('DELETE FROM posting_preset_rules WHERE id=?').run(ruleId); refresh(); return { message: "Regel verwijderd." }; }
  catch (error) { return errorState(error); }
}
export async function postManualPresetAction(transactionId: number, _state: ActionState, data: FormData): Promise<ActionState> {
  const user = await actor();
  try {
    const accounts = data.getAll('allocation_account'), amounts = data.getAll('allocation_amount'), memos = data.getAll('allocation_memo');
    const allocations = accounts.map((account, index) => ({ accountId: id(account), amountCents: parseAmount(String(amounts[index] ?? '')), memo: String(memos[index] ?? '') }));
    const direction = String(data.get('direction'));
    if (!['payment', 'refund'].includes(direction)) throw new PresetError("Kies een betaling of terugbetaling.");
    await applyManualPreset(transactionId, { id: id(data.get('preset_id')), version: id(data.get('preset_version')) }, id(data.get('bank_account_id')),
      parseAmount(String(data.get('amount'))), String(data.get('basis')) as 'total' | 'net', direction === 'refund', data.get('acknowledge_refund') === 'on', allocations,
      data.get('project_id') ? id(data.get('project_id')) : null, user);
    refresh(); return { message: "Het sjabloon is verwerkt als sluitende boeking." };
  } catch (error) { return errorState(error); }
}
