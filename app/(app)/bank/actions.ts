"use server";

import { PresetError } from "@/lib/presets/calculation";
import { currentUser } from "@/lib/auth";
import { BankImportError, cents, MAX_XML_BYTES } from "@/lib/bank/camt";
import { confirmSuggested, importStatement, linkEntry, postEntry, unlinkEntry } from "@/lib/bank/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ActionState = { error?: string; message?: string };
function id(value: FormDataEntryValue | null) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new BankImportError("Kies een geldig record.");
  return n;
}
function errorState(error: unknown): ActionState {
  if (error instanceof BankImportError || error instanceof PresetError) return { error: error.message };
  console.error("Bank workflow failed", error);
  return { error: "De bewerking is niet voltooid. Vernieuw de pagina en probeer het opnieuw. Er zijn geen gedeeltelijke wijzigingen opgeslagen." };
}
async function actor() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return String(user.id);
}
function refresh() {
  revalidatePath("/suppliers", "layout");
  revalidatePath("/bank", "layout");
  revalidatePath("/transactions", "layout");
  revalidatePath("/accounts", "layout");
  revalidatePath("/reports", "layout");
  revalidatePath("/");
}
export async function uploadStatement(_state: ActionState, data: FormData): Promise<ActionState> {
  const user = await actor();
  let imported;
  try {
    const file = data.get("statement");
    if (!(file instanceof File) || !file.size || file.size > MAX_XML_BYTES) throw new BankImportError("Kies een gevuld CAMT.053-XML-bestand van maximaal 5 MB.");
    imported = await importStatement(await file.text(), file.name, id(data.get("account_id")), user);
  } catch (error) { return errorState(error); }
  refresh();
  redirect(`/bank?import=${imported.id}&uploaded=${imported.duplicate ? "duplicate" : "new"}`);
}
export async function reviewEntry(entryId: number, _state: ActionState, data: FormData): Promise<ActionState> {
  const user = await actor();
  try {
    const action = String(data.get("action"));
    let message = "";
    if (action === "link") {
      await linkEntry(entryId, id(data.get("transaction_id")), user, data.get("allow_unbalanced") === "on");
      message = "Gekoppeld aan de bestaande boeking. De boekingsregels zijn behouden.";
    } else if (action === "unlink") {
      await unlinkEntry(entryId, user);
      message = "Koppeling verwijderd. De boeking bestaat nog en kan opnieuw worden gekoppeld.";
    } else if (action === "post") {
      const accountIds = data.getAll("allocation_account"), amounts = data.getAll("allocation_amount"), memos = data.getAll("allocation_memo");
      const allocations = accountIds.map((account, index) => {
        const amount = String(amounts[index] ?? "").trim().replace(",", ".");
        return { accountId: id(account), amountCents: cents(amount.replace(/^-/, "")) * (amount.startsWith("-") ? -1 : 1), memo: String(memos[index] ?? "") };
      });
      await postEntry(entryId, String(data.get("description") ?? ""), data.get("project_id") ? id(data.get("project_id")) : null, allocations, user, data.get("acknowledge_candidates") === "on", data.get("preset_id") ? { id: id(data.get("preset_id")), version: id(data.get("preset_version")) } : undefined, data.get("acknowledge_refund") === "on");
      message = "Een sluitende boeking verwerkt en gekoppeld aan deze bankmutatie.";
    } else throw new BankImportError("Onbekende controleactie.");
    refresh();
    return { message };
  } catch (error) { return errorState(error); }
}
export async function reviewSuggested(_state: ActionState, data: FormData): Promise<ActionState> {
  const user = await actor();
  try {
    const count = await confirmSuggested(data.getAll("entry_id").map(id), user);
    refresh();
    return { message: `${count} bestaande boekingen gekoppeld. Er zijn geen nieuwe boekingen aangemaakt.` };
  } catch (error) { return errorState(error); }
}
