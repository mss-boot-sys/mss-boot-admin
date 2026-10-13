import CloseOutlined from '@ant-design/icons/CloseOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { useIntl } from '@umijs/max';
import { Dropdown } from 'antd';

export interface FilterChipOption {
  value: string;
  label: string;
}

/**
 * "+ 角色" style additive filter. Empty: a dashed add chip that opens a menu.
 * Active: a filled chip "角色：X" with a clear button.
 */
export function FilterChipSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly FilterChipOption[];
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const intl = useIntl();
  const selected = options.find((option) => option.value === value);
  if (value) {
    return (
      <span className="mss-filter-chip" data-active="true">
        {label}：{selected?.label ?? value}
        <button
          aria-label={intl.formatMessage({ id: 'administration.filter.clear' }, { name: label })}
          className="mss-filter-chip-clear"
          type="button"
          onClick={() => onChange(undefined)}
        >
          <CloseOutlined />
        </button>
      </span>
    );
  }
  return (
    <Dropdown
      disabled={options.length === 0}
      trigger={['click']}
      menu={{
        items: options.map((option) => ({ key: option.value, label: option.label })),
        onClick: ({ key }) => onChange(key),
        style: { maxHeight: 320, overflowY: 'auto' },
      }}
    >
      <button className="mss-filter-chip mss-filter-chip-add" type="button">
        <PlusOutlined /> {label}
      </button>
    </Dropdown>
  );
}
