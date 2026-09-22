import { describe, expect, it } from "vitest";
import type { ReceiptAnchorer, ReceiptSigner } from "./receipt-ports.js";

describe("opaque Receipt ports", () => {
  it("accept generic payloads without imposing a receipt schema", async () => {
    const signer: ReceiptSigner<{ opaque: string }, { signature: string }> = {
      async sign(receipt) {
        return { signature: receipt.opaque };
      },
    };
    const anchorer: ReceiptAnchorer<{ opaque: string }, { anchor: string }> = {
      async anchor(receipt) {
        return { anchor: receipt.opaque };
      },
    };
    const payload = { opaque: "temporary" };

    await expect(signer.sign(payload)).resolves.toEqual({
      signature: "temporary",
    });
    await expect(anchorer.anchor(payload)).resolves.toEqual({
      anchor: "temporary",
    });
  });
});
