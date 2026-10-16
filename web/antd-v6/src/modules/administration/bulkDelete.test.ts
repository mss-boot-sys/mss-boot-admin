import { describe, expect, it, vi } from 'vitest';
import { createBatchDeleteAction } from './bulkDelete';

describe('batch delete recovery', () => {
  it('retries remaining records after partial success without replaying completed deletes', async () => {
    const remove = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    const complete = vi.fn();
    const run = createBatchDeleteAction([{ id: 'a' }, { id: 'b' }], remove, complete);
    await expect(run()).rejects.toThrow('temporarily unavailable');
    expect(complete).not.toHaveBeenCalled();
    await run();
    expect(remove.mock.calls.map(([record]) => record.id)).toEqual(['a', 'b', 'b']);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
