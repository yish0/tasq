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

export class DependencyCycleError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly dependsOnId: number,
  ) {
    super(`dependency cycle: #${taskId} -> #${dependsOnId}`);
    this.name = "DependencyCycleError";
  }
}

export class ParentCycleError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly parentId: number,
  ) {
    super(`parent cycle: #${taskId} -> #${parentId}`);
    this.name = "ParentCycleError";
  }
}

export class IncompleteSubtaskError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly openIds: readonly number[],
  ) {
    super(`cannot complete #${taskId}: incomplete subtasks ${openIds.map((i) => `#${i}`).join(", ")}`);
    this.name = "IncompleteSubtaskError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`invalid transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class HasSubtasksError extends Error {
  constructor(public readonly taskId: number) {
    super(`#${taskId} has subtasks — use --recursive`);
    this.name = "HasSubtasksError";
  }
}

export class ParentArchivedError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly parentId: number,
  ) {
    super(`cannot restore #${taskId}: parent #${parentId} is archived — restore it first`);
    this.name = "ParentArchivedError";
  }
}

export class NotArchivedError extends Error {
  constructor(public readonly taskId: number) {
    super(`#${taskId} is not archived`);
    this.name = "NotArchivedError";
  }
}
