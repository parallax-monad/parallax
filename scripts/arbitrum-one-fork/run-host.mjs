import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 15 || typeof registerHooks !== "function") {
  console.error(
    "NODE_VERSION_UNSUPPORTED: the host runner requires Node.js 22.15 or later in the 22.x line.",
  );
  process.exitCode = 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        !specifier.startsWith(".") ||
        !specifier.endsWith(".js") ||
        !context.parentURL?.startsWith("file:")
      ) {
        return nextResolve(specifier, context);
      }

      const javascriptUrl = new URL(specifier, context.parentURL);
      const typescriptUrl = new URL(
        `${specifier.slice(0, -3)}.ts`,
        context.parentURL,
      );
      if (
        existsSync(fileURLToPath(javascriptUrl)) ||
        !existsSync(fileURLToPath(typescriptUrl))
      ) {
        return nextResolve(specifier, context);
      }
      return { url: typescriptUrl.href, shortCircuit: true };
    },
  });

  try {
    const { runForkManager } = await import(
      new URL("./manager.ts", import.meta.url).href
    );
    await runForkManager();
  } catch (error) {
    const gitMetadataFailureCodes = new Set([
      "GIT_EXECUTION_FAILED",
      "GIT_METADATA_UNAVAILABLE",
      "GIT_NOT_FOUND",
    ]);
    if (
      error instanceof Error &&
      error.name === "HarnessError" &&
      gitMetadataFailureCodes.has(error.code)
    ) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error(
        "FORK_HARNESS_FAILED: manager could not be loaded; details suppressed.",
      );
    }
    process.exitCode = 1;
  }
}
