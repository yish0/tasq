export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: number) {
    super(`task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidStatusError extends Error {
  constructor(public readonly status: string) {
    super(`invalid status: ${status}`);
    this.name = "InvalidStatusError";
  }
}

export class SchemaTooNewError extends Error {
  constructor(
    public readonly dbVersion: number,
    public readonly appVersion: number,
  ) {
    super(`database schema v${dbVersion} is newer than supported v${appVersion} — upgrade tasq`);
    this.name = "SchemaTooNewError";
  }
}

export class InvalidDateExprError extends Error {
  constructor(public readonly expr: string) {
    super(`invalid date expression: ${expr}`);
    this.name = "InvalidDateExprError";
  }
}
