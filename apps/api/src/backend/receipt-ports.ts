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
