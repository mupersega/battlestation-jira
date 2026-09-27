/** A request the domain refuses: invalid input, or a move that is not allowed. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
