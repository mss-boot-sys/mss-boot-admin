import { SearchOutlined } from '@ant-design/icons';
import { Button, Input } from 'antd';
import type { ComponentProps, ReactNode } from 'react';

/** Card surface that hosts a list toolbar and its table. */
export function ListSurface({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={`mss-surface overflow-hidden ${className ?? ''}`}>{children}</section>;
}

export interface ListToolbarProps {
  /** Left side: SearchField, FilterChipSelect, segmented filters. */
  children?: ReactNode;
  /** "共 N 条" style summary shown before the end actions. */
  total?: ReactNode;
  /** Right side quiet actions: export, refresh, TableSettings. */
  end?: ReactNode;
}

/** Single-row toolbar above every list table. */
export function ListToolbar({ children, total, end }: ListToolbarProps) {
  return (
    <div className="mss-list-toolbar">
      {children}
      <div className="mss-list-toolbar-end">
        {total !== undefined && total !== null ? (
          <span className="mss-list-total">{total}</span>
        ) : null}
        {end}
      </div>
    </div>
  );
}

export interface SearchFieldProps {
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
}

/** Keyword search input used by list toolbars. */
export function SearchField({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onSearch,
}: SearchFieldProps) {
  return (
    <Input
      allowClear
      aria-label={ariaLabel ?? placeholder}
      className="mss-search-field"
      onChange={(event) => {
        onChange?.(event.target.value);
        if (!event.target.value) onSearch?.('');
      }}
      onPressEnter={(event) => onSearch?.((event.target as HTMLInputElement).value)}
      placeholder={placeholder}
      prefix={<SearchOutlined className="mss-search-field-icon" />}
      value={value}
    />
  );
}

/** Quiet icon/text button for toolbar end actions. */
export function ToolbarButton(props: ComponentProps<typeof Button>) {
  return <Button type="text" className="mss-toolbar-quiet" {...props} />;
}

export interface BulkBarProps {
  count: number;
  ariaLabel?: string;
  label: ReactNode;
  clearLabel: ReactNode;
  onClear: () => void;
  children?: ReactNode;
}

/** Floating batch-action bar shown while table rows are selected. */
export function BulkBar({ count, ariaLabel, label, clearLabel, onClear, children }: BulkBarProps) {
  if (count <= 0) return null;
  return (
    <div aria-label={ariaLabel} className="mss-bulk-bar" role="toolbar">
      <span className="mss-tabular">{label}</span>
      {children}
      <Button className="mss-bulk-bar-clear" onClick={onClear} size="small" type="text">
        {clearLabel}
      </Button>
    </div>
  );
}

/**
 * Positions one filter control in a list toolbar. `order` comes from the
 * presentation registry so operators can reorder search fields.
 */
export function FilterSlot({ order, children }: { order?: number; children: ReactNode }) {
  // style-guardrail-ignore: registry-driven order is data, not styling.
  return (
    <div className="mss-filter-slot" style={{ order }}>
      {children}
    </div>
  );
}

/** Trailing slot of a list toolbar (search/reset/refresh/create). */
export function ListToolbarEnd({ children }: { children: ReactNode }) {
  return <div className="mss-list-toolbar-end">{children}</div>;
}

/** Toolbar filters hide their labels visually, so fall back to the label. */
export function filterPlaceholder(field: { placeholder?: unknown; label?: unknown }) {
  if (typeof field.placeholder === 'string' && field.placeholder) return field.placeholder;
  return typeof field.label === 'string' ? field.label : undefined;
}
