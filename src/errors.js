/** An error a person or the model can act on. code is stable; message says what to do next. */
export class AppError extends Error {
  /** @param {string} code @param {string} message @param {object} [extra] */
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}
