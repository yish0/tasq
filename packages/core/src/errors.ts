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
