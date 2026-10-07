/** Ordered, bounded batches. On failure drain active work and preserve the first cause. */
export async function concurrentMap<TInput, TOutput>(
  input: readonly TInput[],
  concurrency: number,
  operation: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  const output: TOutput[] = [];
  async function worker(): Promise<void> {
    while (!failed && next < input.length) {
      const index = next++;
      const item = input[index];
      // The index was allocated synchronously and is inside the input bounds.
      if (item === undefined) {
        failed = true;
        failure = new TypeError(
          "Batch inputs must not contain undefined items",
        );
        return;
      }
      try {
        output[index] = await operation(item);
      } catch (cause) {
        if (!failed) {
          failed = true;
          failure = cause;
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, input.length) }, worker),
  );
  if (failed) throw failure;
  return output;
}
