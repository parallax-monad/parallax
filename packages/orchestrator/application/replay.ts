import { isDeepStrictEqual } from "node:util";
import {
  type ReplayApiErrorBody,
  type ReplayFixtureId,
  type RunResult,
  replayFixtureIdSchema,
  runResultSchema,
} from "@parallax/contracts";

export interface ReplayFixtureRepository {
  load(id: ReplayFixtureId): Promise<unknown>;
}

export type ReplayApplicationResponse =
  | { status: 200; body: RunResult }
  | { status: 404 | 500; body: ReplayApiErrorBody };

export type ReplayApplicationDependencies = {
  repository: ReplayFixtureRepository;
};

/** Reads and validates a frozen recorded Run without re-executing it. */
export class ReplayApplicationService {
  public constructor(
    private readonly dependencies: ReplayApplicationDependencies,
  ) {}

  public async replay(id: string): Promise<ReplayApplicationResponse> {
    const parsedId = replayFixtureIdSchema.safeParse(id);
    if (!parsedId.success) {
      return errorResponse(404, {
        error: {
          code: "REPLAY_NOT_FOUND",
          message: "The requested recorded replay does not exist",
        },
      });
    }

    let candidate: unknown;
    try {
      candidate = await this.dependencies.repository.load(parsedId.data);
    } catch {
      return errorResponse(500, {
        error: {
          code: "REPLAY_STORE_ERROR",
          message: "The recorded replay could not be loaded",
        },
      });
    }

    const result = runResultSchema.safeParse(candidate);
    if (
      !result.success ||
      !isDeepStrictEqual(candidate, result.data) ||
      !matchesFixtureIdentity(result.data, parsedId.data)
    ) {
      return invalidFixtureResponse();
    }

    return { status: 200, body: result.data };
  }
}

function matchesFixtureIdentity(
  result: RunResult,
  fixtureId: ReplayFixtureId,
): boolean {
  return (
    result.replayMode &&
    result.evidence.length > 0 &&
    result.evidence.every(
      (item) =>
        item.isReplay && item.isMock === false && item.fixtureId === fixtureId,
    )
  );
}

function invalidFixtureResponse(): ReplayApplicationResponse {
  return errorResponse(500, {
    error: {
      code: "INVALID_REPLAY_FIXTURE",
      message: "The recorded replay does not match the trusted schema",
    },
  });
}

function errorResponse(
  status: 404 | 500,
  body: ReplayApiErrorBody,
): ReplayApplicationResponse {
  return { status, body };
}
