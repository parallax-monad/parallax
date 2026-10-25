import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildComposeArgs,
  buildSmokeEndpoints,
  buildStartFailureDiagnostics,
  classifyComposeStartFailure,
  classifyLocalRpcError,
  cleanUpFailedStart,
  collectStartFailureDiagnostics,
  getCheckoutComposeProjectName,
  HarnessError,
  isAllowedLocalHost,
  isPrivateBindAddress,
  recreateFork,
  requireComposeSuccess,
  resolveGitMetadataPath,
  runDocker,
  sameGitDirectoryIdentity,
  sanitizeComposePsOutput,
  sanitizeForwarderInspectOutput,
  tryRecoverFork,
  waitForAnvil,
  waitForProxyHealth,
  writeCaptureAfterSmoke,
} from "./manager.js";
import { getForkHarnessConfig, runForkQuoteSmoke } from "./smoke.js";

const config = getForkHarnessConfig();

function withCheckoutMetadata<T>(run: (metadataDir: string) => T): T {
  const metadataDir = mkdtempSync(join(tmpdir(), "parallax-fork-project-"));
  try {
    return run(metadataDir);
  } finally {
    rmSync(metadataDir, { recursive: true, force: true });
  }
}

describe("Arbitrum One fork Git metadata path resolution", () => {
  it("accepts the same Git admin directory through distinct mount path aliases", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "parallax-fork-git-alias-"),
    );
    try {
      const gitDirectory = join(temporaryDirectory, "git-admin");
      const aliasDirectory = join(temporaryDirectory, "host-path-alias");
      mkdirSync(gitDirectory);
      symlinkSync(gitDirectory, aliasDirectory, "dir");

      const gitDirectoryStats = statSync(gitDirectory, { bigint: true });
      const aliasDirectoryStats = statSync(aliasDirectory, { bigint: true });
      expect(gitDirectoryStats.dev).toBe(aliasDirectoryStats.dev);
      expect(gitDirectoryStats.ino).toBe(aliasDirectoryStats.ino);

      const mountNamespaceRealpath = (path: string) =>
        `${path === aliasDirectory ? "/host" : "/container"}${resolve(path)}`;
      expect(mountNamespaceRealpath(aliasDirectory)).not.toBe(
        mountNamespaceRealpath(gitDirectory),
      );
      expect(
        sameGitDirectoryIdentity(
          aliasDirectory,
          gitDirectory,
          mountNamespaceRealpath,
        ),
      ).toBe(true);

      const foreignGitDirectory = join(temporaryDirectory, "foreign-git-admin");
      mkdirSync(foreignGitDirectory);
      expect(
        sameGitDirectoryIdentity(
          aliasDirectory,
          foreignGitDirectory,
          mountNamespaceRealpath,
        ),
      ).toBe(false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("recovers only the matching worktree metadata when .git contains a container path", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "parallax-fork-git-path-"),
    );
    try {
      const repositoryRoot = join(temporaryDirectory, "checkout");
      const worktreeRoot = join(repositoryRoot, ".worktrees", "fork");
      mkdirSync(dirname(worktreeRoot), { recursive: true });

      const gitInit = spawnSync("git", ["init", repositoryRoot], {
        encoding: "utf8",
        stdio: "ignore",
      });
      expect(gitInit.error).toBeUndefined();
      expect(gitInit.status).toBe(0);
      const gitCommit = spawnSync(
        "git",
        [
          "-C",
          repositoryRoot,
          "-c",
          "user.name=Parallax Test",
          "-c",
          "user.email=parallax-test@example.invalid",
          "commit",
          "--allow-empty",
          "--message",
          "test fixture",
        ],
        { encoding: "utf8", stdio: "ignore" },
      );
      expect(gitCommit.error).toBeUndefined();
      expect(gitCommit.status).toBe(0);
      const gitWorktree = spawnSync(
        "git",
        [
          "-C",
          repositoryRoot,
          "worktree",
          "add",
          "-b",
          "fork-fixture",
          worktreeRoot,
        ],
        { encoding: "utf8", stdio: "ignore" },
      );
      expect(gitWorktree.error).toBeUndefined();
      expect(gitWorktree.status).toBe(0);

      const worktreeGitDirectory = join(
        repositoryRoot,
        ".git",
        "worktrees",
        "fork",
      );
      const containerOnlyRoot = join(temporaryDirectory, "container-checkout");
      const containerOnlyGitDirectory = join(
        containerOnlyRoot,
        ".git",
        "worktrees",
        "fork",
      );
      expect(existsSync(containerOnlyGitDirectory)).toBe(false);
      writeFileSync(
        join(worktreeRoot, ".git"),
        `gitdir: ${containerOnlyGitDirectory}\n`,
      );
      writeFileSync(
        join(worktreeGitDirectory, "gitdir"),
        `${join(containerOnlyRoot, ".worktrees", "fork", ".git")}\n`,
      );

      expect(
        resolveGitMetadataPath("parallax-test-metadata", worktreeRoot),
      ).toBe(join(worktreeGitDirectory, "parallax-test-metadata"));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a stale pointer to another worktree with the same path suffix", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "parallax-fork-foreign-worktree-"),
    );
    try {
      const repositoryRoot = join(temporaryDirectory, "main");
      const currentWorktreeRoot = join(repositoryRoot, ".worktrees", "fork");
      const foreignWorktreeRoot = join(
        temporaryDirectory,
        "other",
        ".worktrees",
        "fork",
      );
      mkdirSync(dirname(currentWorktreeRoot), { recursive: true });
      mkdirSync(dirname(foreignWorktreeRoot), { recursive: true });

      const gitInit = spawnSync("git", ["init", repositoryRoot], {
        encoding: "utf8",
        stdio: "ignore",
      });
      expect(gitInit.error).toBeUndefined();
      expect(gitInit.status).toBe(0);
      const gitCommit = spawnSync(
        "git",
        [
          "-C",
          repositoryRoot,
          "-c",
          "user.name=Parallax Test",
          "-c",
          "user.email=parallax-test@example.invalid",
          "commit",
          "--allow-empty",
          "--message",
          "test fixture",
        ],
        { encoding: "utf8", stdio: "ignore" },
      );
      expect(gitCommit.error).toBeUndefined();
      expect(gitCommit.status).toBe(0);

      for (const [branch, worktreeRoot] of [
        ["fork-current", currentWorktreeRoot],
        ["fork-foreign", foreignWorktreeRoot],
      ]) {
        const gitWorktree = spawnSync(
          "git",
          ["-C", repositoryRoot, "worktree", "add", "-b", branch, worktreeRoot],
          { encoding: "utf8", stdio: "ignore" },
        );
        expect(gitWorktree.error).toBeUndefined();
        expect(gitWorktree.status).toBe(0);
      }

      const foreignGitDirectory = /^gitdir:\s*(.+)$/m.exec(
        readFileSync(join(foreignWorktreeRoot, ".git"), "utf8"),
      )?.[1];
      expect(foreignGitDirectory).toBeDefined();
      const foreignWorktreeId = basename(foreignGitDirectory ?? "");
      const containerOnlyRoot = join(temporaryDirectory, "container-checkout");
      const containerOnlyForeignGitDirectory = join(
        containerOnlyRoot,
        ".git",
        "worktrees",
        foreignWorktreeId,
      );
      const containerOnlyForeignWorktreeRoot = join(
        containerOnlyRoot,
        "other",
        ".worktrees",
        "fork",
      );
      expect(existsSync(containerOnlyForeignGitDirectory)).toBe(false);
      writeFileSync(
        join(currentWorktreeRoot, ".git"),
        `gitdir: ${containerOnlyForeignGitDirectory}\n`,
      );
      writeFileSync(
        join(foreignGitDirectory ?? "", "gitdir"),
        `${join(containerOnlyForeignWorktreeRoot, ".git")}\n`,
      );

      expect(() =>
        resolveGitMetadataPath("parallax-test-metadata", currentWorktreeRoot),
      ).toThrowError(
        expect.objectContaining({
          code: "GIT_METADATA_UNAVAILABLE",
          message: expect.stringContaining(
            "Could not resolve metadata for this worktree",
          ),
        }),
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an existing pointer to another worktree's admin directory", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "parallax-fork-existing-foreign-worktree-"),
    );
    try {
      const repositoryRoot = join(temporaryDirectory, "main");
      const currentWorktreeRoot = join(repositoryRoot, ".worktrees", "fork");
      const foreignWorktreeRoot = join(
        temporaryDirectory,
        "other",
        ".worktrees",
        "fork",
      );
      mkdirSync(dirname(currentWorktreeRoot), { recursive: true });
      mkdirSync(dirname(foreignWorktreeRoot), { recursive: true });

      const gitInit = spawnSync("git", ["init", repositoryRoot], {
        encoding: "utf8",
        stdio: "ignore",
      });
      expect(gitInit.error).toBeUndefined();
      expect(gitInit.status).toBe(0);
      const gitCommit = spawnSync(
        "git",
        [
          "-C",
          repositoryRoot,
          "-c",
          "user.name=Parallax Test",
          "-c",
          "user.email=parallax-test@example.invalid",
          "commit",
          "--allow-empty",
          "--message",
          "test fixture",
        ],
        { encoding: "utf8", stdio: "ignore" },
      );
      expect(gitCommit.error).toBeUndefined();
      expect(gitCommit.status).toBe(0);

      for (const [branch, worktreeRoot] of [
        ["fork-current", currentWorktreeRoot],
        ["fork-foreign", foreignWorktreeRoot],
      ]) {
        const gitWorktree = spawnSync(
          "git",
          ["-C", repositoryRoot, "worktree", "add", "-b", branch, worktreeRoot],
          { encoding: "utf8", stdio: "ignore" },
        );
        expect(gitWorktree.error).toBeUndefined();
        expect(gitWorktree.status).toBe(0);
      }

      const foreignGitPointer = readFileSync(
        join(foreignWorktreeRoot, ".git"),
        "utf8",
      );
      const foreignGitDirectory = /^gitdir:\s*(.+)$/m.exec(
        foreignGitPointer,
      )?.[1];
      expect(foreignGitDirectory).toBeDefined();
      expect(existsSync(foreignGitDirectory ?? "")).toBe(true);
      writeFileSync(join(currentWorktreeRoot, ".git"), foreignGitPointer);

      const initialGitLookup = spawnSync(
        "git",
        [
          "-C",
          currentWorktreeRoot,
          "rev-parse",
          "--path-format=absolute",
          "--absolute-git-dir",
          "--show-toplevel",
          "--git-path",
          "parallax-test-metadata",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      expect(initialGitLookup.error).toBeUndefined();
      expect(initialGitLookup.status).toBe(0);
      const initialGitPaths = initialGitLookup.stdout.trimEnd().split(/\r?\n/);
      expect(initialGitPaths[0]).toBe(foreignGitDirectory);
      expect(initialGitPaths[1]).toBe(currentWorktreeRoot);

      expect(() =>
        resolveGitMetadataPath("parallax-test-metadata", currentWorktreeRoot),
      ).toThrowError(
        expect.objectContaining({
          code: "GIT_METADATA_UNAVAILABLE",
          message: expect.stringContaining(
            "Could not resolve metadata for this worktree",
          ),
        }),
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

type HttpHandler = (
  request: IncomingMessage,
) => Promise<{ readonly status?: number; readonly body: unknown }>;

async function withHttpServer<T>(
  handler: HttpHandler,
  run: (port: number) => Promise<T>,
): Promise<T> {
  const server = createServer(async (request, response) => {
    const result = await handler(request);
    response.writeHead(result.status ?? 200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(result.body));
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    return await run((address as AddressInfo).port);
  } finally {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  }
}

async function readRpcMethod(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return (JSON.parse(body) as { method: string }).method;
}

function rpcResponse(method: string, chainId: string) {
  const blockNumber = `0x${BigInt(config.source.blockNumber).toString(16)}`;
  const results: Record<string, unknown> = {
    eth_chainId: chainId,
    eth_blockNumber: blockNumber,
    eth_getBlockByNumber: {
      number: blockNumber,
      hash: config.source.blockHash,
    },
    web3_clientVersion: `anvil/v${config.anvil.version}`,
  };
  return { jsonrpc: "2.0", id: 1, result: results[method] };
}

describe("Arbitrum One fork smoke endpoints", () => {
  it("uses configured published host ports for default RPC URLs", () => {
    expect(
      buildSmokeEndpoints({
        FORK_BIND_ADDRESS: "192.168.1.10",
        FORK_PROXY_HOST_PORT: "18546",
        FORK_LOCAL_HOST_PORT: "9545",
      }),
    ).toEqual({
      sourceUrl: "http://192.168.1.10:18546",
      localUrl: "http://192.168.1.10:9545",
    });
  });

  it("prefers explicit RPC URL overrides", () => {
    expect(
      buildSmokeEndpoints({
        FORK_PROXY_HOST_PORT: "18546",
        FORK_LOCAL_HOST_PORT: "9545",
        ARBITRUM_ONE_FORK_SOURCE_RPC_URL: "http://localhost:28546",
        ARBITRUM_ONE_FORK_LOCAL_RPC_URL: "http://host.docker.internal:8545",
      }),
    ).toEqual({
      sourceUrl: "http://localhost:28546",
      localUrl: "http://host.docker.internal:8545",
    });
  });

  it.each([
    {
      name: "source proxy path",
      variable: "ARBITRUM_ONE_FORK_SOURCE_RPC_URL",
      target: "/rpc",
      label: "read-only source proxy",
    },
    {
      name: "source proxy query",
      variable: "ARBITRUM_ONE_FORK_SOURCE_RPC_URL",
      target: "/?query",
      label: "read-only source proxy",
    },
    {
      name: "local fork RPC path",
      variable: "ARBITRUM_ONE_FORK_LOCAL_RPC_URL",
      target: "/rpc",
      label: "local fork RPC",
    },
    {
      name: "local fork RPC query",
      variable: "ARBITRUM_ONE_FORK_LOCAL_RPC_URL",
      target: "/?query",
      label: "local fork RPC",
    },
    {
      name: "empty source proxy query",
      variable: "ARBITRUM_ONE_FORK_SOURCE_RPC_URL",
      target: "/?",
      label: "read-only source proxy",
    },
  ])("rejects unsupported $name override", ({ variable, target, label }) => {
    expect(() =>
      buildSmokeEndpoints({ [variable]: `http://localhost:28546${target}` }),
    ).toThrow(`${label} must use the root path without a query string.`);
  });

  it.each(["FORK_PROXY_HOST_PORT", "FORK_LOCAL_HOST_PORT"])(
    "rejects an invalid %s",
    (name) => {
      expect(() => buildSmokeEndpoints({ [name]: "65536" })).toThrow(
        `${name} must be between 1 and 65535.`,
      );
    },
  );

  it("continues to reject unsafe bind addresses and endpoint overrides", () => {
    expect(() => buildSmokeEndpoints({ FORK_BIND_ADDRESS: "0.0.0.0" })).toThrow(
      "FORK_BIND_ADDRESS must be a local or RFC1918 IPv4 interface address.",
    );
    expect(() =>
      buildSmokeEndpoints({
        ARBITRUM_ONE_FORK_SOURCE_RPC_URL: "http://8.8.8.8:8545",
      }),
    ).toThrow(
      "read-only source proxy must use a credential-free HTTP endpoint",
    );
  });
});

describe("Arbitrum One fork smoke capture", () => {
  it("does not write a capture when the local endpoint reports another fork instance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "parallax-fork-capture-"));
    const capturePath = join(directory, "capture.json");
    const expectedInstanceId = "00000000-0000-4000-8000-000000000001";
    try {
      await expect(
        writeCaptureAfterSmoke(capturePath, () =>
          runForkQuoteSmoke({
            sourceRpc: {
              async request() {
                throw new Error(
                  "Source RPC must not be queried before identity.",
                );
              },
            },
            localRpc: {
              async request(method) {
                if (method === "parallax_forkInstanceId") {
                  return "00000000-0000-4000-8000-000000000002";
                }
                throw new Error("Unexpected local RPC method.");
              },
            },
            forkInstanceId: expectedInstanceId,
          }),
        ),
      ).rejects.toMatchObject({ code: "FORK_INSTANCE_IDENTITY_MISMATCH" });
      expect(existsSync(capturePath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Arbitrum One fork manager lifecycle", () => {
  const expectedForwarder = {
    targetPort: 8546,
    publishedPort: 9545,
    hostAddressClass: "loopback",
  } as const;

  function inspectForwarderBindings(
    hostConfig: unknown,
    networkSettings: unknown,
  ) {
    return sanitizeForwarderInspectOutput(
      [
        JSON.stringify(hostConfig),
        JSON.stringify(networkSettings),
        JSON.stringify(
          "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000001",
        ),
        JSON.stringify("anvil-host-forwarder"),
        JSON.stringify("a".repeat(64)),
        "fork",
      ].join("\n"),
      "127.0.0.1",
      () => true,
    );
  }

  function servicesWithInspection(
    inspection: ReturnType<typeof inspectForwarderBindings>,
  ) {
    const services = sanitizeComposePsOutput(
      JSON.stringify([
        {
          ID: "abcdef0123456789abcdef0123456789",
          Service: "anvil-host-forwarder",
          State: "running",
          Health: "healthy",
          Publishers: [
            { TargetPort: 8546, PublishedPort: 9545, Protocol: "tcp" },
          ],
        },
      ]),
      () => [],
      () => inspection,
    );
    if (services === undefined) {
      throw new Error("Expected valid forwarder Compose status.");
    }
    return services;
  }

  function diagnosticComposePsOutput(): string {
    return JSON.stringify([
      {
        ID: "111111111111",
        Service: "rpc-proxy",
        State: "running",
        Health: "healthy",
        Publishers: [],
      },
      {
        ID: "222222222222",
        Service: "anvil",
        State: "running",
        Health: "healthy",
        Publishers: [],
      },
      {
        ID: "333333333333",
        Service: "anvil-host-forwarder",
        State: "running",
        Health: "healthy",
        Publishers: [
          { TargetPort: 8546, PublishedPort: 9545, Protocol: "tcp" },
        ],
      },
    ]);
  }

  function diagnosticForwarderInspectOutput(): string {
    const bindings = [{ HostIp: "127.0.0.1", HostPort: "9545" }];
    return [
      JSON.stringify(bindings),
      JSON.stringify(bindings),
      JSON.stringify(
        "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000001",
      ),
      JSON.stringify("anvil-host-forwarder"),
      JSON.stringify("a".repeat(64)),
      "fork host-publish",
    ].join("\n");
  }

  it("sanitizes Compose status and keeps only allowlisted health and port facts", () => {
    const containerId = "abcdef0123456789abcdef0123456789";
    const rawStatus = JSON.stringify([
      {
        ID: containerId,
        Name: "fork-container-secret-name",
        Service: "anvil-host-forwarder",
        Command: "--upstream https://user:rpc-secret@example.invalid/key",
        State: "running",
        Health: "healthy",
        HealthOutput: "health-output-secret",
        Publishers: [
          {
            URL: "private-host-address",
            TargetPort: 8546,
            PublishedPort: 9545,
            Protocol: "tcp",
          },
        ],
      },
    ]);

    const sanitized = sanitizeComposePsOutput(rawStatus, (id) => {
      expect(id).toBe(containerId);
      return [0, 1];
    });

    expect(sanitized).toEqual([
      {
        service: "anvil-host-forwarder",
        state: "running",
        health: "healthy",
        publishedPorts: [
          { targetPort: 8546, publishedPort: 9545, protocol: "tcp" },
        ],
        healthcheckExitCodes: [0, 1],
      },
    ]);
    const output = JSON.stringify(sanitized);
    expect(output).not.toContain("rpc-secret");
    expect(output).not.toContain("fork-container-secret-name");
    expect(output).not.toContain("health-output-secret");
    expect(output).not.toContain("private-host-address");
  });

  it("sanitizes forwarder inspect fields and never emits raw addresses or secret values", () => {
    const rawInspect = [
      JSON.stringify([
        {
          HostIp: "127.0.0.1",
          HostPort: "9545",
          Secret: "not-an-allowlisted-field",
        },
      ]),
      JSON.stringify([{ HostIp: "192.168.1.10", HostPort: "9545" }]),
      JSON.stringify(
        "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000001",
      ),
      JSON.stringify("anvil-host-forwarder"),
      JSON.stringify("b".repeat(64)),
      "fork egress",
    ].join("\n");
    const sanitized = sanitizeForwarderInspectOutput(
      rawInspect,
      "127.0.0.1",
      (networkName) => {
        expect(["fork", "egress"]).toContain(networkName);
        return networkName === "fork";
      },
    );

    expect(sanitized).toEqual({
      hostConfigPortBindings: [
        {
          publishedPort: 9545,
          hostAddressClass: "loopback",
          hostAddressMatchesExpected: true,
        },
      ],
      networkSettingsPorts: [
        {
          publishedPort: 9545,
          hostAddressClass: "private",
          hostAddressMatchesExpected: false,
        },
      ],
      composeLabels: {
        project:
          "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000001",
        service: "anvil-host-forwarder",
        configHash: "b".repeat(64),
      },
      networks: [
        { name: "fork", internal: true },
        { name: "egress", internal: false },
      ],
    });
    const output = JSON.stringify(sanitized);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("192.168.1.10");
    expect(output).not.toContain("not-an-allowlisted-field");
  });

  it.each([
    {
      label: "missing expected HostConfig binding",
      hostConfig: [],
      networkSettings: [],
      finding: "FORWARDER_HOSTCONFIG_BINDING_ABSENT",
    },
    {
      label: "mismatched expected HostConfig port",
      hostConfig: [{ HostIp: "127.0.0.1", HostPort: "9546" }],
      networkSettings: [],
      finding: "FORWARDER_HOSTCONFIG_BINDING_MISMATCH",
    },
    {
      label: "mismatched expected HostConfig address",
      hostConfig: [{ HostIp: "192.168.1.10", HostPort: "9545" }],
      networkSettings: [],
      finding: "FORWARDER_HOSTCONFIG_BINDING_MISMATCH",
    },
    {
      label: "unavailable HostConfig binding field",
      hostConfig: "invalid-binding-shape",
      networkSettings: [],
      finding: "FORWARDER_HOSTCONFIG_BINDING_UNAVAILABLE",
    },
    {
      label: "missing NetworkSettings binding after HostConfig match",
      hostConfig: [{ HostIp: "127.0.0.1", HostPort: "9545" }],
      networkSettings: [],
      finding: "FORWARDER_BINDING_NOT_APPLIED_TO_NETWORKSETTINGS",
    },
    {
      label: "mismatched NetworkSettings binding",
      hostConfig: [{ HostIp: "127.0.0.1", HostPort: "9545" }],
      networkSettings: [{ HostIp: "127.0.0.1", HostPort: "9546" }],
      finding: "FORWARDER_NETWORKSETTINGS_BINDING_MISMATCH",
    },
    {
      label: "unavailable NetworkSettings binding field",
      hostConfig: [{ HostIp: "127.0.0.1", HostPort: "9545" }],
      networkSettings: "invalid-binding-shape",
      finding: "FORWARDER_NETWORKSETTINGS_BINDING_UNAVAILABLE",
    },
  ])(
    "classifies $label without exposing an IP address",
    ({ hostConfig, networkSettings, finding }) => {
      const diagnostics = buildStartFailureDiagnostics(
        { phase: "eth_chainId", errorClass: "CONNECTION_REFUSED" },
        servicesWithInspection(
          inspectForwarderBindings(hostConfig, networkSettings),
        ),
        expectedForwarder,
      );

      expect(diagnostics.findings).toContain(finding);
      expect(diagnostics.forwarder.expected).toEqual(expectedForwarder);
      expect(JSON.stringify(diagnostics)).not.toContain("127.0.0.1");
    },
  );

  it("distinguishes a present binding from a refused host RPC connection", () => {
    const diagnostics = buildStartFailureDiagnostics(
      { phase: "eth_chainId", errorClass: "CONNECTION_REFUSED" },
      servicesWithInspection(
        inspectForwarderBindings(
          [{ HostIp: "127.0.0.1", HostPort: "9545" }],
          [{ HostIp: "127.0.0.1", HostPort: "9545" }],
        ),
      ),
      expectedForwarder,
    );

    expect(diagnostics.findings).toContain(
      "HOST_PORT_BINDING_PRESENT_CONNECTION_REFUSED",
    );
    expect(diagnostics.findings).not.toContain(
      "FORWARDER_BINDING_NOT_APPLIED_TO_NETWORKSETTINGS",
    );
  });

  it("reports an unavailable forwarder inspect without claiming a binding mismatch", () => {
    const diagnostics = buildStartFailureDiagnostics(
      { phase: "eth_chainId", errorClass: "CONNECTION_REFUSED" },
      servicesWithInspection(undefined),
      expectedForwarder,
    );

    expect(diagnostics.findings).toContain("FORWARDER_INSPECT_UNAVAILABLE");
    expect(diagnostics.findings).not.toContain(
      "FORWARDER_HOSTCONFIG_BINDING_ABSENT",
    );
  });

  it("drops malformed Compose label values instead of emitting their contents", () => {
    const sanitized = sanitizeForwarderInspectOutput(
      [
        "null",
        "null",
        JSON.stringify("https://user:compose-secret@example.invalid/path"),
        JSON.stringify("service-secret-command"),
        JSON.stringify("config-secret-value"),
      ].join("\n"),
    );

    expect(sanitized?.composeLabels).toEqual({
      project: null,
      service: null,
      configHash: null,
    });
    expect(JSON.stringify(sanitized)).not.toContain("compose-secret");
    expect(JSON.stringify(sanitized)).not.toContain("service-secret-command");
    expect(JSON.stringify(sanitized)).not.toContain("config-secret-value");
  });

  it("distinguishes an unpublished host port from unhealthy and stopped services", () => {
    const rows = [
      {
        ID: "111111111111",
        Service: "rpc-proxy",
        State: "running",
        Health: "healthy",
        Publishers: [],
      },
      {
        ID: "222222222222",
        Service: "anvil",
        State: "running",
        Health: "unhealthy",
        Publishers: [],
      },
      {
        ID: "333333333333",
        Service: "anvil-host-forwarder",
        State: "exited",
        Health: "",
        Publishers: [],
      },
    ];
    const services = sanitizeComposePsOutput(JSON.stringify(rows), () => [1]);
    if (services === undefined)
      throw new Error("Expected valid Compose status.");

    const diagnostics = buildStartFailureDiagnostics(
      { phase: "eth_chainId", errorClass: "CONNECTION_REFUSED" },
      services,
    );

    expect(diagnostics.findings).toEqual(
      expect.arrayContaining([
        "HOST_PORT_UNPUBLISHED",
        "SERVICE_UNHEALTHY",
        "SERVICE_STOPPED",
        "HOST_FORWARDER_RPC_PROBE_FAILED",
      ]),
    );
    expect(
      diagnostics.services.map((service) => service.healthcheckExitCodes),
    ).toEqual([[1], [1], [1]]);
  });

  it("reports only a failed local RPC probe when services and the host port are healthy", () => {
    const rows = [
      {
        ID: "111111111111",
        Service: "rpc-proxy",
        State: "running",
        Health: "healthy",
        Publishers: [],
      },
      {
        ID: "222222222222",
        Service: "anvil",
        State: "running",
        Health: "healthy",
        Publishers: [],
      },
      {
        ID: "333333333333",
        Service: "anvil-host-forwarder",
        State: "running",
        Health: "",
        Publishers: [
          {
            TargetPort: 8546,
            PublishedPort: 9545,
            Protocol: "tcp",
          },
        ],
      },
    ];
    const services = sanitizeComposePsOutput(JSON.stringify(rows), () => []);
    if (services === undefined)
      throw new Error("Expected valid Compose status.");

    const diagnostics = buildStartFailureDiagnostics(
      { phase: "eth_chainId", errorClass: "TIMEOUT" },
      services,
    );

    expect(diagnostics.findings).toEqual(["HOST_FORWARDER_RPC_PROBE_FAILED"]);
    expect(diagnostics.rpcProbe).toEqual({
      phase: "eth_chainId",
      errorClass: "TIMEOUT",
    });
  });

  it("classifies local RPC errors without retaining their messages", () => {
    const refused = new Error(
      "https://user:rpc-secret@example.invalid/private-path",
      { cause: { code: "ECONNREFUSED" } },
    );
    const timeout = new Error("private endpoint timeout");
    timeout.name = "TimeoutError";

    expect(classifyLocalRpcError(refused)).toBe("CONNECTION_REFUSED");
    expect(classifyLocalRpcError(timeout)).toBe("TIMEOUT");
    expect(classifyLocalRpcError(new Error("LOCAL_RPC_INVALID_RESPONSE"))).toBe(
      "INVALID_RESPONSE",
    );
    expect(
      JSON.stringify(
        buildStartFailureDiagnostics(
          {
            phase: "eth_chainId",
            errorClass: classifyLocalRpcError(refused),
          },
          undefined,
        ),
      ),
    ).not.toContain("rpc-secret");
  });

  it("captures diagnostics before cleanup and still propagates the original startup error", () => {
    const events: string[] = [];
    const error = new HarnessError(
      "ANVIL_UNAVAILABLE",
      "Pinned Anvil did not become ready.",
      { phase: "eth_chainId", errorClass: "CONNECTION_REFUSED" },
    );

    let thrown: unknown;
    try {
      cleanUpFailedStart(error, {
        collectDiagnostics: () => {
          events.push("diagnostics");
          const rpcProbe = error.rpcProbeFailure;
          if (rpcProbe === undefined) {
            throw new Error("Expected a recorded local RPC probe failure.");
          }
          return buildStartFailureDiagnostics(rpcProbe, []);
        },
        reportDiagnostics: () => {
          events.push("report");
        },
        teardown: () => {
          events.push("teardown");
        },
        clearMetadata: () => {
          events.push("clear-metadata");
        },
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBe(error);
    expect(events).toEqual([
      "diagnostics",
      "report",
      "teardown",
      "clear-metadata",
    ]);
  });

  it.each([
    {
      stdout: "",
      stderr: "Ports are not available: address already in use",
      classification: "HOST_PORT_BIND_FAILED",
    },
    {
      stdout: "",
      stderr: "pull access denied; repository does not exist",
      classification: "IMAGE_PULL_FAILED",
    },
    {
      stdout: "dependency failed to start: service is unhealthy",
      stderr: "",
      classification: "DEPENDENCY_HEALTHCHECK_FAILED",
    },
    {
      stdout: "",
      stderr: "Mounts denied: bind source path does not exist",
      classification: "BIND_MOUNT_FAILED",
    },
    {
      stdout: "",
      stderr: "unrecognized daemon failure with private endpoint text",
      classification: "UNCLASSIFIED_COMPOSE_FAILURE",
    },
  ] as const)(
    "classifies Compose startup output as $classification",
    ({ stdout, stderr, classification }) => {
      expect(classifyComposeStartFailure(stdout, stderr)).toBe(classification);
    },
  );

  it("captures sanitized Compose start diagnostics before cleanup and preserves the startup error", () => {
    const events: string[] = [];
    const rawEndpoint =
      "https://user:diagnostic-secret@example.invalid/private-path";
    const rawOutput = "COMPOSE_STDERR_SENTINEL";
    const rawComposeOutput = `Ports are not available: exposing port TCP 127.0.0.1:9545: address already in use ${rawEndpoint} ${rawOutput}`;
    const diagnosticTimeouts: number[] = [];
    const fakeDockerSpawn = ((
      command: string,
      args: string[],
      options: { maxBuffer?: number },
    ) => {
      expect(command).toBe("docker");
      expect(args.slice(-2)).toEqual(["up", "-d"]);
      expect(options.maxBuffer).toBe(1024 * 1024);
      return { status: 1, stdout: "", stderr: rawComposeOutput };
    }) as unknown as typeof import("node:child_process").spawnSync;
    const composeResult = runDocker(
      [
        "compose",
        "--project-name",
        "test",
        "--file",
        "compose.yaml",
        "up",
        "-d",
      ],
      {},
      15_000,
      fakeDockerSpawn,
    );
    expect(composeResult).toMatchObject({
      status: 1,
      stdout: "",
      composeFailureClass: "HOST_PORT_BIND_FAILED",
    });
    expect(JSON.stringify(composeResult)).not.toContain(rawComposeOutput);
    expect(JSON.stringify(composeResult)).not.toContain(rawEndpoint);

    let startupError: HarnessError | undefined;
    try {
      requireComposeSuccess(composeResult, "start");
    } catch (caught) {
      if (caught instanceof HarnessError) startupError = caught;
    }
    if (startupError === undefined) {
      throw new Error("Expected Docker Compose start to fail.");
    }
    const error = startupError;
    events.push("compose-classification");
    expect(error.code).toBe("COMPOSE_OPERATION_FAILED");
    expect(error.composeFailureClass).toBe("HOST_PORT_BIND_FAILED");
    expect(error.message).not.toContain(rawComposeOutput);
    expect(error.message).not.toContain(rawEndpoint);
    expect(error.message).not.toContain(rawOutput);

    const rows = [
      {
        ID: "111111111111",
        Service: "rpc-proxy",
        State: "running",
        Health: "healthy",
        Publishers: [],
        Name: "container-name-SENTINEL",
        Command: `--endpoint ${rawEndpoint}`,
        Environment: [`FORK_RPC=${rawEndpoint}`],
        Output: rawOutput,
      },
      {
        ID: "222222222222",
        Service: "anvil",
        State: "exited",
        Health: "unhealthy",
        Publishers: [],
        Name: "container-name-SENTINEL",
        Command: `--endpoint ${rawEndpoint}`,
        Environment: [`FORK_RPC=${rawEndpoint}`],
        Output: rawOutput,
      },
      {
        ID: "333333333333",
        Service: "anvil-host-forwarder",
        State: "exited",
        Health: "unhealthy",
        Publishers: [
          { TargetPort: 8546, PublishedPort: 9545, Protocol: "tcp" },
        ],
        Name: "container-name-SENTINEL",
        Command: `--endpoint ${rawEndpoint}`,
        Environment: [`FORK_RPC=${rawEndpoint}`],
        Output: rawOutput,
      },
    ];
    let reported: ReturnType<typeof buildStartFailureDiagnostics> | undefined;
    let thrown: unknown;

    try {
      cleanUpFailedStart(error, {
        collectDiagnostics: () => {
          events.push("diagnostics");
          const diagnostics = collectStartFailureDiagnostics(
            { FORK_LOCAL_HOST_PORT: "9545" },
            error,
            {
              runDocker: (args, _env, timeoutMs) => {
                diagnosticTimeouts.push(timeoutMs);
                if (args[0] === "compose") {
                  events.push("compose-status");
                  return { status: 0, stdout: JSON.stringify(rows) };
                }
                if (
                  args[0] === "inspect" &&
                  args[2]?.includes(".State.Health.Log")
                ) {
                  events.push("healthcheck-status");
                  const containerId = args.at(-1);
                  return {
                    status: 0,
                    stdout:
                      containerId === "222222222222"
                        ? "7"
                        : containerId === "333333333333"
                          ? "1"
                          : "0",
                  };
                }
                if (args[0] === "inspect") {
                  events.push("forwarder-inspect");
                  return {
                    status: 0,
                    stdout: diagnosticForwarderInspectOutput(),
                  };
                }
                if (args[0] === "network") {
                  events.push("network-inspect");
                  return {
                    status: 0,
                    stdout: args.at(-1) === "fork" ? "true" : "false",
                  };
                }
                throw new Error("Unexpected diagnostic Docker command.");
              },
            },
          );
          events.push("diagnostics-complete");
          return diagnostics;
        },
        reportDiagnostics: (diagnostics) => {
          events.push("report");
          reported = diagnostics;
        },
        teardown: () => {
          events.push("teardown");
        },
        clearMetadata: () => {
          events.push("clear-metadata");
        },
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBe(error);
    expect(reported).toMatchObject({
      code: "COMPOSE_OPERATION_FAILED",
      failureClassification: "COMPOSE_START_FAILED",
      composeFailureClass: "HOST_PORT_BIND_FAILED",
      findings: expect.arrayContaining([
        "COMPOSE_START_FAILED",
        "SERVICE_STOPPED",
        "SERVICE_UNHEALTHY",
      ]),
      composeStatus: "available",
    });
    expect(reported?.rpcProbe).toBeUndefined();
    expect(
      reported?.services.map(
        ({ service, state, health, healthcheckExitCodes }) => ({
          service,
          state,
          health,
          healthcheckExitCodes,
        }),
      ),
    ).toEqual([
      {
        service: "rpc-proxy",
        state: "running",
        health: "healthy",
        healthcheckExitCodes: [0],
      },
      {
        service: "anvil",
        state: "exited",
        health: "unhealthy",
        healthcheckExitCodes: [7],
      },
      {
        service: "anvil-host-forwarder",
        state: "exited",
        health: "unhealthy",
        healthcheckExitCodes: [1],
      },
    ]);

    const serializedDiagnostics = JSON.stringify(reported);
    expect(serializedDiagnostics).not.toContain(rawComposeOutput);
    expect(serializedDiagnostics).not.toContain(rawOutput);
    expect(serializedDiagnostics).not.toContain(rawEndpoint);
    expect(serializedDiagnostics).not.toContain("diagnostic-secret");
    expect(serializedDiagnostics).not.toContain("container-name-SENTINEL");
    expect(serializedDiagnostics).not.toContain("FORK_RPC");
    expect(events.indexOf("compose-classification")).toBeLessThan(
      events.indexOf("diagnostics"),
    );
    expect(events.indexOf("compose-status")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("compose-status")).toBeLessThan(
      events.indexOf("diagnostics-complete"),
    );
    expect(diagnosticTimeouts.length).toBeGreaterThan(0);
    expect(
      diagnosticTimeouts.every(
        (timeoutMs) => timeoutMs > 0 && timeoutMs <= 15_000,
      ),
    ).toBe(true);
    expect(events.indexOf("diagnostics-complete")).toBeLessThan(
      events.indexOf("report"),
    );
    expect(events.indexOf("report")).toBeLessThan(events.indexOf("teardown"));
    expect(events.indexOf("teardown")).toBeLessThan(
      events.indexOf("clear-metadata"),
    );
    expect(events.slice(-3)).toEqual(["report", "teardown", "clear-metadata"]);
  });

  it("classifies captured Compose output after a spawn error before cleanup without leaking it", () => {
    const events: string[] = [];
    const rawEndpoint =
      "https://user:spawn-secret@example.invalid/private-path";
    const rawComposeOutput = `Ports are not available: address already in use ${rawEndpoint} PRIVATE_STDERR_SENTINEL`;
    const rawSpawnError = `ENOBUFS diagnostic ${rawEndpoint}`;
    const fakeDockerSpawn = ((
      command: string,
      args: string[],
      options: { maxBuffer?: number },
    ) => {
      events.push("compose-spawn");
      expect(command).toBe("docker");
      expect(args.slice(-2)).toEqual(["up", "-d"]);
      expect(options.maxBuffer).toBe(1024 * 1024);
      return {
        error: Object.assign(new Error(rawSpawnError), { code: "ENOBUFS" }),
        status: 0,
        stdout: "",
        stderr: rawComposeOutput,
      };
    }) as unknown as typeof import("node:child_process").spawnSync;

    let startupError: HarnessError | undefined;
    try {
      runDocker(
        [
          "compose",
          "--project-name",
          "test",
          "--file",
          "compose.yaml",
          "up",
          "-d",
        ],
        {},
        15_000,
        fakeDockerSpawn,
      );
    } catch (caught) {
      if (caught instanceof HarnessError) startupError = caught;
    }
    if (startupError === undefined) {
      throw new Error("Expected Docker Compose spawn failure.");
    }
    const error = startupError;
    expect(error.code).toBe("DOCKER_UNAVAILABLE");
    expect(error.composeFailureClass).toBe("HOST_PORT_BIND_FAILED");
    expect(error.message).not.toContain(rawComposeOutput);
    expect(error.message).not.toContain(rawSpawnError);
    expect(JSON.stringify(error)).not.toContain(rawComposeOutput);
    expect(JSON.stringify(error)).not.toContain(rawSpawnError);
    events.push("compose-classification");

    let reported: ReturnType<typeof buildStartFailureDiagnostics> | undefined;
    let thrown: unknown;
    try {
      cleanUpFailedStart(error, {
        collectDiagnostics: () => {
          events.push("diagnostics");
          const diagnostics = collectStartFailureDiagnostics({}, error, {
            runDocker: (args) => {
              expect(args[0]).toBe("compose");
              events.push("compose-status");
              return { status: 0, stdout: JSON.stringify([]) };
            },
          });
          events.push("diagnostics-complete");
          return diagnostics;
        },
        reportDiagnostics: (diagnostics) => {
          events.push("report");
          reported = diagnostics;
        },
        teardown: () => {
          events.push("teardown");
        },
        clearMetadata: () => {
          events.push("clear-metadata");
        },
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBe(error);
    expect(reported).toMatchObject({
      code: "COMPOSE_OPERATION_FAILED",
      failureClassification: "COMPOSE_START_FAILED",
      composeFailureClass: "HOST_PORT_BIND_FAILED",
      composeStatus: "available",
      findings: expect.arrayContaining(["COMPOSE_START_FAILED"]),
    });
    const safeOutput = JSON.stringify({
      error: error.message,
      diagnostics: reported,
    });
    expect(safeOutput).not.toContain(rawComposeOutput);
    expect(safeOutput).not.toContain(rawSpawnError);
    expect(safeOutput).not.toContain(rawEndpoint);
    expect(safeOutput).not.toContain("PRIVATE_STDERR_SENTINEL");
    expect(events).toEqual([
      "compose-spawn",
      "compose-classification",
      "diagnostics",
      "compose-status",
      "diagnostics-complete",
      "report",
      "teardown",
      "clear-metadata",
    ]);
  });

  it("keeps non-start Docker spawn errors classified as DOCKER_UNAVAILABLE", () => {
    const rawError = new Error("spawn error details are suppressed");
    const fakeDockerSpawn = (() => ({
      error: rawError,
      status: null,
      stdout: "",
      stderr: "",
    })) as unknown as typeof import("node:child_process").spawnSync;

    let thrown: unknown;
    try {
      runDocker(["compose", "ps"], {}, 15_000, fakeDockerSpawn);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HarnessError);
    expect(thrown).toMatchObject({ code: "DOCKER_UNAVAILABLE" });
    expect((thrown as Error).message).not.toContain(rawError.message);
  });

  it("shares one decreasing diagnostic timeout across sequential Docker probes", () => {
    let now = 1_000;
    const seenArgs: string[][] = [];
    const timeouts: number[] = [];
    const diagnostics = collectStartFailureDiagnostics(
      { FORK_LOCAL_HOST_PORT: "9545" },
      new HarnessError("ANVIL_UNAVAILABLE", "startup failed", {
        phase: "eth_chainId",
        errorClass: "CONNECTION_REFUSED",
      }),
      {
        now: () => now,
        runDocker: (args, _env, timeoutMs) => {
          seenArgs.push([...args]);
          timeouts.push(timeoutMs);
          now += 2_000;
          if (args[0] === "compose") {
            return { status: 0, stdout: diagnosticComposePsOutput() };
          }
          if (args[0] === "network") {
            return {
              status: 0,
              stdout: args.at(-1) === "fork" ? "true" : "false",
            };
          }
          if (
            args[0] === "inspect" &&
            args[2]?.includes("HostConfig.PortBindings")
          ) {
            return {
              status: 0,
              stdout: diagnosticForwarderInspectOutput(),
            };
          }
          return { status: 0, stdout: "0" };
        },
      },
    );

    expect(timeouts).toEqual([
      15_000, 13_000, 11_000, 9_000, 7_000, 5_000, 3_000,
    ]);
    expect(seenArgs.map((args) => args[0])).toEqual([
      "compose",
      "inspect",
      "inspect",
      "inspect",
      "inspect",
      "network",
      "network",
    ]);
    expect(
      diagnostics.services.map((service) => service.healthcheckExitCodes),
    ).toEqual([[0], [0], [0]]);
    expect(diagnostics.forwarder.actual?.networks).toEqual([
      { name: "fork", internal: true },
      { name: "host-publish", internal: false },
    ]);
  });

  it("skips remaining diagnostic subprocesses after the shared deadline expires", () => {
    let now = 0;
    const seenArgs: string[][] = [];
    const diagnostics = collectStartFailureDiagnostics(
      { FORK_LOCAL_HOST_PORT: "9545" },
      new HarnessError("ANVIL_UNAVAILABLE", "startup failed"),
      {
        now: () => now,
        runDocker: (args, _env, timeoutMs) => {
          seenArgs.push([...args]);
          expect(timeoutMs).toBe(15_000);
          now = 15_000;
          return { status: 0, stdout: diagnosticComposePsOutput() };
        },
      },
    );

    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]?.[0]).toBe("compose");
    expect(diagnostics.composeStatus).toBe("available");
    expect(
      diagnostics.services.map((service) => service.healthcheckExitCodes),
    ).toEqual([null, null, null]);
    expect(diagnostics.services.map((service) => service.state)).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(diagnostics.forwarder.actual).toBeNull();
  });

  it("continues failed-start cleanup after the diagnostic deadline expires", () => {
    let now = 0;
    const seenTimeouts: number[] = [];
    const events: string[] = [];
    let reportedCode: string | undefined;
    const error = new HarnessError(
      "ANVIL_UNAVAILABLE",
      "Pinned Anvil did not become ready.",
      { phase: "eth_chainId", errorClass: "CONNECTION_REFUSED" },
    );

    let thrown: unknown;
    try {
      cleanUpFailedStart(error, {
        collectDiagnostics: () => {
          events.push("diagnostics");
          return collectStartFailureDiagnostics(
            { FORK_LOCAL_HOST_PORT: "9545" },
            error,
            {
              now: () => now,
              runDocker: (_args, _env, timeoutMs) => {
                seenTimeouts.push(timeoutMs);
                now = 15_000;
                return { status: 0, stdout: diagnosticComposePsOutput() };
              },
            },
          );
        },
        reportDiagnostics: (diagnostics) => {
          events.push("report");
          reportedCode = diagnostics.code;
        },
        teardown: () => {
          events.push("teardown");
        },
        clearMetadata: () => {
          events.push("clear-metadata");
        },
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBe(error);
    expect(reportedCode).toBe("ANVIL_UNAVAILABLE");
    expect(seenTimeouts).toEqual([15_000]);
    expect(events).toEqual([
      "diagnostics",
      "report",
      "teardown",
      "clear-metadata",
    ]);
  });

  it("reuses one persisted Compose identity for the same checkout", () => {
    withCheckoutMetadata((metadataDir) => {
      const identityPath = join(metadataDir, "checkout-id");
      const identity = "00000000-0000-4000-8000-000000000010";

      const firstName = getCheckoutComposeProjectName(
        identityPath,
        () => identity,
      );
      const secondName = getCheckoutComposeProjectName(identityPath, () => {
        throw new Error("A persisted checkout identity must be reused.");
      });

      expect(firstName).toBe(
        "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000010",
      );
      expect(secondName).toBe(firstName);
      expect(readFileSync(identityPath, "utf8")).toBe(`${identity}\n`);
    });
  });

  it("isolates Compose project names for distinct checkout metadata", () => {
    withCheckoutMetadata((metadataDir) => {
      const firstName = getCheckoutComposeProjectName(
        join(metadataDir, "first-checkout"),
        () => "00000000-0000-4000-8000-000000000011",
      );
      const secondName = getCheckoutComposeProjectName(
        join(metadataDir, "second-checkout"),
        () => "00000000-0000-4000-8000-000000000012",
      );

      expect(firstName).not.toBe(secondName);
      expect(firstName).toMatch(/^parallax-arbitrum-one-fork-[0-9a-f-]+$/);
      expect(secondName).toMatch(/^parallax-arbitrum-one-fork-[0-9a-f-]+$/);
    });
  });

  it.each([
    ["ps", "--status", "running", "--quiet"],
    ["up", "-d"],
    ["down", "--volumes", "--remove-orphans"],
  ])("uses the checkout project name for Compose %s", (...operation) => {
    const projectName =
      "parallax-arbitrum-one-fork-00000000-0000-4000-8000-000000000013";
    const args = buildComposeArgs(projectName, operation);
    const projectNameIndex = args.indexOf("--project-name");

    expect(args[0]).toBe("compose");
    expect(args[projectNameIndex + 1]).toBe(projectName);
    expect(args.slice(-operation.length)).toEqual(operation);
    expect(args).not.toContain("parallax-arbitrum-one-fork");
  });

  it("rejects an invalid stored checkout identity instead of replacing it", () => {
    withCheckoutMetadata((metadataDir) => {
      const identityPath = join(metadataDir, "checkout-id");
      writeFileSync(identityPath, "not-a-uuid\n", "utf8");

      let error: unknown;
      try {
        getCheckoutComposeProjectName(identityPath);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "COMPOSE_PROJECT_ID_UNAVAILABLE" });
      expect(readFileSync(identityPath, "utf8")).toBe("not-a-uuid\n");
    });
  });

  it("rejects wildcard and all other 0/8 bind addresses", () => {
    for (const address of ["0.0.0.0", "0.1.2.3", "0.255.255.255"]) {
      expect(isPrivateBindAddress(address), address).toBe(false);
      expect(isAllowedLocalHost(address), address).toBe(false);
    }
  });

  it("accepts loopback and RFC1918 bind addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.20.30.40",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.10",
    ]) {
      expect(isPrivateBindAddress(address), address).toBe(true);
      expect(isAllowedLocalHost(address), address).toBe(true);
    }
    expect(isPrivateBindAddress("172.32.0.1")).toBe(false);
    expect(isPrivateBindAddress("8.8.8.8")).toBe(false);
  });

  it("reports proxy readiness only when its health response is successful", async () => {
    await withHttpServer(
      async (request) => ({
        body: request.url === "/healthz" ? { ok: true } : { ok: false },
      }),
      async (port) =>
        waitForProxyHealth({
          FORK_BIND_ADDRESS: "127.0.0.1",
          FORK_PROXY_HOST_PORT: String(port),
        }),
    );
  });

  it("fails readiness immediately for a source-chain health mismatch", async () => {
    await withHttpServer(
      async () => ({
        body: { ok: false, code: "SOURCE_CHAIN_ID_MISMATCH" },
      }),
      async (port) =>
        expect(
          waitForProxyHealth({
            FORK_BIND_ADDRESS: "127.0.0.1",
            FORK_PROXY_HOST_PORT: String(port),
          }),
        ).rejects.toMatchObject({ code: "SOURCE_CHAIN_ID_MISMATCH" }),
    );
  });

  it("accepts Anvil only after local chain, pinned block/hash, and version match", async () => {
    const chainId = `0x${config.localExecutionChainId.toString(16)}`;
    await withHttpServer(
      async (request) => {
        return { body: rpcResponse(await readRpcMethod(request), chainId) };
      },
      async (port) =>
        waitForAnvil({
          FORK_BIND_ADDRESS: "127.0.0.1",
          FORK_LOCAL_HOST_PORT: String(port),
        }),
    );
  });

  it("rejects a local-chain identity mismatch during Anvil readiness", async () => {
    await withHttpServer(
      async (request) => {
        return { body: rpcResponse(await readRpcMethod(request), "0x1") };
      },
      async (port) =>
        expect(
          waitForAnvil({
            FORK_BIND_ADDRESS: "127.0.0.1",
            FORK_LOCAL_HOST_PORT: String(port),
          }),
        ).rejects.toMatchObject({ code: "ANVIL_IDENTITY_MISMATCH" }),
    );
  });

  it("tears down before clearing metadata and starts a fresh instance on reset", async () => {
    const events: string[] = [];
    const newInstanceId = "00000000-0000-4000-8000-000000000002";
    const instanceId = await recreateFork({
      prepare: () => {
        events.push("prepare");
      },
      teardown: () => {
        events.push("teardown");
      },
      clearMetadata: () => {
        events.push("clear-metadata");
      },
      createInstanceId: () => {
        events.push("new-instance");
        return newInstanceId;
      },
      start: async (id) => {
        events.push(`start:${id}`);
      },
    });

    expect(instanceId).toBe(newInstanceId);
    expect(events).toEqual([
      "prepare",
      "teardown",
      "clear-metadata",
      "new-instance",
      `start:${newInstanceId}`,
    ]);
  });

  it("recovers a failed snapshot reset by recreating the fork, and reports failed recovery", async () => {
    const events: string[] = [];
    const actions = {
      prepare: () => {
        events.push("prepare");
      },
      teardown: () => {
        events.push("teardown");
      },
      clearMetadata: () => {
        events.push("clear-metadata");
      },
      createInstanceId: () => "00000000-0000-4000-8000-000000000003",
      start: async () => {
        events.push("start");
      },
    };

    await expect(tryRecoverFork(actions)).resolves.toBe(true);
    expect(events).toEqual(["prepare", "teardown", "clear-metadata", "start"]);

    const failed = await tryRecoverFork({
      ...actions,
      teardown: () => {
        throw new Error("simulated teardown failure");
      },
    });
    expect(failed).toBe(false);
    expect(events).toEqual([
      "prepare",
      "teardown",
      "clear-metadata",
      "start",
      "prepare",
    ]);
  });
});
