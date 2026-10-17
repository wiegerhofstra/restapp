import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export class BankImportError extends Error {}
export const MAX_XML_BYTES = 5 * 1024 * 1024;
export type BankDetail = { amountCents: number | null; name: string; iban: string; reference: string; description: string };
export type ParsedEntry = {
  key: string; bankReference: string; serviceReference: string; bookingDate: string; valueDate: string;
  amountCents: number; name: string; iban: string; reference: string; description: string;
  details: BankDetail[]; warning: string;
};
export type ParsedStatement = {
  statementId: string; iban: string; currency: string; startDate: string; endDate: string;
  openingCents: number; closingCents: number; entries: ParsedEntry[];
};

// XML leaves remain strings: bank identifiers and decimal amounts must never be coerced to floats.
type Xml = { [key: string]: Xml | Xml[] | string };
const object = (value: unknown): Xml => value && typeof value === "object" && !Array.isArray(value) ? value as Xml : {};
const list = (value: unknown): Xml[] => value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(object);
function at(value: unknown, ...path: string[]): unknown { return path.reduce<unknown>((v, key) => object(v)[key], value); }
function str(value: unknown): string { return typeof value === "string" ? value.trim() : typeof object(value)["#text"] === "string" ? String(object(value)["#text"]).trim() : ""; }
const text = (value: unknown, ...path: string[]) => str(at(value, ...path));
function fail(message: string): never { throw new BankImportError(message); }
export function cents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) fail(`Invalid EUR amount: ${value.slice(0, 30)}`);
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) fail("Amount exceeds the supported range.");
  return result;
}
function signedAmount(node: unknown, direction: string) {
  if (text(node, "@_Ccy") !== "EUR") fail("Only EUR statements and booking amounts are supported.");
  if (direction !== "CRDT" && direction !== "DBIT") fail("Missing credit/debit indicator.");
  return cents(str(node)) * (direction === "DBIT" ? -1 : 1);
}
function date(value: string): string {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) fail("Invalid or missing statement date.");
  return day;
}
function usableRef(value: string) { return /^(NOTPROVIDED|NONREF|NOTAVAILABLE|N\/A)$/i.test(value) ? "" : value; }
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function parseCamt(xml: string): ParsedStatement[] {
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) fail("Choose an XML file smaller than 5 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("XML document types and custom entities are not allowed.");
  const valid = XMLValidator.validate(xml);
  if (valid !== true) fail(`Invalid XML at line ${valid.err.line}.`);
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: true });
  const root = parser.parse(xml);
  const documentTag = xml.match(/<((?:[\w.-]+:)?Document)\b[^>]*>/)?.[0] ?? "";
  const prefix = documentTag.match(/^<([\w.-]+):Document/)?.[1];
  const namespace = documentTag.match(new RegExp(`\\bxmlns${prefix ? `:${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : ""}\\s*=\\s*["']([^"']+)["']`))?.[1];
  if (!/^urn:iso:std:iso:20022:tech:xsd:camt\.053\.001\.(02|03|08)$/.test(namespace ?? "")) fail("Supported formats: CAMT.053.001.02, .03 and .08.");
  const statements = list(at(root, "Document", "BkToCstmrStmt", "Stmt"));
  if (!statements.length) fail("No CAMT.053 statements found.");
  let entryCount = 0;
  const result = statements.map(s => {
    const iban = text(s, "Acct", "Id", "IBAN").replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) fail("The statement needs a valid account IBAN.");
    if (text(s, "Acct", "Ccy") !== "EUR") fail("Only EUR accounts are supported.");
    const balances = list(s.Bal);
    const balance = (code: string) => balances.find(b => text(b, "Tp", "CdOrPrtry", "Cd") === code);
    const opening = balance("OPBD") ?? balance("PRCD"), closing = balance("CLBD");
    if (!opening || !closing) fail("Opening and closing booked balances are required to verify this statement.");
    const openingCents = signedAmount(opening.Amt, text(opening, "CdtDbtInd"));
    const closingCents = signedAmount(closing.Amt, text(closing, "CdtDbtInd"));
    const entries = list(s.Ntry).map(e => {
      if (++entryCount > 10000) fail("Import at most 10,000 entries at a time.");
      if ((text(e, "Sts", "Cd") || text(e, "Sts")) !== "BOOK") fail("Only booked bank entries can be imported.");
      const direction = text(e, "CdtDbtInd");
      const amountCents = signedAmount(e.Amt, direction);
      if (!amountCents) fail("Zero-value bank entries are not supported.");
      const bookingDate = date(text(e, "BookgDt", "Dt") || text(e, "BookgDt", "DtTm"));
      const valueDate = date(text(e, "ValDt", "Dt") || text(e, "ValDt", "DtTm") || bookingDate);
      const bankReference = usableRef(text(e, "NtryRef")), serviceReference = usableRef(text(e, "AcctSvcrRef"));
      if (!bankReference && !serviceReference) fail("An entry has no stable bank reference; importing it could create duplicates.");
      const entryDetails = list(e.NtryDtls);
      const batchCount = entryDetails.reduce((sum, d) => sum + Number(text(d, "Btch", "NbOfTxs") || "0"), 0);
      const details = entryDetails.flatMap(d => list(d.TxDtls)).map(d => {
        const party = direction === "DBIT" ? "Cdtr" : "Dbtr";
        const amount = at(d, "AmtDtls", "TxAmt", "Amt") ?? d.Amt;
        const reference = [text(d, "Refs", "EndToEndId"), ...list(at(d, "RmtInf", "Strd")).map(r => text(r, "CdtrRefInf", "Ref"))].map(usableRef).filter(Boolean).join(" · ");
        const unstructured = at(d, "RmtInf", "Ustrd");
        const description = [...(Array.isArray(unstructured) ? unstructured : [unstructured]).map(str), text(d, "AddtlTxInf")].filter(Boolean).join(" ");
        return { amountCents: amount && text(amount, "@_Ccy") === "EUR" ? signedAmount(amount, text(d, "CdtDbtInd") || direction) : null,
          name: text(d, "RltdPties", party, "Nm") || text(d, "RltdPties", party, "Pty", "Nm"),
          iban: text(d, "RltdPties", `${party}Acct`, "Id", "IBAN"), reference, description };
      });
      const detailTotal = details.reduce((sum, d) => sum + (d.amountCents ?? 0), 0);
      const warning = batchCount > details.length && batchCount > 1
        ? "Batch booking: individual payment details are missing. Review the batch total before linking or posting."
        : details.length > 1
        ? details.every(d => d.amountCents !== null) && detailTotal === amountCents
          ? "Batch booking: review the individual payments below. Link or post the total once."
          : "Batch details do not fully explain the booked total. Review the total and any charges before posting."
        : "";
      return { key: digest(`${iban}|${bankReference ? `entry:${bankReference}` : `service:${serviceReference}`}`),
        bankReference, serviceReference, bookingDate, valueDate, amountCents,
        name: [...new Set(details.map(d => d.name).filter(Boolean))].join(" · "),
        iban: details.length === 1 ? details[0].iban : "",
        reference: details.map(d => d.reference).filter(Boolean).join(" · "),
        description: details.map(d => d.description).filter(Boolean).join(" · ") || text(e, "AddtlNtryInf"), details, warning };
    });
    const movement = entries.reduce((sum, e) => sum + e.amountCents, 0);
    if (!Number.isSafeInteger(movement) || openingCents + movement !== closingCents) fail("Statement balances do not reconcile. No entries were imported.");
    if (new Set(entries.map(e => e.key)).size !== entries.length) fail("The statement repeats a bank entry reference.");
    return { statementId: text(s, "Id"), iban, currency: "EUR", openingCents, closingCents,
      startDate: date(text(s, "FrToDt", "FrDtTm") || text(opening, "Dt", "Dt") || text(opening, "Dt", "DtTm")),
      endDate: date(text(s, "FrToDt", "ToDtTm") || text(closing, "Dt", "Dt") || text(closing, "Dt", "DtTm")), entries };
  });
  if (new Set(result.map(s => s.iban)).size !== 1) fail("Upload a statement for one bank account at a time.");
  return result;
}
