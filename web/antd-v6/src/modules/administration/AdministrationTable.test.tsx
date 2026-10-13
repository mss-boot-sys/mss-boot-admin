import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdministrationTable from './AdministrationTable';

vi.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const tableProps = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));
vi.mock('@mss-admin-core/shared/design-system/ResponsiveEntityTable', () => ({
  default: (props: Record<string, unknown>) => {
    tableProps.current = props;
    return <div data-testid="responsive-table" />;
  },
}));

const query = {
  data: { current: 1, data: [], pageSize: 20, total: 0 },
  error: null,
  isError: false,
  isFetching: false,
  isPending: false,
  refetch: vi.fn(),
};

describe('administration search presentation', () => {
  afterEach(cleanup);

  it('reacts to an active collapsed default and keeps toolbar access while allowing expansion', async () => {
    const props = {
      columns: [],
      emptyText: 'No users',
      mobileColumnKeys: [],
      nameSearch: {
        component: 'input',
        field: 'name',
        label: 'Name filter',
        order: 10,
      },
      params: { current: 1, pageSize: 20 as const, status: 'all' as const },
      query: query as never,
      setParams: vi.fn(),
      toolbar: <button type="button">Create user</button>,
    };
    const view = render(
      <App>
        <AdministrationTable {...props} searchCollapsedByDefault={false} />
      </App>,
    );

    expect(screen.getByText('Name filter')).toBeTruthy();
    view.rerender(
      <App>
        <AdministrationTable {...props} searchCollapsedByDefault />
      </App>,
    );

    await waitFor(() => expect(screen.queryByText('Name filter')).toBeNull());
    expect(screen.getByRole('button', { name: 'Create user' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'actions.search' }));
    expect(screen.getByText('Name filter')).toBeTruthy();
  });

  it('applies status chips, persists column/density preferences and never hides actions', async () => {
    window.localStorage.clear();
    const setParams = vi.fn();
    const columns = [
      { key: 'username', title: 'Account' },
      { key: 'email', title: 'Email' },
      { key: 'actions', title: 'Actions' },
    ];
    render(
      <App>
        <AdministrationTable
          columns={columns}
          emptyText="none"
          mobileColumnKeys={[]}
          params={{ current: 1, pageSize: 20, status: 'all' }}
          query={query as never}
          setParams={setParams}
          settingsKey="test"
          density="middle"
          extraFilters={<span>extra-chip</span>}
        />
      </App>,
    );
    expect(screen.getByText('extra-chip')).toBeTruthy();
    expect(tableProps.current?.size).toBe('middle');

    fireEvent.click(screen.getByRole('button', { name: /administration.field.status/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'administration.status.locked' }));
    const update = setParams.mock.calls.at(-1)?.[0] as (value: unknown) => unknown;
    expect(update({ current: 3, pageSize: 20, status: 'all' })).toEqual({
      current: 1,
      pageSize: 20,
      status: 'locked',
    });

    fireEvent.click(screen.getByRole('button', { name: 'administration.settings.label' }));
    const labels = (await screen.findAllByRole('checkbox')).map(
      (box) => box.closest('label')?.textContent,
    );
    expect(labels).toEqual(['Account', 'Email']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Email' }));
    await waitFor(() =>
      expect(((tableProps.current?.columns ?? []) as { key: string }[]).map((c) => c.key)).toEqual([
        'username',
        'actions',
      ]),
    );
    // The last visible business column cannot be hidden.
    expect(screen.getByRole('checkbox', { name: 'Account' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('administration.settings.density.small'));
    await waitFor(() => expect(tableProps.current?.size).toBe('small'));
    expect(JSON.parse(window.localStorage.getItem('mss-admin.table.test') ?? '{}')).toEqual({
      hidden: ['email'],
      density: 'small',
    });
  });
});
