import type { TaskStore } from "@tasq/core";

export interface CliContext {
  store: TaskStore;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface Command {
  name: string;
  description: string;
  usage: string;
  run(args: string[], ctx: CliContext): number;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }
}
