/**
 * Shared test fixtures — creates a fully wired system with fakes.
 */

import { OfficeId, OfficeConfig, Volunteer, fromMajor } from "../src/domain";
import { FakeChat } from "../src/adapters/fake-chat";
import { FakeHR } from "../src/adapters/fake-hr";
import { FakeClock } from "../src/adapters/fake-clock";
import { FakeFX } from "../src/adapters/fake-fx";
import { BudgetLedger } from "../src/services/budget-ledger";
import { Assigner } from "../src/services/assigner";
import { RefillService } from "../src/services/refill-service";
import { Reporter } from "../src/services/reporter";

// ─── Office Configs ──────────────────────────────────────────────────

export const OSLO: OfficeConfig = {
  id: "oslo",
  currency: "NOK",
  monthlyBudget: fromMajor(6000, "NOK"),    // 600_000 øre
  minPurchase: fromMajor(300, "NOK"),        // 30_000 øre
  maxPurchase: fromMajor(1200, "NOK"),       // 120_000 øre
  timezone: "Europe/Oslo",
};

export const BENGALURU: OfficeConfig = {
  id: "bengaluru",
  currency: "INR",
  monthlyBudget: fromMajor(15000, "INR"),   // 1_500_000 paise
  minPurchase: fromMajor(500, "INR"),        // 50_000 paise
  maxPurchase: fromMajor(3000, "INR"),       // 300_000 paise
  timezone: "Asia/Kolkata",
};

export function createOfficeMap(): Map<OfficeId, OfficeConfig> {
  return new Map<OfficeId, OfficeConfig>([
    ["oslo", OSLO],
    ["bengaluru", BENGALURU],
  ]);
}

// ─── Volunteers ──────────────────────────────────────────────────────

export function createOsloVolunteers(count = 3): Volunteer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `oslo-v${i + 1}`,
    name: `Oslo Volunteer ${i + 1}`,
    homeOfficeId: "oslo" as OfficeId,
    payrollCurrency: "NOK" as const,
  }));
}

export function createBengaluruVolunteers(count = 3): Volunteer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `blr-v${i + 1}`,
    name: `Bengaluru Volunteer ${i + 1}`,
    homeOfficeId: "bengaluru" as OfficeId,
    payrollCurrency: "INR" as const,
  }));
}

// ─── Full System ─────────────────────────────────────────────────────

export interface TestSystem {
  clock: FakeClock;
  chat: FakeChat;
  hr: FakeHR;
  fx: FakeFX;
  budget: BudgetLedger;
  assigner: Assigner;
  refillService: RefillService;
  reporter: Reporter;
  offices: Map<OfficeId, OfficeConfig>;
  volunteers: Volunteer[];
}

export function createTestSystem(opts?: {
  volunteers?: Volunteer[];
  startDate?: Date;
}): TestSystem {
  const offices = createOfficeMap();
  const volunteers = opts?.volunteers ?? [
    ...createOsloVolunteers(),
    ...createBengaluruVolunteers(),
  ];

  const clock = new FakeClock(opts?.startDate ?? new Date("2026-11-01T09:00:00Z"));
  const chat = new FakeChat(() => clock.now());
  const hr = new FakeHR("auto-approve");
  const fx = new FakeFX();

  const budget = new BudgetLedger(offices, clock);
  const assigner = new Assigner(clock);

  const refillService = new RefillService({
    offices,
    volunteers,
    chat,
    hr,
    clock,
    assigner,
    budget,
  });

  const reporter = new Reporter(offices, fx);

  return { clock, chat, hr, fx, budget, assigner, refillService, reporter, offices, volunteers };
}
