import { history, useIntl } from '@umijs/max';
import { Button, Result, Space } from 'antd';

/**
 * Friendly in-layout exception page. Rendered inside the application shell so
 * navigation stays available; the copy avoids implementation details.
 */
export default function ExceptionResult({ status }: { status: '403' | '404' }) {
  const intl = useIntl();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Result
        status={status}
        title={status}
        subTitle={intl.formatMessage({
          id: status === '403' ? 'states.forbidden' : 'states.notFound',
        })}
        extra={
          <Space wrap>
            <Button onClick={() => history.back()}>
              {intl.formatMessage({ id: 'actions.backToPrevious' })}
            </Button>
            <Button type="primary" onClick={() => history.push('/workplace')}>
              {intl.formatMessage({ id: 'actions.backToWorkplace' })}
            </Button>
          </Space>
        }
      />
    </div>
  );
}
