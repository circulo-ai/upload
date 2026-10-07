import { describe, expect, it } from "vitest";
import { concurrentMap } from "../../../src/utils/concurrent-map";

describe("bounded batches", () => {
  it("keeps results ordered without exceeding the configured concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const output = await concurrentMap([1, 2, 3, 4, 5], 2, async (value) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 6 - value));
      active--;
      return value * 2;
    });
    expect(output).toEqual([2, 4, 6, 8, 10]);
    expect(maximum).toBe(2);
  });

  it("drains active work after failure and starts no queued work", async () => {
    const cause = new Error("provider failure");
    const started: number[] = [];
    let drained = false;
    await expect(
      concurrentMap([1, 2, 3], 2, async (value) => {
        started.push(value);
        if (value === 1) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 5));
        drained = true;
        return value;
      }),
    ).rejects.toBe(cause);
    expect(started).toEqual([1, 2]);
    expect(drained).toBe(true);
  });
});
