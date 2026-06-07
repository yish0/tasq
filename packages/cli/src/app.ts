import type { CliContext, CommandRegistry } from "./registry";

function printHelp(registry: CommandRegistry, ctx: CliContext): void {
  ctx.stdout("usage: tasq <command> [options]");
  ctx.stdout("");
  for (const command of registry.all()) {
    ctx.stdout(`  ${command.name.padEnd(8)} ${command.description}`);
  }
}

export function runCli(argv: string[], ctx: CliContext, registry: CommandRegistry): number {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help") {
    printHelp(registry, ctx);
    return 0;
  }
  const command = registry.get(name);
  if (!command) {
    ctx.stderr(`unknown command: ${name}`);
    return 1;
  }
  try {
    return command.run(rest, ctx);
  } catch (err) {
    ctx.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
