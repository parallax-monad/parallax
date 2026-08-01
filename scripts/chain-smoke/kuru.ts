const message = [
  "Kuru live smoke is unavailable in this repository revision.",
  "The published Moss 0.1.0 packages do not match the recorded Capability and Receipt API baseline.",
  "Use the recorded fixtures for replay only; do not treat this command as a successful live simulation.",
].join(" ");

if (!process.env.MOSS_RPC_URL) {
  console.error(
    `${message} MOSS_RPC_URL is intentionally not read from a file.`,
  );
  process.exitCode = 1;
} else {
  console.error(message);
  process.exitCode = 1;
}
