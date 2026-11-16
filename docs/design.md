# Snack Counter Automation — Design Document

## 1. Refill Lifecycle

A refill moves through a deterministic finite state machine. Every state transition is guarded by business invariants and concurrency checks.

```
                  ┌───────────────┐
                  │    REPORTED   │
                  └───────┬───────┘
                          │ (Assigner picks eligible volunteer)
                          ▼
                  ┌───────────────┐  Decline / 4h Timeout
                  │    OFFERED    ├────────────────────────┐
                  └───────┬───────┘                        │
                          │                                ▼
       Accept (CAS) /     │                       ┌─────────────────┐
       Self-Serve Grab    │                       │  Next Volunteer │
                          ▼                       └────────┬────────┘
                  ┌───────────────┐                        │ (If all exhausted)
                  │   COMMITTED   │                        ▼
                  └───────┬───────┘               ┌─────────────────┐
                          │ 24h Timeout ─────────►│    ESCALATED    │
                          ▼ (Upload receipt)      └─────────────────┘
                  ┌───────────────┐
                  │   PURCHASED   │
                  └───────┬───────┘
                          │ (Immediate auto-submit with Idempotency Key)
                          ▼
                  ┌─────────────────┐
                  │ CLAIM_SUBMITTED │
                  └───────┬─────────┘
             HR Approved  │  HR Rejected
             ┌────────────┴────────────┐
             ▼                         ▼
      ┌────────────┐            ┌────────────┐
      │ REIMBURSED │            │  REJECTED  │
      └────────────┘            └────────────┘
```

### State Transitions & Guards

| Transition | Trigger | Guard & Side Effects |
|---|---|---|
| **→ REPORTED** | Any employee reports an empty box | **Single-active invariant:** If an open refill already exists for this office, the reported items merge into the existing task. No duplicate refill is created. |
| **→ OFFERED** | System offers task to a volunteer | Assigner selects top-ranked eligible volunteer (rotation + availability). Budget check verifies remaining budget covers office minimum purchase. |
| **→ COMMITTED** | Assigned volunteer accepts OR any eligible volunteer "grabs" | **Atomic CAS (`version` check):** Only one volunteer can claim. System reserves `maxPurchase` in the office budget ledger and marks volunteer with a pending claim. |
| **→ PURCHASED** | Volunteer uploads receipt image & amount | Within 24-hour window. Releases the temporary reservation and records the actual purchase under `pending` budget. |
| **→ CLAIM_SUBMITTED** | System automatically sends claim to external HR | Submits immediately using `refillId` as the **Idempotency Key**. The counter is now considered stocked, clearing the open refill slot. |
| **→ REIMBURSED** | HR approves reimbursement | Budget moves from `pending` to `spent`. Volunteer's pending claim flag is cleared. Refill completion recorded in fairness history. |
| **→ REJECTED** | HR rejects reimbursement | Spend released from budget ledger. Volunteer alerted and referred to coordinator. Volunteer's pending claim flag cleared. |
| **→ ESCALATED** | All volunteers decline/timeout or budget depleted | Channel notification to office coordinator for manual intervention or off-cycle approval. |

---

## 2. Core Architecture & Data Models

The system is organized around clean hexagonal architecture (Ports and Adapters) separating domain logic from external side-effects (Chat, HR, Clock, FX).

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

### Key Data Structures

- **Money Value Object:** `{ amount: number, currency: 'NOK' | 'INR' }`
  - Stored strictly in **integer minor units** (øre, paise) to eliminate floating-point rounding errors.
  - Cross-currency addition/subtraction without an explicit exchange rate throws a runtime error.
- **Refill Entity:** `{ id, officeId, state, version, assigneeId, reportedItems, purchasedItems, purchaseAmount, receiptImage, claimId, timestamps }`
  - `version`: Monotonically increasing counter for optimistic concurrency control (CAS).
- **Volunteer Profile:** `{ id, name, homeOfficeId, visitingOfficeId?, awayUntil?, payrollCurrency }`
- **Budget Ledger Entry:** `{ officeId, month, spent: Money, pending: Money, reserved: Money }`
  - Each office maintains its budget in its native currency (`NOK` for Oslo, `INR` for Bengaluru).
  - Effective available balance: `remaining = monthlyBudget − (spent + pending + reserved)`.

---

## 3. How We Solve the Four Problems

### 1. Box stays empty (Bystander Effect)
- **Direct Assignment:** Instead of broad broadcast messages where everyone assumes someone else will act, the system directs a private chat offer to exactly **one** volunteer at a time.
- **Deterministic Deadlines:** The volunteer has a **4-hour window** to accept or decline.
- **Automatic Handoff:** If the volunteer declines or lets the timer expire, the system immediately cascades the offer to the next ranked candidate. If all candidates are exhausted, it alerts the office coordinator.

### 2. Double Buying & Race Conditions
- **Single Open Refill Invariant:** Each office can have at most one active refill between `REPORTED` and `PURCHASED`. Repeated reports of an empty box merge into the active refill rather than spawning new tasks.
- **Atomic Compare-And-Set (CAS):** Accepting an offer requires matching the entity's current `version`. If two volunteers attempt to claim the refill simultaneously (e.g., via chat button clicks or self-serve grab), only one transaction succeeds; the other receives an immediate "already claimed" response.

### 3. Unfair Burden & Slow Payback
- **Fair Rotation Algorithm:** Candidates are ranked using a multi-factor priority:
  1. *Unburdened first:* Volunteers with an open/pending HR reimbursement claim are deprioritized.
  2. *Least frequent:* Fewest refills completed within a rolling 90-day window.
  3. *Least recent:* Longest time elapsed since their previous refill.
- **Availability Aware:** Volunteers marked on leave or working away (`awayUntil > now`) are automatically bypassed.
- **Eliminating Employee Lag:** While HR's internal 1–10 day approval is external, we eliminate volunteer submission delay by **auto-submitting the reimbursement claim the moment the receipt is uploaded**.

### 4. Spend Tracking & Snack Intelligence
- **Real-Time Budget Ledger:** Open commitments reserve maximum spend. Actual purchases update pending liabilities.
- **Consolidated Multi-Currency Reporting:**
  - Oslo budget stays in `NOK`; Bengaluru stays in `INR`.
  - For management's combined report, all expenses are converted into `NOK` using the **historical exchange rate on the purchase date**.
  - Distinguishes settled spend from pending approvals.
- **Snack Consumption Analytics (Pragmatic Proxy):** Reporters tag what items ran out (`reportedItems`), and purchasers log what was bought (`purchasedItems`). Aggregating this over time reveals snack turnover rates without intrusive sensors.

---

## 4. Key Design Decisions & Trade-Offs

| Decision | Chosen Approach | Alternative Considered | Rationale |
|---|---|---|---|
| **Cross-Currency Budgets** | Budgets kept strictly in local currency; FX only applied at reporting time. | Converting all budgets to a single global currency. | Isolates office operations from daily exchange rate volatility. A visitor in Oslo charges Oslo's budget in NOK regardless of their home payroll currency. |
| **Budget Commitments** | Full `maxPurchase` reserved at `COMMITTED` stage. | Deducting only upon receipt upload. | Prevents simultaneous purchases from overshooting the monthly limit if budget is nearly depleted. |
| **Availability Tracking** | Self-declared status (`awayUntil`) via simple chat command. | HR/Calendar/Badge-swipe API integrations. | Radical simplicity. Zero external enterprise integrations needed; zero friction for hybrid teams. |
| **HR Idempotency** | `refillId` serves as the HR `idempotencyKey`. | Generating unique claim IDs on each retry. | Guarantees that network retries or webhooks will never create duplicate employee claims in HR. |
| **Timezone Management** | Monthly ledger cycles align with each office's local calendar (IANA timezones: `Europe/Oslo` and `Asia/Kolkata`). | Single UTC month boundary. | A purchase on Oct 31 at 20:00 UTC is November in Bengaluru (01:30 IST) but October in Oslo (21:00 CET). Spend matches the office's local accounting period. |

---

## 5. Deliberately Out of Scope (What We Do Not Build)

1. **Receipt OCR & Automated Parsing:**
   - *Why not:* External HR already conducts human audit and receipt verification. Adding ML/OCR parsing inside this service introduces error rates and false rejections with zero business value.
2. **IoT Counter Sensors & Smart Scales:**
   - *Why not:* High hardware expense, calibration overhead, and battery/network maintenance for ~35 volunteers across two offices. A 1-click chat report solves 95% of the problem at 0% hardware cost.
3. **Per-Item Inventory Management System:**
   - *Why not:* The snack counter is an informal office perk, not a retail store. Tracking barcode scans or individual candy bars creates unreasonable volunteer friction.
4. **Standalone Web Portal / Mobile App:**
   - *Why not:* Employees already live in the company chat tool (Slack/Teams). A chat-bot interface ensures immediate adoption without onboarding or extra authentication layers.
5. **Real Database Infrastructure:**
   - *Why not:* Modeled cleanly with repository/port patterns. In-memory adapters satisfy evaluation testing; Postgres/Prisma can be swapped behind the port without modifying domain code.

---

## 6. Strategic Recommendation: Corporate Cards

While this software automates notifications, rotation, budget tracking, and claim submissions, **the core root cause of volunteer hesitation is requiring employees to front their personal funds for company expenses**.

**Recommendation:** Provide each office coordinator with a prepaid virtual or physical corporate debit card (e.g. Pleo, Ramp, Brex) restricted to grocery and supermarket merchant categories:
- Eliminates employee out-of-pocket stress entirely.
- Removes reliance on the 1–10 day external HR reimbursement cycle.
- Automatically captures digital receipts at POS swipe, feeding directly into the automated ledger.
