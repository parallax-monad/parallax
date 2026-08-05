/**
 * Timer bookkeeping for the simulated check pipeline.
 *
 * Extracted from the wallet screen so cancellation is testable without a DOM:
 * the demo advances one stage per tick and settles one tick later, and every
 * handle must be cancellable when the user discards a run or the screen
 * unmounts mid-flight.
 */

export type TimerHandle = number;

export type TimerApi = {
  setTimeout: (callback: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

const windowTimers: TimerApi = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export type StageRunOptions = {
  stageCount: number;
  stageMs: number;
  onStage: (stage: number) => void;
  onSettle: () => void;
};

export type StageScheduler = {
  run: (options: StageRunOptions) => void;
  cancel: () => void;
  readonly pendingCount: number;
};

export function createStageScheduler(
  timers: TimerApi = windowTimers,
): StageScheduler {
  const handles: TimerHandle[] = [];

  const cancel = () => {
    for (const handle of handles) timers.clearTimeout(handle);
    handles.length = 0;
  };

  return {
    // Starting a run always supersedes the previous one, so a rerun can never
    // leave an older pipeline still advancing the stage indicator.
    run({ stageCount, stageMs, onStage, onSettle }) {
      cancel();
      for (let index = 1; index <= stageCount; index += 1) {
        handles.push(timers.setTimeout(() => onStage(index), stageMs * index));
      }
      handles.push(timers.setTimeout(onSettle, stageMs * (stageCount + 1)));
    },
    cancel,
    get pendingCount() {
      return handles.length;
    },
  };
}
