/** Reverse-order rollback for resources acquired before the engine is ready. */
export class InitializationScope {
  private cleanup: (() => void)[] = [];
  own<T extends { dispose(): void }>(resource: T): T {
    this.defer(() => resource.dispose());
    return resource;
  }
  defer(cleanup: () => void) {
    this.cleanup.push(cleanup);
  }
  commit() {
    this.cleanup = [];
  }
  rollback() {
    for (const cleanup of this.cleanup.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error("Renderer startup cleanup failed", error);
      }
    }
    this.cleanup = [];
  }
}
