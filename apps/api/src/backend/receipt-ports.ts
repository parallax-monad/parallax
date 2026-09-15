/**
 * Temporary opaque ports for backend-attested Decision Receipts.
 *
 * These interfaces intentionally do not define Receipt fields, hash algorithms,
 * signatures, chain addresses, or anchoring events. A later Contract/Backend
 * work package can specialize the generic payloads without changing adapter or
 * Core boundaries.
 */
export type ReceiptOperationResult<Value> = Value | Promise<Value>;

export interface ReceiptSigner<Receipt = unknown, Signature = unknown> {
  sign(receipt: Receipt): ReceiptOperationResult<Signature>;
}

export interface ReceiptAnchorer<Receipt = unknown, Anchor = unknown> {
  anchor(receipt: Receipt): ReceiptOperationResult<Anchor>;
}

export type ReceiptLifecycleStatus =
  | "not_configured"
  | "pending"
  | "signed"
  | "anchored"
  | "failed"
  | "timed_out";

export type ReceiptStageStatus =
  | "not_configured"
  | "pending"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "skipped";

export type ReceiptStageSnapshot<Value = unknown> = {
  readonly status: ReceiptStageStatus;
  readonly value?: Value;
  readonly error?: unknown;
};

export type ReceiptLifecycleSnapshot<Signature = unknown, Anchor = unknown> = {
  readonly status: ReceiptLifecycleStatus;
  readonly signing: ReceiptStageSnapshot<Signature>;
  readonly anchoring: ReceiptStageSnapshot<Anchor>;
  readonly error?: unknown;
};

export type ReceiptLifecycleHandle<Signature = unknown, Anchor = unknown> = {
  readonly status: ReceiptLifecycleStatus;
  readonly completion: Promise<ReceiptLifecycleSnapshot<Signature, Anchor>>;
  snapshot(): ReceiptLifecycleSnapshot<Signature, Anchor>;
};

export type ReceiptLifecycleOptions<
  Receipt = unknown,
  Signature = unknown,
  Anchor = unknown,
> = {
  readonly receipt?: Receipt;
  readonly buildReceipt?: () => ReceiptOperationResult<Receipt>;
  readonly signer?: ReceiptSigner<Receipt, Signature>;
  readonly anchorer?: ReceiptAnchorer<Receipt, Anchor>;
  /** Timeout applied independently to signing and anchoring. */
  readonly timeoutMs?: number;
};

const defaultReceiptTimeoutMs = 5_000;

/** Error retained in the observable lifecycle when an adapter exceeds its timeout. */
export class ReceiptTimeoutError extends Error {
  public readonly name = "ReceiptTimeoutError";

  public constructor(stage: "signing" | "anchoring", timeoutMs: number) {
    super(`Receipt ${stage} timed out after ${timeoutMs}ms`);
  }
}

/**
 * Starts a controlled, observable receipt operation after the caller has its
 * Decision. The returned completion promise owns every background rejection;
 * callers can await it without allowing adapter failures to become unhandled.
 */
export function createReceiptLifecycle<
  Receipt = unknown,
  Signature = unknown,
  Anchor = unknown,
>(
  options: ReceiptLifecycleOptions<Receipt, Signature, Anchor>,
): ReceiptLifecycleHandle<Signature, Anchor> {
  const hasReceiptSource =
    options.receipt !== undefined || options.buildReceipt !== undefined;
  const hasConfiguredLifecycle =
    hasReceiptSource &&
    (options.signer !== undefined || options.anchorer !== undefined);
  const initial = hasConfiguredLifecycle
    ? pendingSnapshot<Signature, Anchor>(options)
    : notConfiguredSnapshot<Signature, Anchor>();
  const lifecycle = new ReceiptLifecycle<Receipt, Signature, Anchor>(
    options,
    initial,
  );
  lifecycle.start();
  return lifecycle;
}

class ReceiptLifecycle<Receipt, Signature, Anchor>
  implements ReceiptLifecycleHandle<Signature, Anchor>
{
  private current: ReceiptLifecycleSnapshot<Signature, Anchor>;
  private readonly options: ReceiptLifecycleOptions<Receipt, Signature, Anchor>;
  private readonly timeoutMs: number;
  private _completion: Promise<ReceiptLifecycleSnapshot<Signature, Anchor>>;

  public constructor(
    options: ReceiptLifecycleOptions<Receipt, Signature, Anchor>,
    initial: ReceiptLifecycleSnapshot<Signature, Anchor>,
  ) {
    this.options = options;
    this.current = initial;
    this._completion = Promise.resolve(initial);
    const timeoutMs = options.timeoutMs ?? defaultReceiptTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError("Receipt timeout must be a non-negative number");
    }
    this.timeoutMs = timeoutMs;
  }

  public get status(): ReceiptLifecycleStatus {
    return this.current.status;
  }

  public get completion(): Promise<
    ReceiptLifecycleSnapshot<Signature, Anchor>
  > {
    return this._completion;
  }

  public snapshot(): ReceiptLifecycleSnapshot<Signature, Anchor> {
    return this.current;
  }

  public start(): void {
    if (this.current.status === "not_configured") return;
    this._completion = this.run();
  }

  private async run(): Promise<ReceiptLifecycleSnapshot<Signature, Anchor>> {
    try {
      const receipt = (await (this.options.buildReceipt?.() ??
        this.options.receipt)) as Receipt;

      if (this.options.signer !== undefined) {
        const signer = this.options.signer;
        this.current = {
          ...this.current,
          signing: { status: "pending" },
        };
        const signed = await settleWithTimeout(
          () => signer.sign(receipt),
          this.timeoutMs,
          "signing",
        );
        if (signed.status !== "succeeded") {
          this.current = {
            status: signed.status === "timed_out" ? "timed_out" : "failed",
            signing: signed,
            anchoring: { status: "skipped" },
            error: signed.error,
          };
          return this.current;
        }
        this.current = {
          ...this.current,
          status: this.options.anchorer === undefined ? "signed" : "pending",
          signing: signed,
        };
      }

      if (this.options.anchorer !== undefined) {
        const anchorer = this.options.anchorer;
        this.current = {
          ...this.current,
          status: "pending",
          anchoring: { status: "pending" },
        };
        const anchored = await settleWithTimeout(
          () => anchorer.anchor(receipt),
          this.timeoutMs,
          "anchoring",
        );
        if (anchored.status !== "succeeded") {
          this.current = {
            status: anchored.status === "timed_out" ? "timed_out" : "failed",
            signing: this.current.signing,
            anchoring: anchored,
            error: anchored.error,
          };
          return this.current;
        }
        this.current = {
          ...this.current,
          status: "anchored",
          anchoring: anchored,
        };
      }

      return this.current;
    } catch (error) {
      this.current = {
        status: "failed",
        signing:
          this.options.signer === undefined
            ? { status: "not_configured" }
            : { status: "failed", error },
        anchoring:
          this.options.anchorer === undefined
            ? { status: "not_configured" }
            : { status: "skipped" },
        error,
      };
      return this.current;
    }
  }
}

type SettledStage<Value> = ReceiptStageSnapshot<Value> &
  ({ status: "succeeded" } | { status: "failed" | "timed_out" });

async function settleWithTimeout<Value>(
  operation: () => ReceiptOperationResult<Value>,
  timeoutMs: number,
  stage: "signing" | "anchoring",
): Promise<SettledStage<Value>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const operationPromise = Promise.resolve().then(operation);

  return new Promise((resolve) => {
    const finish = (result: SettledStage<Value>): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    operationPromise.then(
      (value) => finish({ status: "succeeded", value }),
      (error: unknown) => finish({ status: "failed", error }),
    );
    timer = setTimeout(
      () =>
        finish({
          status: "timed_out",
          error: new ReceiptTimeoutError(stage, timeoutMs),
        }),
      timeoutMs,
    );
  });
}

function pendingSnapshot<Signature, Anchor>(
  options: ReceiptLifecycleOptions<unknown, Signature, Anchor>,
): ReceiptLifecycleSnapshot<Signature, Anchor> {
  return {
    status: "pending",
    signing:
      options.signer === undefined
        ? { status: "not_configured" }
        : { status: "pending" },
    anchoring:
      options.anchorer === undefined
        ? { status: "not_configured" }
        : { status: "pending" },
  };
}

function notConfiguredSnapshot<Signature, Anchor>(): ReceiptLifecycleSnapshot<
  Signature,
  Anchor
> {
  return {
    status: "not_configured",
    signing: { status: "not_configured" },
    anchoring: { status: "not_configured" },
  };
}
