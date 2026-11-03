// An error the Worker answers as is: its status, its message and, when the
// page needs more than words (a newer save exists), a detail object.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}
