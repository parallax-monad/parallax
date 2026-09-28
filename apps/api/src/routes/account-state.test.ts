import { describe, expect, it } from "vitest";
import type { AccountStateApplicationService } from "../account-state-application.js";
import { createAccountStateApp } from "./account-state.js";

const unusedService = {} as unknown as AccountStateApplicationService;

describe("/api/account-state transport", () => {
  it("preserves method guards and no-store headers for both endpoints", async () => {
    const app = createAccountStateApp(unusedService);
    const wrongCollectionMethod = await app.fetch(
      new Request("https://api.example.test/api/account-state", {
        method: "GET",
      }),
    );
    const wrongSnapshotMethod = await app.fetch(
      new Request("https://api.example.test/api/account-state/snapshot-id", {
        method: "POST",
      }),
    );

    expect(wrongCollectionMethod.status).toBe(405);
    expect(wrongCollectionMethod.headers.get("allow")).toBe("POST");
    expect(wrongCollectionMethod.headers.get("cache-control")).toBe("no-store");
    expect(wrongSnapshotMethod.status).toBe(405);
    expect(wrongSnapshotMethod.headers.get("allow")).toBe("GET");
    expect(wrongSnapshotMethod.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the common not-found response", async () => {
    const response = await createAccountStateApp(unusedService).fetch(
      new Request("https://api.example.test/api/account-state/extra/path"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
