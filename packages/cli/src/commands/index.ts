import { CommandRegistry } from "../registry";
import { addCommand } from "./add";
import { eventsCommand } from "./events";
import { listCommand } from "./list";
import { rmCommand } from "./rm";
import { showCommand } from "./show";
import { statusCommand } from "./status";
import { updateCommand } from "./update";

export function buildRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of [
    addCommand,
    listCommand,
    showCommand,
    updateCommand,
    statusCommand,
    rmCommand,
    eventsCommand,
  ]) {
    registry.register(command);
  }
  return registry;
}
