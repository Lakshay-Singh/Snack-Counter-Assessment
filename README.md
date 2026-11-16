# Snack Counter Automation - Framsikt Product Engineer Assessment

Automated snack counter restocking, volunteer fairness rotation, and budget tracking for Framsikt's **Oslo** and **Bengaluru** offices.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run all automated test suites (51 tests across 11 suites)
npm test

# 3. Run test coverage
npm run test:coverage
```

---

## Deliverables Summary

1. **Design Document (1–2 pages):**
   - Located at [`docs/design.md`](./docs/design.md)
   - Covers: State machine, components, resolving the four problems, trade-offs, out-of-scope rationale, and strategic corporate card recommendation.
2. **Core Logic:**
   - [`src/domain/`](./src/domain): Money value object in integer minor units (øre/paise), domain entities, and invariants.
   - [`src/services/`](./src/services): `RefillService` (state machine & concurrency), `Assigner` (fair rotation), `BudgetLedger` (spend & reservation tracking), `Reporter` (multi-currency aggregation).
   - [`src/ports/`](./src/ports) & [`src/adapters/`](./src/adapters): Hexagonal ports and simulated stand-ins (`FakeChat`, `FakeHR`, `FakeClock`, `FakeFX`).
3. **Automated Tests:**
   - 10 test suites covering all rules, concurrency, timezone boundaries, and visitors.

---

## System Architecture

```
                      ┌─────────────────────────────────────┐
                      │            RefillService            │
                      │     (Lifecycle & Concurrency)       │
                      └───┬─────────────┬─────────────┬─────┘
                          │             │             │
              ┌───────────┴─┐     ┌─────┴───────┐   ┌─┴─────────────┐
              │  Assigner   │     │BudgetLedger │   │   Reporter    │
              │ (Rotation)  │     │(Reservations│   │(FX Conversion)│
              └─────────────┘     └─────────────┘   └───────────────┘
                     │                   │                  │
       ══════════════╪═══════════════════╪══════════════════╪══════════════ (Ports)
                     │                   │                  │
              ┌──────┴──────┐     ┌──────┴──────┐   ┌───────┴───────┐
              │  ChatPort   │     │   HRPort    │   │  FX / Clock   │
              │ (Fake/Slack)│     │ (Fake / HR) │   │ (Fake/System) │
              └─────────────┘     └─────────────┘   └───────────────┘
```

---

## Key Solutions to the Four Problems

| Problem | Solution | Proven By Tests |
|---|---|---|
| **1. Box stays empty (Bystander effect)** | System targets 1 specific volunteer with a 4h countdown; auto-reassigns to the next candidate on timeout or decline. | `tests/refill-lifecycle.test.ts` |
| **2. Double buying & race conditions** | At most 1 active refill per office; duplicate empty reports merge into the existing task. Commitments use atomic Compare-And-Set (`version`). | `tests/concurrency.test.ts` |
| **3. Unfair burden & slow payback** | Assigner prioritizes volunteers without pending HR claims, then fewest refills in 90 days. Claims auto-submit to HR immediately upon receipt upload. | `tests/assigner.test.ts`, `tests/claim-service.test.ts` |
| **4. Spend tracking & snack data** | Budget ledger tracks `spent + pending + reserved` in office local currency. Monthly management report converts to NOK using purchase-date FX. | `tests/budget-ledger.test.ts`, `tests/reporter.test.ts` |

---

## Project Structure

```
snack-counter-assessment/
├── docs/
│   └── design.md                 # 1-2 page design document
├── src/
│   ├── domain/
│   │   ├── money.ts              # Integer minor units Money value object (no floats)
│   │   ├── types.ts              # Refill, Volunteer, Claim, OfficeConfig
│   │   └── index.ts
│   ├── ports/                    # Hexagonal port interfaces
│   │   ├── chat-port.ts
│   │   ├── hr-port.ts
│   │   ├── clock-port.ts
│   │   ├── fx-port.ts
│   │   └── index.ts
│   ├── adapters/                 # Simulated stand-ins for external systems
│   │   ├── fake-chat.ts          # Records messages for assertion
│   │   ├── fake-hr.ts            # Idempotent HR mock with configurable behavior
│   │   ├── fake-clock.ts         # Controllable test clock (no real-time delays)
│   │   ├── fake-fx.ts            # Configurable historical exchange rates
│   │   └── index.ts
│   └── services/                 # Core domain business logic
│       ├── refill-service.ts     # Lifecycle orchestration & concurrency control
│       ├── assigner.ts           # Fair rotation & availability engine
│       ├── budget-ledger.ts      # Budget tracking with pre-allocations/reservations
│       ├── reporter.ts           # Monthly local & combined multi-currency report
│       └── index.ts
├── tests/
│   ├── helpers.ts                # Test harness & fixtures
│   ├── refill-lifecycle.test.ts  # Full lifecycle transitions & timeouts
│   ├── concurrency.test.ts       # CAS commit collisions & single refill invariant
│   ├── assigner.test.ts          # Fairness rotation & absence handling
│   ├── budget-ledger.test.ts     # Pre-allocations, caps, and balance tracking
│   ├── claim-service.test.ts     # HR idempotency, retries, approval/rejection
│   ├── visitor.test.ts           # Visiting employees & currency mismatch handling
│   ├── timezone.test.ts          # Month boundary calculation in local office time
│   ├── reporter.test.ts          # Multi-currency aggregation with purchase-date FX
│   ├── money.test.ts             # Integer safety & cross-currency guards
│   └── edge-cases.test.ts        # Self-serve grabs, invalid state guards, queries
├── package.json
├── tsconfig.json
└── jest.config.ts
```

---

## Test Suites Overview (51 Tests across 11 Suites)

1. `tests/refill-lifecycle.test.ts`:
   - Happy path: `REPORTED` → `OFFERED` → `COMMITTED` → `PURCHASED` → `CLAIM_SUBMITTED` → `REIMBURSED`
   - Decline and timeout reassignments
   - Volunteer pool exhaustion (`ESCALATED`)
   - Merging duplicate empty reports
2. `tests/concurrency.test.ts`:
   - Verifies two volunteers cannot both commit to the same refill (CAS optimistic locking)
   - Only one open refill per office invariant
3. `tests/assigner.test.ts`:
   - Ranking by rolling 90-day refill counts and tie-breaking
   - Deprioritizing volunteers with outstanding unpaid claims
   - Bypassing volunteers on leave or away
4. `tests/budget-ledger.test.ts`:
   - Enforcing reservation amounts so rapid requests never exceed monthly budget
   - Releasing reservations upon purchase or cancellation
5. `tests/visitor.test.ts`:
   - Cross-office visits (e.g. Bengaluru employee in Oslo): Oslo budget charged in NOK, claim logged under employee ID for HR payout in INR
6. `tests/timezone.test.ts`:
   - Local month boundaries: A purchase on Oct 31 at 20:00 UTC falls in October for Oslo (UTC+1) but November for Bengaluru (UTC+5:30)
7. `tests/claim-service.test.ts`:
   - Idempotency guarantees preventing duplicate reimbursements during retries
   - Handling transient HR outages and claim rejections
8. `tests/reporter.test.ts`:
   - Per-office reporting in native currency; combined management report in NOK using purchase-date FX
9. `tests/money.test.ts`:
   - Strict integer minor unit validation, preventing floating point inaccuracy and cross-currency arithmetic
10. `tests/edge-cases.test.ts`:
    - Self-serve grab workflows and state guard exceptions
11. `tests/fixes.test.ts`:
    - Dynamic budget cap fluctuation resilience (exact reservation release)
    - Cross-month HR approval ledger alignment
    - Escalation slot cleanup ensuring future refills are unblocked
