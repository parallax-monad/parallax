import { describe, expect, it } from "vitest";

import {
  balanceOfCalldata,
  buildStateOverrides,
} from "./verified-remediation-balance-delta-qualification.mjs";

const ADDRESS = "0xb893e3334d4bd6c5ba8277fd559e99ed683a9fc7";
const SLOT =
  "0x60b9b7db6f0617405a942dd9bc67d3a152d51b3c6003b1b1e194ec8ee081dca9";
const VALUE =
  "0x00000000000000000000000000000000000000000000000000386d6911545b9f";

describe("BE-107 recipient balance-delta qualification helpers", () => {
  it("encodes balanceOf for the exact recipient", () => {
    const data = balanceOfCalldata(
      "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
    );
    expect(data).toBe(
      "0x70a08231000000000000000000000000eb7c5322f0997ee70f4bbd3ae7e428072c9af396",
    );
  });

  it("converts the full supported post diff into state overrides", () => {
    const overrides = buildStateOverrides({
      [ADDRESS]: {
        storage: { [SLOT]: VALUE },
        balance: "0x10",
        nonce: "0x1",
      },
    });

    expect(overrides).toEqual({
      [ADDRESS]: {
        stateDiff: { [SLOT]: VALUE },
        balance: "0x10",
        nonce: "0x1",
      },
    });
  });

  it("rejects unsupported post-state fields instead of ignoring them", () => {
    expect(() =>
      buildStateOverrides({
        [ADDRESS]: {
          storage: { [SLOT]: VALUE },
          codeHash: VALUE,
        },
      }),
    ).toThrow(/unsupported post-state field/);
  });

  it("rejects malformed addresses", () => {
    expect(() =>
      buildStateOverrides({
        "not-an-address": { storage: { [SLOT]: VALUE } },
      }),
    ).toThrow(/invalid post-state address/);
  });
  it("rejects malformed storage slots and values", () => {
    expect(() =>
      buildStateOverrides({
        [ADDRESS]: { storage: { "0x1": VALUE } },
      }),
    ).toThrow(/storage slot\/value/);

    expect(() =>
      buildStateOverrides({
        [ADDRESS]: { storage: { [SLOT]: "0x1" } },
      }),
    ).toThrow(/storage slot\/value/);
  });

  it("rejects malformed balance and nonce quantities", () => {
    expect(() =>
      buildStateOverrides({
        [ADDRESS]: { balance: "0x00" },
      }),
    ).toThrow(/post-state balance/);

    expect(() =>
      buildStateOverrides({
        [ADDRESS]: { nonce: "-1" },
      }),
    ).toThrow(/post-state nonce/);
  });

  it("rejects empty post-state diffs", () => {
    expect(() => buildStateOverrides({})).toThrow(/empty post-state diff/);
  });
});
