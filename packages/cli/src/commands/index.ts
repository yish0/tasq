import { CommandRegistry } from "../registry";
import { addCommand } from "./add";
import { depCommand } from "./dep";
import { eventsCommand } from "./events";
import { cancelCommand, doneCommand, reopenCommand, startCommand } from "./lifecycle";
import { listCommand } from "./list";
import { noteCommand } from "./note";
import { restoreCommand } from "./restore";
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
    doneCommand,
    startCommand,
    cancelCommand,
    reopenCommand,
    statusCommand,
    noteCommand,
    depCommand,
    rmCommand,
    restoreCommand,
    eventsCommand,
  ]) {
    registry.register(command);
  }
  return registry;
}
