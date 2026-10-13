import LockOutlined from '@ant-design/icons/LockOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { useIntl } from '@umijs/max';
import { Alert, Button, Empty, Result, Skeleton } from 'antd';
import type { ReactNode } from 'react';

export function PageLoading({
  rows = 5,
  retrying = false,
  retryingMessage,
}: {
  rows?: number;
  /** True after a failed attempt while the query client retries automatically. */
  retrying?: boolean;
  retryingMessage?: ReactNode;
}) {
  return (
    <div aria-busy="true" role="status" className="flex flex-col gap-4">
      {retrying && retryingMessage ? (
        <Alert showIcon type="warning" title={retryingMessage} />
      ) : null}
      <Skeleton active paragraph={{ rows }} title />
    </div>
  );
}

export function PageEmpty({ description }: { description: ReactNode }) {
  return <Empty description={description} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}

export function PageError({
  message,
  onRetry,
  retryLabel,
  title,
}: {
  message: ReactNode;
  onRetry: () => void;
  retryLabel?: ReactNode;
  title?: ReactNode;
}) {
  const intl = useIntl();
  return (
    <Result
      status="error"
      title={title ?? intl.formatMessage({ id: 'states.loadError' })}
      subTitle={message}
      extra={
        <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
          {retryLabel ?? intl.formatMessage({ id: 'actions.retry' })}
        </Button>
      }
    />
  );
}

export function PageForbidden({ message }: { message?: ReactNode }) {
  const intl = useIntl();
  return (
    <Result
      status="403"
      icon={<LockOutlined />}
      title="403"
      subTitle={message ?? intl.formatMessage({ id: 'states.forbidden' })}
    />
  );
}
