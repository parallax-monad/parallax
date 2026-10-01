import type { AccountStateSnapshot as PublicAccountStateSnapshot } from "@parallax/contracts";
import { describe, expectTypeOf, it } from "vitest";
import type { AccountStateSnapshot as ApiAccountStateSnapshot } from "../../../apps/api/src/account-state-model.js";

describe("Account State public DTO", () => {
  it("matches the response shape inferred from the API's authoritative schema", () => {
    expectTypeOf<PublicAccountStateSnapshot>().toMatchTypeOf<ApiAccountStateSnapshot>();
    expectTypeOf<ApiAccountStateSnapshot>().toMatchTypeOf<PublicAccountStateSnapshot>();
  });
});
