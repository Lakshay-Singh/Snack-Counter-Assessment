/**
 * Port for FX rates.
 * Production: daily-cached API. Tests: fixed rates.
 */

import { Currency } from "../domain";

export interface FXPort {
  /** Get exchange rate from source to target on a given date. Returns target-per-source. */
  getRate(source: Currency, target: Currency, date: Date): number;
}
