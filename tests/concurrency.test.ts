/**
 * Tests for concurrency control:
 *   - Two people cannot both commit to the same refill (CAS)
 *   - Only one open refill per office
 */

import { RefillState, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Concurrency Control", () => {
  it("two people cannot both commit to the same refill (CAS)", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    expect(refill.state).toBe(RefillState.OFFERED);
    const offeredVersion = refill.version;
    const assignee = refill.assigneeId!;

    // Person A accepts (the assigned volunteer)
    const acceptA = await sys.refillService.acceptRefill(refill.id, assignee, offeredVersion);
    expect(acceptA).toBe(true);
    expect(refill.state).toBe(RefillState.COMMITTED);

    // Person B tries to accept with the OLD version — must fail
    const acceptB = await sys.refillService.acceptRefill(refill.id, "oslo-v2", offeredVersion);
    expect(acceptB).toBe(false);

    // Refill is still committed to person A
    expect(refill.assigneeId).toBe(assignee);
    expect(refill.state).toBe(RefillState.COMMITTED);
  });

  it("second accept with current version but wrong state also fails", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    const assignee = refill.assigneeId!;

    // Accept once
    await sys.refillService.acceptRefill(refill.id, assignee, refill.version);
    expect(refill.state).toBe(RefillState.COMMITTED);

    // Try to accept again with the new version — wrong state
    const secondAccept = await sys.refillService.acceptRefill(refill.id, "oslo-v2", refill.version);
    expect(secondAccept).toBe(false);
  });

  it("only one open refill per office", async () => {
    const sys = createTestSystem();

    const refill1 = await sys.refillService.reportEmpty("oslo", "person-A");
    const refill2 = await sys.refillService.reportEmpty("oslo", "person-B");

    // Both point to the same refill
    expect(refill1.id).toBe(refill2.id);
  });

  it("different offices can have simultaneous open refills", async () => {
    const sys = createTestSystem();

    const osloRefill = await sys.refillService.reportEmpty("oslo", "person-A");
    const blrRefill = await sys.refillService.reportEmpty("bengaluru", "person-B");

    // Different refills
    expect(osloRefill.id).not.toBe(blrRefill.id);
    expect(osloRefill.officeId).toBe("oslo");
    expect(blrRefill.officeId).toBe("bengaluru");
  });
});
