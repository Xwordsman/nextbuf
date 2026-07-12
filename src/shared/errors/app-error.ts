export type AppErrorOptions = {
  code: string;
  message: string;
  status?: number;
  expose?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expose: boolean;

  constructor({ code, message, status = 500, expose = false, cause }: AppErrorOptions) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}
