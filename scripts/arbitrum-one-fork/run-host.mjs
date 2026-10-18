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

  const { runForkManager } = await import(
    new URL("./manager.ts", import.meta.url).href
  );
  await runForkManager();
}
