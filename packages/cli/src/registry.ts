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
  // 클래스 필드 이니셜라이저는 V8이 합성 함수로 계측해 bun 함수 커버리지에
  // 유령 미커버 함수가 남는다. 명시적 constructor로 100% 게이트를 지킨다.
  private readonly commands: Map<string, Command>;

  constructor() {
    this.commands = new Map();
  }

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
