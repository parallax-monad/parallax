import { describe, expect, it } from "vitest";
import {
  CAMELOT_V3_PROTOCOL_ID,
  protocolIdSchema,
  protocolSchema,
} from "./common.js";

describe("protocol identifiers", () => {
  it("adds the controlled Camelot V3 protocol identifier without changing the field name", () => {
    expect(CAMELOT_V3_PROTOCOL_ID).toBe("camelot-v3");
    expect(protocolIdSchema.parse("camelot-v3")).toBe("camelot-v3");
    expect(protocolSchema.parse("camelot-v3")).toBe("camelot-v3");
  });
});
