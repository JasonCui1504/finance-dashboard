"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  categorize,
  matchMerchantRule,
  normalizeIssuerCategory,
  type Category,
} from "../../../lib/finance/categories";
import { fmtUSD } from "../components/format";

type CreditCard = { id: number; name: string; issuer: string };
type MerchantRule = { id: number; match_key: string; category: string };

type PreviewRow = {
  date: string;
  description: string;
  amount: number; // positive = spend
  category: Category;
  include: boolean;
};

const inputCls =
  "rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-prose outline-none transition-colors focus:border-accent";
const btnCls =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50";
const ghostBtnCls =
  "rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-accent hover:text-prose";

// Pick the delimiter from the header line — supports comma CSV and tab TSV
// (some issuers, e.g. Robinhood, export tab-separated).
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

// --- CSV/TSV parsing (RFC-4180-ish: handles quoted fields and embedded delimiters) ---
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Statements copied out of an issuer's web activity table arrive as plain text
// with columns aligned by spaces. The description itself contains runs of
// spaces ("DISNEY PLUS ADY    BURBANK"), so split on the anchors that can't be
// ambiguous — a leading date and a trailing amount — and treat the rest as the
// description.
const TEXT_ROW =
  /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+(\(?-?\$?-?[\d,]+(?:\.\d{2})?\)?)\s*$/;

// True when at least one non-header row starts with something date-shaped, i.e.
// the delimiter split actually worked.
function tableHasDatedRows(table: string[][]): boolean {
  return table
    .slice(1)
    .some((row) => row.some((cell) => normalizeDate(cell) !== null));
}

function parsePlainText(text: string): string[][] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  // Column-aligned first: when every line splits into the same shape as the
  // header, trust that split — it preserves the Category and Type columns a
  // multi-column statement (Chase) carries. A trailing column left blank on a
  // row (an empty Memo) just comes back short.
  const split = lines.map((l) => l.trim().split(/\t|\s{2,}/).map((c) => c.trim()));
  const cols = split[0].length;
  const body = split.slice(1);
  if (
    cols >= 3 &&
    body.length > 0 &&
    body.every((cells) => cells.length === cols || cells.length === cols - 1)
  ) {
    return split;
  }

  // Otherwise the description itself contains wide gaps (Amex pads merchant
  // and city apart), so only the leading date and trailing amount are safe
  // anchors and everything between them is the description.
  const rows: string[][] = [["Date", "Description", "Amount"]];
  for (const line of lines) {
    const m = line.match(TEXT_ROW);
    if (m) rows.push([m[1], m[2].trim(), m[3]]);
  }
  return rows.length > 1 ? rows : [];
}

function findCol(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h.trim()));
}

function parseAmount(s: string): number {
  const raw = s.trim();
  // Accounting notation: (12.34) means -12.34
  const paren = /^\((.*)\)$/.exec(raw);
  const body = paren ? paren[1] : raw;
  const n = Number(body.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return paren ? -n : n;
}

// Collapse the padding issuers use to align columns so descriptions read
// cleanly in the preview and in the dashboard afterwards.
function cleanDescription(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// A card payment shows up as a credit whatever the issuer's sign convention,
// which makes it the most reliable signal for reading that convention.
const PAYMENT_DESC =
  /\bpayment\b|\bpymt\b|thank you|autopay|bill ?pay|direct debit|e-?payment/;

function normalizeDate(s: string): string | null {
  const v = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mo = m[1].padStart(2, "0");
    const d = m[2].padStart(2, "0");
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

export default function StatementImport({
  cards,
  onImported,
  onError,
}: {
  cards: CreditCard[];
  onImported: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cardId, setCardId] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [chargesPositive, setChargesPositive] = useState(false);
  const [hasAmountSignChoice, setHasAmountSignChoice] = useState(false);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [rawParsed, setRawParsed] = useState<
    {
      date: string;
      description: string;
      signedAmount: number | null;
      debit: number | null;
      credit: number | null;
      issuerCat: string | null;
      status: string | null;
      type: string | null;
    }[]
  >([]);

  // Rules you taught by recategorizing; applied to the preview on import.
  useEffect(() => {
    fetch("/api/finance/merchant-rules")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: MerchantRule[]) => setMerchantRules(Array.isArray(d) ? d : []))
      .catch(() => setMerchantRules([]));
  }, []);

  // Rebuild preview rows from the raw parse whenever the sign choice changes.
  const buildRows = useMemo(
    () =>
      (
        raw: typeof rawParsed,
        chargesArePositive: boolean,
        rules: MerchantRule[]
      ): PreviewRow[] => {
        const out: PreviewRow[] = [];
        for (const r of raw) {
          // Skip transactions that never completed (declined, reversed,
          // canceled, failed, voided) — e.g. a declined charge on Robinhood.
          const status = (r.status ?? "").toLowerCase();
          if (/declin|revers|cancel|fail|void/.test(status)) continue;

          const type = (r.type ?? "").toLowerCase();
          const desc = r.description.toLowerCase();

          // Skip card payments — not spending. A typed Payment row is always
          // skipped; a description match ("PAYMENT - THANK YOU", "ONLINE PYMT")
          // only counts on a credit, so a purchase from a merchant with
          // "payment" in its name isn't dropped.
          const typeIsPayment = PAYMENT_DESC.test(type);
          const descIsPayment = PAYMENT_DESC.test(desc);
          if (typeIsPayment) continue;

          const isRefund =
            /refund|return|credit|reversal|cash ?back/.test(type) ||
            /\brefund\b|\breturn\b/.test(desc);

          // Normalize to: positive = spend, negative = credit/refund.
          // Issuers with separate Debit/Credit columns (Capital One, Citi)
          // put refunds in Credit; otherwise use the single signed Amount.
          let amount: number | null = null;
          if (r.debit != null || r.credit != null) {
            if (r.debit != null && r.debit > 0) amount = r.debit;
            else if (r.credit != null && r.credit > 0) amount = -r.credit;
          } else if (r.signedAmount != null) {
            amount = chargesArePositive ? r.signedAmount : -r.signedAmount;
          }
          if (amount == null || amount === 0) continue;
          // Credits that read as a payment are money moved onto the card, not
          // spending. Every other credit is a refund and imports as one — most
          // issuers (Amex among them) label a refunded charge with nothing but
          // the original merchant name, so requiring the word "refund" here
          // silently dropped them.
          if (amount < 0 && descIsPayment) continue;
          // A row typed as a refund is always a credit, whatever its raw sign.
          if (isRefund && amount > 0) amount = -amount;

          // A rule you taught by recategorizing beats both the issuer's own
          // label and the built-in keywords — it is an explicit choice.
          const learned = matchMerchantRule(r.description, rules);
          const category: Category =
            (learned?.category as Category | undefined) ??
            (r.issuerCat ? normalizeIssuerCategory(r.issuerCat) : null) ??
            categorize(r.description);
          out.push({
            date: r.date,
            description: cleanDescription(r.description),
            amount,
            category,
            include: true,
          });
        }
        return out;
      },
    []
  );

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        let table = parseCsv(text, detectDelimiter(text));
        // A space-aligned statement has no delimiter to split on, so the whole
        // line lands in one cell and nothing parses. Re-read it as plain text.
        if (!tableHasDatedRows(table)) {
          const textTable = parsePlainText(text);
          if (textTable.length > 1) table = textTable;
        }
        if (table.length < 2) {
          onError("That file has no data rows.");
          return;
        }
        const headers = table[0].map((h) => h.trim());
        const postIdx = findCol(headers, /transaction date|trans date|date/i);
        const dateIdx = postIdx >= 0 ? postIdx : 0;
        const descIdx = findCol(headers, /description|payee|merchant|name|memo/i);
        const debitIdx = findCol(headers, /^debit$|debit amount|withdrawal/i);
        const creditIdx = findCol(headers, /^credit$|credit amount|deposit/i);
        const amountIdx = findCol(headers, /amount/i);
        const catIdx = findCol(headers, /category|type/i);
        const statusIdx = findCol(headers, /^status$/i);
        const typeIdx = findCol(headers, /^type$|transaction type/i);

        if (descIdx === -1 || (debitIdx === -1 && amountIdx === -1)) {
          onError(
            "Couldn't find description + amount columns. Expected headers like Date, Description, Amount."
          );
          return;
        }

        const raw = [];
        let neg = 0;
        let pos = 0;
        for (let i = 1; i < table.length; i++) {
          const cells = table[i];
          const date = normalizeDate(cells[dateIdx] ?? "");
          if (!date) continue;
          const description = (cells[descIdx] ?? "").trim();
          const debit = debitIdx >= 0 ? parseAmount(cells[debitIdx] ?? "") : NaN;
          const credit = creditIdx >= 0 ? parseAmount(cells[creditIdx] ?? "") : NaN;
          const amt = amountIdx >= 0 ? parseAmount(cells[amountIdx] ?? "") : NaN;
          if (Number.isFinite(amt)) {
            if (amt < 0) neg++;
            else if (amt > 0) pos++;
          }
          raw.push({
            date,
            description,
            signedAmount: Number.isFinite(amt) ? amt : null,
            debit: Number.isFinite(debit) ? debit : null,
            credit: Number.isFinite(credit) ? credit : null,
            issuerCat: catIdx >= 0 ? (cells[catIdx] ?? "").trim() || null : null,
            status: statusIdx >= 0 ? (cells[statusIdx] ?? "").trim() || null : null,
            type: typeIdx >= 0 ? (cells[typeIdx] ?? "").trim() || null : null,
          });
        }
        if (raw.length === 0) {
          onError("No parseable rows (check the date column).");
          return;
        }

        // Only offer the sign toggle when we're relying on a single signed
        // Amount column (not a dedicated Debit column).
        const usesAmountSign = debitIdx === -1;
        // Read the convention off a card payment when there is one: it is
        // always a credit, so its sign is definitive. Otherwise fall back to
        // "charges are the dominant sign", which misreads a statement with
        // more refunds than purchases.
        const paymentRow = raw.find(
          (r) =>
            r.signedAmount != null &&
            r.signedAmount !== 0 &&
            PAYMENT_DESC.test(r.description.toLowerCase())
        );
        const detectedPositive = paymentRow
          ? paymentRow.signedAmount! < 0
          : pos >= neg;
        setHasAmountSignChoice(usesAmountSign);
        setChargesPositive(detectedPositive);
        setRawParsed(raw);
        setRows(buildRows(raw, detectedPositive, merchantRules));
      } catch {
        onError("Failed to parse that file. Is it a CSV export?");
      }
    };
    reader.readAsText(file);
  }

  function flipSign(nextPositive: boolean) {
    setChargesPositive(nextPositive);
    setRows(buildRows(rawParsed, nextPositive, merchantRules));
  }

  function setRowCategory(idx: number, category: Category) {
    setRows((prev) =>
      prev ? prev.map((r, i) => (i === idx ? { ...r, category } : r)) : prev
    );
  }

  function toggleRow(idx: number) {
    setRows((prev) =>
      prev ? prev.map((r, i) => (i === idx ? { ...r, include: !r.include } : r)) : prev
    );
  }

  function reset() {
    setRows(null);
    setRawParsed([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const included = rows?.filter((r) => r.include) ?? [];
  const total = included.reduce((sum, r) => sum + r.amount, 0);

  async function doImport() {
    if (!cardId) {
      onError("Pick which card this statement is for.");
      return;
    }
    if (included.length === 0) {
      onError("No rows selected to import.");
      return;
    }
    try {
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: Number(cardId),
          transactions: included.map((r) => ({
            date: r.date,
            description: r.description,
            amount: r.amount,
            category: r.category,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Import failed");
      onImported(data.imported ?? included.length);
      reset();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-faint">
          Card this statement belongs to
          <select
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            className={inputCls}
          >
            <option value="">Select card</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">
          Statement file
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="text-sm text-subtle file:mr-3 file:rounded-md file:border file:border-line file:bg-lift file:px-3 file:py-1.5 file:text-sm file:text-subtle"
          />
        </label>
      </div>

      {rows && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas/40 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-subtle">
              {fileName}: <span className="text-prose">{included.length}</span> of{" "}
              {rows.length} rows, {fmtUSD(total)}
            </span>
            {hasAmountSignChoice && (
              <label className="flex items-center gap-1.5 text-xs text-faint">
                Charges are
                <select
                  value={chargesPositive ? "pos" : "neg"}
                  onChange={(e) => flipSign(e.target.value === "pos")}
                  className={inputCls}
                >
                  <option value="neg">negative amounts</option>
                  <option value="pos">positive amounts</option>
                </select>
              </label>
            )}
            <button onClick={reset} className={ghostBtnCls} type="button">
              Clear
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-faint">
                <tr>
                  <th className="p-2 font-normal">✓</th>
                  <th className="p-2 font-normal">Date</th>
                  <th className="p-2 font-normal">Description</th>
                  <th className="p-2 text-right font-normal">Amount</th>
                  <th className="p-2 font-normal">Category</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`border-t border-line ${r.include ? "" : "opacity-40"}`}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={() => toggleRow(i)}
                      />
                    </td>
                    <td className="p-2 tabular-nums text-subtle">{r.date}</td>
                    <td className="max-w-[280px] truncate p-2 text-subtle" title={r.description}>
                      {r.description}
                    </td>
                    <td
                      className={`p-2 text-right tabular-nums ${
                        r.amount < 0 ? "text-green-400" : "text-prose"
                      }`}
                      title={r.amount < 0 ? "Refund (credit)" : undefined}
                    >
                      {fmtUSD(r.amount)}
                    </td>
                    <td className="p-2">
                      <select
                        value={r.category}
                        onChange={(e) => setRowCategory(i, e.target.value as Category)}
                        className="rounded border border-line bg-canvas px-1.5 py-1 text-xs text-prose outline-none focus:border-accent"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <button onClick={doImport} className={btnCls} type="button">
              Import {included.length} transactions
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-faint">
        Download your statement from your card issuer, pick the card, and upload
        it here — CSV, tab-separated, or plain text copied from the issuer&apos;s
        activity table. Categories are auto-assigned from the merchant name —
        review and adjust any before importing. Declined transactions and card
        payments are skipped automatically; refunds import as credits (shown in
        green) that net against that category&apos;s spend. Parsing happens in
        your browser.
      </p>
    </div>
  );
}
