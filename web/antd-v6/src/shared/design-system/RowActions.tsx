import { MoreOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { App, Button, Dropdown } from 'antd';
import type { ReactNode } from 'react';

export interface RowAction {
  key: string;
  label: ReactNode;
  /** Stable accessible name when `label` is operator-configurable. */
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Danger actions ask for confirmation before running. */
  confirm?: { title: ReactNode; description?: ReactNode };
}

/**
 * Row action cell: one primary link action (usually 编辑) plus a "⋯" overflow
 * menu for the rest. Pass `undefined` / `false` to hide an action the operator
 * has no permission for; pass `disabled` to keep it visible but inert.
 */
export function RowActions({
  primary,
  more = [],
}: {
  primary?: RowAction | false | null;
  more?: Array<RowAction | false | null | undefined>;
}) {
  const intl = useIntl();
  const { modal } = App.useApp();
  const items = more.filter((item): item is RowAction => Boolean(item));
  if (!primary && items.length === 0) return null;
  const run = (action: RowAction) => {
    if (action.disabled) return;
    if (action.confirm) {
      modal.confirm({
        title: action.confirm.title,
        content: action.confirm.description,
        okButtonProps: { danger: action.danger },
        onOk: action.onClick,
      });
      return;
    }
    action.onClick();
  };
  return (
    <div className="flex items-center gap-1">
      {primary ? (
        <Button
          aria-label={primary.ariaLabel}
          disabled={primary.disabled}
          size="small"
          type="link"
          onClick={() => run(primary)}
        >
          {primary.label}
        </Button>
      ) : null}
      {items.length > 0 ? (
        <Dropdown
          trigger={['click']}
          menu={{
            items: items.map((item) => ({
              key: item.key,
              label: item.label,
              'aria-label': item.ariaLabel,
              danger: item.danger,
              disabled: item.disabled,
            })),
            onClick: ({ key }) => {
              const action = items.find((item) => item.key === key);
              if (action) run(action);
            },
          }}
        >
          <Button
            aria-label={intl.formatMessage({ id: 'actions.more' })}
            icon={<MoreOutlined />}
            size="small"
            type="text"
          />
        </Dropdown>
      ) : null}
    </div>
  );
}
