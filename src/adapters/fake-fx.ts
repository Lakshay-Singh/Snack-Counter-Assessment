/**
 * Fixed FX rates for testing.
 * In production, this would fetch from an API and cache daily.
 */

import { Currency } from "../domain";
import { FXPort } from "../ports/fx-port";

export class FakeFX implements FXPort {
  private rates: Map<string, number>;

  constructor(rates?: Record<string, number>) {
    this.rates = new Map(Object.entries(rates ?? {
      // Default: 1 NOK ≈ 12 INR (approximate mid-2026 rate)
      "INR_NOK": 0.0833,   // 1 INR = 0.0833 NOK
      "NOK_INR": 12.0,     // 1 NOK = 12 INR
      "NOK_NOK": 1.0,
      "INR_INR": 1.0,
    }));
  }

  getRate(source: Currency, target: Currency, _date: Date): number {
    if (source === target) return 1.0;
    const key = `${source}_${target}`;
    const rate = this.rates.get(key);
    if (rate === undefined) {
      throw new Error(`No FX rate configured for ${source} → ${target}`);
    }
    return rate;
  }

  /** Set a specific rate for testing */
  setRate(source: Currency, target: Currency, rate: number): void {
    this.rates.set(`${source}_${target}`, rate);
  }
}
