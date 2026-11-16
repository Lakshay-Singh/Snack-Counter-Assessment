/**
 * BudgetLedger — tracks spending per office per month.
 *
 * remaining = monthlyBudget − spent − pending − reserved
 *
 * "spent"    = purchases where HR has approved the claim
 * "pending"  = purchases with claims submitted but not yet resolved
 * "reserved" = amount set aside for a refill in COMMITTED state
 *
 * All amounts stay in the office's own currency. No cross-currency math.
 */

import { OfficeId, OfficeConfig, Money, addMoney, subtractMoney, zeroMoney } from "../domain";
import { ClockPort } from "../ports";

/** A month key like "2026-11" for bucketing spend. */
function monthKey(date: Date, timezone: string): string {
  // Use Intl to get the date in the office's local timezone
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

interface LedgerEntry {
  spent: Money;
  pending: Money;
  reserved: Money;
}

export class BudgetLedger {
  /** Map<"oslo:2026-11", LedgerEntry> */
  private entries = new Map<string, LedgerEntry>();

  constructor(
    private offices: Map<OfficeId, OfficeConfig>,
    private clock: ClockPort
  ) {}

  private key(officeId: OfficeId, month: string): string {
    return `${officeId}:${month}`;
  }

  private getOrCreate(officeId: OfficeId, month: string): LedgerEntry {
    const k = this.key(officeId, month);
    let entry = this.entries.get(k);
    if (!entry) {
      const currency = this.offices.get(officeId)!.currency;
      entry = {
        spent: zeroMoney(currency),
        pending: zeroMoney(currency),
        reserved: zeroMoney(currency),
      };
      this.entries.set(k, entry);
    }
    return entry;
  }

  private currentMonth(officeId: OfficeId): string {
    const office = this.offices.get(officeId)!;
    return monthKey(this.clock.now(), office.timezone);
  }

  /** How much budget remains this month (can go negative if a flagged purchase exceeded cap). */
  remaining(officeId: OfficeId): Money {
    const office = this.offices.get(officeId)!;
    const month = this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, month);
    const used = addMoney(addMoney(entry.spent, entry.pending), entry.reserved);
    return subtractMoney(office.monthlyBudget, used);
  }

  /** Can the office afford at least one minimum purchase? */
  canAffordRefill(officeId: OfficeId): boolean {
    const office = this.offices.get(officeId)!;
    const rem = this.remaining(officeId);
    return rem.amount >= office.minPurchase.amount;
  }

  /** Reserve an amount for an upcoming purchase (when a refill is committed). */
  reserve(officeId: OfficeId, amount: Money): void {
    const month = this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, month);
    entry.reserved = addMoney(entry.reserved, amount);
  }

  /** Release a reservation (e.g. when a refill is cancelled or the actual purchase is recorded). */
  releaseReservation(officeId: OfficeId, amount: Money): void {
    const month = this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, month);
    entry.reserved = subtractMoney(entry.reserved, amount);
  }

  /** Record a purchase that has been submitted to HR (moves from reserved to pending). */
  recordPurchase(officeId: OfficeId, reserved: Money, actual: Money): void {
    const month = this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, month);
    // Release the reservation and add to pending
    entry.reserved = subtractMoney(entry.reserved, reserved);
    entry.pending = addMoney(entry.pending, actual);
  }

  /** Move from pending to spent when HR approves. */
  confirmSpend(officeId: OfficeId, amount: Money): void {
    const month = this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, month);
    entry.pending = subtractMoney(entry.pending, amount);
    entry.spent = addMoney(entry.spent, amount);
  }

  /** Remove from pending when HR rejects (the money was never actually spent from budget). */
  rejectSpend(officeId: OfficeId, amount: Money): void {
    const month = this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, month);
    entry.pending = subtractMoney(entry.pending, amount);
  }

  /** Get totals for a specific office and month (for reporting). */
  getMonthTotals(officeId: OfficeId, month?: string): { spent: Money; pending: Money; reserved: Money } {
    const m = month ?? this.currentMonth(officeId);
    const entry = this.getOrCreate(officeId, m);
    return { ...entry };
  }

  /** Get the budget cap for a refill in this office (= remaining budget, capped at maxPurchase). */
  getSpendCap(officeId: OfficeId): Money {
    const office = this.offices.get(officeId)!;
    const rem = this.remaining(officeId);
    const cap = Math.min(rem.amount, office.maxPurchase.amount);
    return { amount: Math.max(cap, 0), currency: office.currency };
  }
}
