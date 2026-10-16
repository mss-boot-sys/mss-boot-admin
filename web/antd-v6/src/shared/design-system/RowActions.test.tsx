import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it.each(['immediate', 'deferred'])(
    'keeps a %s failure visible and resets the confirmation button for a successful retry',
    async (timing) => {
      const conflict = Object.assign(new Error('HTTP 409'), {
        response: {
          status: 409,
          data: { errorCode: 'USER_IN_USE', errorMessage: 'This fixture is temporarily in use' },
        },
      });
      let reject: (error: Error) => void = () => {};
      const remove = vi
        .fn()
        .mockImplementationOnce(() => {
          if (timing === 'immediate') return Promise.reject(conflict);
          return new Promise<void>((_resolve, fail) => {
            reject = fail;
          });
        })
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
      const dialog = within(screen.getByRole('dialog'));
      if (timing === 'deferred') {
        expect(await dialog.findByRole('img', { name: 'loading' })).toBeTruthy();
        fireEvent.click(dialog.getByRole('button', { name: /OK/ }));
        expect(remove).toHaveBeenCalledTimes(1);
        await act(async () => reject(conflict));
      }
      expect((await dialog.findByRole('alert')).textContent).toContain(
        'This fixture is temporarily in use',
      );
      await waitFor(() => expect(dialog.queryByRole('img', { name: 'loading' })).toBeNull());
      const retry = dialog.getByRole('button', { name: 'OK' });
      expect((retry as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(retry);
      await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );
});
