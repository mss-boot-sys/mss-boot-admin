import MoreOutlined from '@ant-design/icons/MoreOutlined';
import { getRequestErrorMessage } from '@mss-admin-core/shared/api/errors';
import { useIntl } from '@umijs/max';
import { Alert, App, Button, Dropdown } from 'antd';
import type { ReactNode } from 'react';

export interface RowAction {
  key: string;
  label: ReactNode;
  /** Stable accessible name when `label` is operator-configurable. */
  ariaLabel?: string;
  /** Returned promises keep a confirmation open until the action succeeds. */
  onClick: () => unknown;
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
      const confirmation = action.confirm;
      const dialog = modal.confirm({
        title: action.confirm.title,
        content: action.confirm.description,
        okButtonProps: { danger: action.danger },
        // Return the action promise so the modal owns pending state, duplicate
        // click protection and resetting the confirmation button after failure.
        onOk: () =>
          Promise.resolve()
            .then(() => action.onClick())
            .catch((error: unknown) => {
              dialog.update({
                content: (
                  <div className="flex flex-col gap-3">
                    {confirmation.description}
                    <Alert
                      showIcon
                      type="error"
                      title={intl.formatMessage({ id: 'actions.failed' })}
                      description={getRequestErrorMessage(error)}
                    />
                  </div>
                ),
              });
              throw error;
            }),
      });
      // Hook modal's public await mode handles a rejected onOk promise without
      // emitting an unhandled rejection; the visible error above stays open.
      void Promise.resolve(dialog);
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
          danger={primary.danger}
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
