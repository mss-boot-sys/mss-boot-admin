/** Keep progress in the confirmation action so a retry cannot replay completed deletions. */
export function createBatchDeleteAction<T extends { id: string }>(
  records: readonly T[],
  remove: (record: T) => Promise<unknown>,
  onComplete: () => void,
): () => Promise<void> {
  const completed = new Set<string>();
  return async () => {
    for (const record of records) {
      if (completed.has(record.id)) continue;
      await remove(record);
      completed.add(record.id);
    }
    onComplete();
  };
}
