import SettingOutlined from '@ant-design/icons/SettingOutlined';
import { useIntl } from '@umijs/max';
import { Button, Checkbox, Popover, Segmented } from 'antd';

export type TableDensity = 'small' | 'middle' | 'large';

export interface TableSettingsColumn {
  key: string;
  title: string;
}

export function TableSettings({
  columns,
  hidden,
  density,
  onHiddenChange,
  onDensityChange,
  onReset,
}: {
  columns: readonly TableSettingsColumn[];
  hidden: readonly string[];
  density: TableDensity;
  onHiddenChange: (hidden: string[]) => void;
  onDensityChange: (density: TableDensity) => void;
  onReset: () => void;
}) {
  const intl = useIntl();
  const visible = columns.filter((column) => !hidden.includes(column.key));
  const content = (
    <div className="mss-table-settings">
      <div>
        <div className="mss-table-settings-label">
          {intl.formatMessage({ id: 'administration.settings.density' })}
        </div>
        <Segmented<TableDensity>
          block
          size="small"
          value={density}
          onChange={onDensityChange}
          options={(['small', 'middle', 'large'] as const).map((value) => ({
            value,
            label: intl.formatMessage({ id: `administration.settings.density.${value}` }),
          }))}
        />
      </div>
      <div>
        <div className="mss-table-settings-label">
          {intl.formatMessage({ id: 'administration.settings.columns' })}
        </div>
        <div className="flex flex-col gap-1">
          {columns.map((column) => {
            const checked = !hidden.includes(column.key);
            return (
              <Checkbox
                key={column.key}
                checked={checked}
                // Keep at least one business column visible.
                disabled={checked && visible.length <= 1}
                onChange={(event) =>
                  onHiddenChange(
                    event.target.checked
                      ? hidden.filter((key) => key !== column.key)
                      : [...hidden, column.key],
                  )
                }
              >
                {column.title}
              </Checkbox>
            );
          })}
        </div>
      </div>
      <Button size="small" type="link" className="self-start p-0" onClick={onReset}>
        {intl.formatMessage({ id: 'actions.reset' })}
      </Button>
    </div>
  );
  return (
    <Popover content={content} placement="bottomRight" trigger="click">
      <Button
        aria-label={intl.formatMessage({ id: 'administration.settings.label' })}
        className="mss-tabular mss-toolbar-quiet"
        icon={<SettingOutlined />}
        size="small"
        type="text"
      >
        {intl.formatMessage({ id: 'administration.settings.label' })}
      </Button>
    </Popover>
  );
}
