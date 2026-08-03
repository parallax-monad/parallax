import { ReplayApplicationService } from "@parallax/orchestrator/application";
import { createReplayApp } from "../routes/replay.js";
import { FileReplayFixtureRepository } from "../storage/replay-fixture-repository.js";

/** Composes the Replay vertical slice without introducing a production server. */
export function createRecordedReplayApp() {
  return createReplayApp(
    new ReplayApplicationService({
      repository: new FileReplayFixtureRepository(),
    }),
  );
}
