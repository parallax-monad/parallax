import { describe, expect, test } from "vitest";
import { createStageScheduler, type TimerApi } from "./stageScheduler";

/** Manual clock so ordering and cancellation are observable without a DOM. */
function fakeTimers() {
  let nextHandle = 1;
  const scheduled = new Map<number, { callback: () => void; at: number }>();
  const api: TimerApi = {
    setTimeout(callback, ms) {
      const handle = nextHandle++;
      scheduled.set(handle, { callback, at: ms });
      return handle;
    },
    clearTimeout(handle) {
      scheduled.delete(handle);
    },
  };

  return {
    api,
    get activeCount() {
      return scheduled.size;
    },
    /** Fires every callback due at or before `ms`, in scheduled order. */
    advanceTo(ms: number) {
      for (const [handle, entry] of [...scheduled].sort(
        (a, b) => a[1].at - b[1].at,
      )) {
        if (entry.at > ms) continue;
        scheduled.delete(handle);
        entry.callback();
      }
    },
  };
}

function options(
  stages: number[],
  settled: { value: boolean },
  stageCount = 5,
) {
  return {
    stageCount,
    stageMs: 100,
    onStage: (stage: number) => stages.push(stage),
    onSettle: () => {
      settled.value = true;
    },
  };
}

describe("createStageScheduler", () => {
  test("advances one stage per tick and settles after the last", () => {
    const timers = fakeTimers();
    const stages: number[] = [];
    const settled = { value: false };

    createStageScheduler(timers.api).run(options(stages, settled));
    timers.advanceTo(600);

    expect(stages).toEqual([1, 2, 3, 4, 5]);
    expect(settled.value).toBe(true);
  });

  test("cancel stops every pending stage and the settle callback", () => {
    const timers = fakeTimers();
    const stages: number[] = [];
    const settled = { value: false };
    const scheduler = createStageScheduler(timers.api);

    scheduler.run(options(stages, settled));
    timers.advanceTo(200);
    scheduler.cancel();
    timers.advanceTo(10_000);

    expect(stages).toEqual([1, 2]);
    expect(settled.value).toBe(false);
    expect(timers.activeCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });

  test("a rerun supersedes the previous run instead of interleaving", () => {
    const timers = fakeTimers();
    const first: number[] = [];
    const firstSettled = { value: false };
    const second: number[] = [];
    const secondSettled = { value: false };
    const scheduler = createStageScheduler(timers.api);

    scheduler.run(options(first, firstSettled));
    timers.advanceTo(100);
    scheduler.run(options(second, secondSettled));
    timers.advanceTo(10_000);

    expect(first).toEqual([1]);
    expect(firstSettled.value).toBe(false);
    expect(second).toEqual([1, 2, 3, 4, 5]);
    expect(secondSettled.value).toBe(true);
  });

  test("cancel is safe to call when nothing is pending", () => {
    const timers = fakeTimers();
    const scheduler = createStageScheduler(timers.api);

    expect(() => {
      scheduler.cancel();
      scheduler.cancel();
    }).not.toThrow();
    expect(timers.activeCount).toBe(0);
  });
});
