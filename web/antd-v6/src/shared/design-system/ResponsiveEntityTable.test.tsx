import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TableColumnsType } from 'antd';
import { type Key, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResponsiveEntityTable from './ResponsiveEntityTable';

const viewport = vi.hoisted(() => ({ md: false }));

vi.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: { name?: string; level?: number }) => {
      if (id === 'administration.table.expand') return `Expand ${values?.name}`;
      if (id === 'administration.table.collapse') return `Collapse ${values?.name}`;
      if (id === 'administration.table.level') return `Level ${values?.level}`;
      return values ? `Select ${values.name}` : id;
    },
  }),
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Grid: {
      ...actual.Grid,
      useBreakpoint: () => ({ md: viewport.md }),
    },
  };
});

interface Row {
  id: string;
  name: string;
  status: string;
}

const edit = vi.fn();
const columns: TableColumnsType<Row> = [
  { dataIndex: 'name', key: 'name', title: '名称' },
  {
    dataIndex: 'status',
    key: 'status',
    title: '状态',
    render: (value) => <strong>{value === 'enabled' ? '启用' : '停用'}</strong>,
  },
  {
    key: 'actions',
    title: '操作',
    render: (_, row) => (
      <button type="button" onClick={() => edit(row.id)}>
        编辑
      </button>
    ),
  },
];

beforeEach(() => {
  edit.mockReset();
  viewport.md = false;
});

describe('ResponsiveEntityTable', () => {
  it('renders the selected fields and row actions as a mobile card', () => {
    render(
      <ResponsiveEntityTable<Row>
        columns={columns}
        dataSource={[{ id: 'row-1', name: '总部', status: 'enabled' }]}
        mobileColumnKeys={['name', 'status', 'actions']}
        pagination={false}
        rowKey="id"
      />,
    );

    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(screen.getByText('总部')).toBeTruthy();
    expect(screen.getByText('启用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(edit).toHaveBeenCalledWith('row-1');
  });

  it('keeps the Ant Design table on desktop', () => {
    viewport.md = true;

    render(
      <ResponsiveEntityTable<Row>
        columns={columns}
        dataSource={[{ id: 'row-1', name: '总部', status: 'enabled' }]}
        mobileColumnKeys={['name']}
        pagination={false}
        rowKey="id"
      />,
    );

    expect(screen.getByRole('columnheader', { name: '名称' })).toBeTruthy();
  });
  it('selects mobile rows, skips disabled records and preserves selection across breakpoints', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const onSelectAll = vi.fn();
    const rows = [
      { id: 'row-1', name: 'Headquarters', status: 'enabled' },
      { id: 'row-2', name: 'Branch', status: 'enabled' },
      { id: 'row-3', name: 'Protected', status: 'enabled' },
    ];
    function SelectableTable() {
      const [keys, setKeys] = useState<Key[]>([]);
      return (
        <ResponsiveEntityTable<Row>
          columns={columns}
          dataSource={rows}
          mobileColumnKeys={['name', 'actions']}
          pagination={false}
          rowKey="id"
          rowSelection={{
            selectedRowKeys: keys,
            getCheckboxProps: (row) => ({ disabled: row.id === 'row-3' }),
            onChange: (next, records, info) => {
              setKeys(next);
              onChange(next, records, info);
            },
            onSelect,
            onSelectAll,
          }}
        />
      );
    }
    const view = render(<SelectableTable />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Headquarters' }));
    expect(onSelect.mock.calls[0]?.slice(0, 3)).toEqual([rows[0], true, [rows[0]]]);
    expect(onChange).toHaveBeenLastCalledWith(['row-1'], [rows[0]], { type: 'single' });
    expect(
      (screen.getByRole('checkbox', { name: 'Select Protected' }) as HTMLInputElement).disabled,
    ).toBe(true);
    const selectAll = screen.getByRole('checkbox', { name: 'administration.bulk.selectAll' });
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(selectAll);
    expect(onChange).toHaveBeenLastCalledWith(['row-1', 'row-2'], rows.slice(0, 2), {
      type: 'all',
    });
    expect(onSelectAll).toHaveBeenLastCalledWith(true, rows.slice(0, 2), [rows[1]]);
    viewport.md = true;
    view.rerender(<SelectableTable />);
    await waitFor(() => expect(screen.getByRole('columnheader', { name: '名称' })).toBeTruthy());
    const desktopRows = screen.getAllByRole('checkbox');
    expect(desktopRows.slice(1).map((item) => (item as HTMLInputElement).checked)).toEqual([
      true,
      true,
      false,
    ]);
    viewport.md = false;
    view.rerender(<SelectableTable />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'administration.bulk.selectAll' }));
    expect(onChange).toHaveBeenLastCalledWith([], [], { type: 'all' });
  });

  it('retains uncontrolled selection across pages only when requested and hides controls when revoked', () => {
    const rows = [
      { id: 'row-1', name: 'First', status: 'enabled' },
      { id: 'row-2', name: 'Second', status: 'enabled' },
    ];
    const onChange = vi.fn();
    const props = {
      columns,
      mobileColumnKeys: ['name'],
      pagination: false as const,
      rowKey: 'id',
      rowSelection: { preserveSelectedRowKeys: true, onChange },
    };
    const view = render(<ResponsiveEntityTable {...props} dataSource={rows.slice(0, 1)} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First' }));
    view.rerender(<ResponsiveEntityTable {...props} dataSource={rows.slice(1)} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }));
    expect(onChange).toHaveBeenLastCalledWith(['row-1', 'row-2'], rows, { type: 'single' });
    view.rerender(<ResponsiveEntityTable {...props} dataSource={rows} rowSelection={undefined} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    view.rerender(<ResponsiveEntityTable {...props} dataSource={rows} />);
    expect(
      (screen.getByRole('checkbox', { name: 'Select First' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('supports radio selection without a select-all control', () => {
    const onChange = vi.fn();
    render(
      <ResponsiveEntityTable<Row>
        columns={columns}
        dataSource={[{ id: 'row-1', name: 'Single', status: 'enabled' }]}
        mobileColumnKeys={['name']}
        pagination={false}
        rowKey="id"
        rowSelection={{ type: 'radio', onChange }}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Select Single' }));
    expect(onChange.mock.calls[0]?.[0]).toEqual(['row-1']);
  });
  it('expands five levels of mobile tree cards without hiding identity or selecting collapsed rows', () => {
    interface TreeRow extends Row {
      children?: TreeRow[];
    }
    const leaf: TreeRow = { id: 'fifth', name: 'Fifth', status: 'enabled' };
    let root = leaf;
    for (const name of ['Fourth', 'Third', 'Second', 'First']) {
      root = { id: name.toLowerCase(), name, status: 'enabled', children: [root] };
    }
    const onChange = vi.fn();
    render(
      <ResponsiveEntityTable<TreeRow>
        columns={columns}
        dataSource={[root]}
        mobileColumnKeys={['name', 'actions']}
        pagination={false}
        rowKey="id"
        rowSelection={{ onChange, getCheckboxProps: (row) => ({ disabled: row.id === 'third' }) }}
      />,
    );
    expect(screen.queryByText('Fifth')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'administration.bulk.selectAll' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual(['first']);
    for (const name of ['First', 'Second', 'Third', 'Fourth']) {
      fireEvent.click(screen.getByRole('button', { name: `Expand ${name}` }));
    }
    expect(screen.getByText('Fifth')).toBeTruthy();
    expect(screen.getByText('Level 5')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(5);
    fireEvent.click(screen.getByRole('checkbox', { name: 'administration.bulk.selectAll' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual(['first', 'second', 'fourth', 'fifth']);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse First' }));
    expect(screen.queryByText('Fifth')).toBeNull();
  });

  it('honors controlled expansion and custom child keys across desktop and mobile', () => {
    interface TreeRow extends Row {
      nodes?: TreeRow[];
    }
    const child = { id: 'child', name: 'Child', status: 'enabled' };
    const root = { id: 'root', name: 'Root', status: 'enabled', nodes: [child] };
    const onExpand = vi.fn();
    const onExpandedRowsChange = vi.fn();
    const props = {
      columns,
      dataSource: [root],
      mobileColumnKeys: ['name'],
      pagination: false as const,
      rowKey: 'id',
      expandable: {
        childrenColumnName: 'nodes',
        expandedRowKeys: [] as Key[],
        onExpand,
        onExpandedRowsChange,
      },
    };
    const view = render(<ResponsiveEntityTable<TreeRow> {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
    expect(onExpand).toHaveBeenCalledWith(true, root);
    expect(onExpandedRowsChange).toHaveBeenCalledWith(['root']);
    expect(screen.queryByText('Child')).toBeNull();
    const expandedProps = {
      ...props,
      expandable: { ...props.expandable, expandedRowKeys: ['root'] },
    };
    view.rerender(<ResponsiveEntityTable<TreeRow> {...expandedProps} />);
    expect(screen.getByText('Child')).toBeTruthy();
    viewport.md = true;
    view.rerender(<ResponsiveEntityTable<TreeRow> {...expandedProps} />);
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeTruthy();
    expect(screen.getByText('Child')).toBeTruthy();
  });
});
