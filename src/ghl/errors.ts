export class GhlRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "GhlRequestError";
    this.status = status;
    this.path = path;
  }
}
