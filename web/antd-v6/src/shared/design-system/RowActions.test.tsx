import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowActions } from './RowActions';

vi.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

afterEach(cleanup);

describe('RowActions', () => {
  it('renders nothing when every action is hidden', () => {
    const { container } = render(
      <App>
        <RowActions primary={false} more={[false, null]} />
      </App>,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('confirms danger actions before running them and blocks disabled ones', async () => {
    const remove = vi.fn();
    const blocked = vi.fn();
    render(
      <App>
        <RowActions
          primary={{ key: 'edit', label: 'edit', onClick: vi.fn() }}
          more={[
            { key: 'blocked', label: 'blocked', disabled: true, onClick: blocked },
            {
              key: 'delete',
              label: 'delete',
              danger: true,
              confirm: { title: 'sure?' },
              onClick: remove,
            },
          ]}
        />
      </App>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actions.more' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'blocked' }));
    expect(blocked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }));
    expect((await screen.findAllByText('sure?')).length).toBeGreaterThan(0);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /OK/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });

  it('keeps stable accessible names when labels are operator-configured', async () => {
    render(
      <App>
        <RowActions
          primary={{ key: 'edit', ariaLabel: 'Edit', label: '修改', onClick: vi.fn() }}
          more={[{ key: 'detail', ariaLabel: 'Details', label: '查看', onClick: vi.fn() }]}
        />
      </App>,
    );
    expect(screen.getByRole('button', { name: 'Edit' }).textContent).toContain('修改');
    fireEvent.click(screen.getByRole('button', { name: 'actions.more' }));
    expect(await screen.findByRole('menuitem', { name: 'Details' })).toBeTruthy();
  });

  it('keeps failed asynchronous confirmations open and permits a successful retry', async () => {
    let reject: (error: Error) => void = () => {};
    const remove = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValueOnce(undefined);
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <RowActions
            more={[
              {
                key: 'delete',
                label: 'Delete record',
                danger: true,
                confirm: { title: 'Confirm deletion' },
                onClick: remove,
              },
            ]}
          />
        </App>
      </ConfigProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actions.more' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete record' }));
    fireEvent.click(await screen.findByRole('button', { name: /OK/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => reject(new Error('conflict')));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /OK/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
