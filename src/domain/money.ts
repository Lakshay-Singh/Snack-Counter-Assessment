/**
 * Money value object — stores amount in integer minor units (øre, paise)
 * with an explicit currency tag. Prevents float rounding and accidental
 * cross-currency arithmetic.
 */

export type Currency = "NOK" | "INR";

export interface Money {
  /** Amount in minor units: øre for NOK, paise for INR */
  readonly amount: number;
  readonly currency: Currency;
}

/** Create a Money value. Throws if amount is not a safe integer. */
export function money(amount: number, currency: Currency): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(`Money amount must be an integer (minor units), got ${amount}`);
  }
  return { amount, currency };
}

/** Convenience: create Money from a major-unit number (e.g. 300 NOK → 30000 øre). */
export function fromMajor(major: number, currency: Currency): Money {
  return money(Math.round(major * 100), currency);
}

/** Convert Money back to major units for display. */
export function toMajor(m: Money): number {
  return m.amount / 100;
}

/** Add two Money values. Throws if currencies differ. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} and ${b.currency} — convert first`);
  }
  return money(a.amount + b.amount, a.currency);
}

/** Subtract b from a. Throws if currencies differ. */
export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot subtract ${a.currency} and ${b.currency} — convert first`);
  }
  return money(a.amount - b.amount, a.currency);
}

/** Zero money in a given currency. */
export function zeroMoney(currency: Currency): Money {
  return money(0, currency);
}

/** Convert money using an FX rate (target per source unit). */
export function convertMoney(m: Money, targetCurrency: Currency, rate: number): Money {
  if (m.currency === targetCurrency) return m;
  return money(Math.round(m.amount * rate), targetCurrency);
}
