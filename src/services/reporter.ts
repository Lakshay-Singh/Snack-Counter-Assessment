/**
 * Reporter — generates monthly spending reports.
 *
 * Per-office totals stay in the office's own currency.
 * The combined total is converted to NOK using the FX rate on the purchase date.
 */

import {
  OfficeId, OfficeConfig, Refill, RefillState, Money,
  zeroMoney, addMoney, convertMoney, toMajor,
} from "../domain";
import { FXPort } from "../ports";

export interface OfficeReport {
  officeId: OfficeId;
  /** Total spent in the office's own currency (approved claims) */
  spent: Money;
  /** Total pending in the office's own currency (submitted but not resolved) */
  pending: Money;
  refillCount: number;
}

export interface MonthlyReport {
  month: string;
  offices: OfficeReport[];
  /** Combined total in NOK (the reporting currency) */
  combinedTotalNOK: Money;
  /** Combined pending in NOK */
  combinedPendingNOK: Money;
}

export class Reporter {
  constructor(
    private offices: Map<OfficeId, OfficeConfig>,
    private fx: FXPort
  ) {}

  /**
   * Generate a monthly report from completed refills.
   * @param refills All refills in the system
   * @param month Month key like "2026-11"
   */
  generateReport(refills: Refill[], month: string): MonthlyReport {
    const officeReports: OfficeReport[] = [];
    let combinedTotalNOK = zeroMoney("NOK");
    let combinedPendingNOK = zeroMoney("NOK");

    for (const [officeId, office] of this.offices) {
      let spent = zeroMoney(office.currency);
      let pending = zeroMoney(office.currency);
      let refillCount = 0;

      const officeRefills = refills.filter((r) => r.officeId === officeId);

      for (const refill of officeRefills) {
        if (!refill.purchaseAmount || !refill.purchasedAt) continue;

        // Check if this purchase falls in the target month
        const purchaseMonth = this.getMonthKey(refill.purchasedAt, office.timezone);
        if (purchaseMonth !== month) continue;

        if (refill.state === RefillState.REIMBURSED) {
          spent = addMoney(spent, refill.purchaseAmount);
          refillCount++;
        } else if (
          refill.state === RefillState.CLAIM_SUBMITTED ||
          refill.state === RefillState.PURCHASED
        ) {
          pending = addMoney(pending, refill.purchaseAmount);
          refillCount++;
        }
        // REJECTED claims are not counted as spend
      }

      officeReports.push({ officeId, spent, pending, refillCount });

      // Convert to NOK for the combined report
      // For each refill, use the FX rate on its purchase date
      for (const refill of officeRefills) {
        if (!refill.purchaseAmount || !refill.purchasedAt) continue;
        const purchaseMonth = this.getMonthKey(refill.purchasedAt, office.timezone);
        if (purchaseMonth !== month) continue;

        const rate = this.fx.getRate(office.currency, "NOK", refill.purchasedAt);
        const amountInNOK = convertMoney(refill.purchaseAmount, "NOK", rate);

        if (refill.state === RefillState.REIMBURSED) {
          combinedTotalNOK = addMoney(combinedTotalNOK, amountInNOK);
        } else if (
          refill.state === RefillState.CLAIM_SUBMITTED ||
          refill.state === RefillState.PURCHASED
        ) {
          combinedPendingNOK = addMoney(combinedPendingNOK, amountInNOK);
        }
      }
    }

    return {
      month,
      offices: officeReports,
      combinedTotalNOK,
      combinedPendingNOK,
    };
  }

  /** Format report as a human-readable string. */
  formatReport(report: MonthlyReport): string {
    const lines: string[] = [
      `📊 Monthly Snack Spending Report — ${report.month}`,
      `${"─".repeat(50)}`,
    ];

    for (const office of report.offices) {
      lines.push(
        `${office.officeId.toUpperCase()}: ` +
        `${toMajor(office.spent)} ${office.spent.currency} spent (${office.refillCount} refills)` +
        (office.pending.amount > 0
          ? ` + ${toMajor(office.pending)} ${office.pending.currency} pending`
          : "")
      );
    }

    lines.push(`${"─".repeat(50)}`);
    lines.push(
      `COMBINED: ${toMajor(report.combinedTotalNOK)} NOK spent` +
      (report.combinedPendingNOK.amount > 0
        ? ` + ${toMajor(report.combinedPendingNOK)} NOK pending`
        : "")
    );

    return lines.join("\n");
  }

  private getMonthKey(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(date);

    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    return `${year}-${month}`;
  }
}
