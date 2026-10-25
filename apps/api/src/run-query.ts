import { runIdSchema } from "@parallax/contracts";
import type { CheckRunRecord, RunStore } from "./store.js";

export type RunQueryApiErrorCode = "RUN_NOT_FOUND" | "RUN_STORE_ERROR";

export type RunQueryApiErrorBody = {
  error: {
    code: RunQueryApiErrorCode;
    message: string;
  };
};

export type RunQueryApplicationResponse =
  | { status: 200; body: CheckRunRecord }
  | { status: 404 | 500; body: RunQueryApiErrorBody };

export type RunQueryApplicationServiceDependencies = {
  store: RunStore;
};

/** Reads one persisted Check Run for page refresh and receipt recovery. */
export class RunQueryApplicationService {
  public constructor(
    private readonly dependencies: RunQueryApplicationServiceDependencies,
  ) {}

  public async getRun(runId: string): Promise<RunQueryApplicationResponse> {
    const parsedRunId = runIdSchema.safeParse(runId);
    if (!parsedRunId.success) {
      return notFoundResponse();
    }

    let record: CheckRunRecord | undefined;
    try {
      record = await this.dependencies.store.get(parsedRunId.data);
    } catch {
      return storeErrorResponse();
    }

    return record === undefined
      ? notFoundResponse()
      : { status: 200, body: projectLegacyArbitrumOneForkProvenance(record) };
  }
}

const LEGACY_ARBITRUM_ONE_FORK_PROVENANCE = {
  schemaVersion: 1,
  status: "UNKNOWN",
  reason: "NOT_RECORDED",
} as const;

/**
 * Historical Arbitrum One Camelot Runs predate the optional fork provenance.
 * Expose its absence as UNKNOWN on GET without persisting new claims or
 * re-querying the source/fork RPCs.
 */
function projectLegacyArbitrumOneForkProvenance(
  record: CheckRunRecord,
): CheckRunRecord {
  if (
    record.status === "started" ||
    record.intent.chainId !== 42161 ||
    record.intent.protocol !== "camelot-v3" ||
    record.result.arbitrumOneForkProvenance !== undefined
  ) {
    return record;
  }
  if (record.status === "failed") {
    return {
      ...record,
      result: {
        ...record.result,
        arbitrumOneForkProvenance: LEGACY_ARBITRUM_ONE_FORK_PROVENANCE,
      },
    };
  }
  return {
    ...record,
    result: {
      ...record.result,
      arbitrumOneForkProvenance: LEGACY_ARBITRUM_ONE_FORK_PROVENANCE,
    },
  };
}

function notFoundResponse(): {
  status: 404;
  body: RunQueryApiErrorBody;
} {
  return {
    status: 404,
    body: {
      error: {
        code: "RUN_NOT_FOUND",
        message: "The requested run does not exist",
      },
    },
  };
}

function storeErrorResponse(): {
  status: 500;
  body: RunQueryApiErrorBody;
} {
  return {
    status: 500,
    body: {
      error: {
        code: "RUN_STORE_ERROR",
        message: "The requested run could not be loaded",
      },
    },
  };
}
