import LogoutOutlined from '@ant-design/icons/LogoutOutlined';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import { history, Link, useIntl } from '@umijs/max';
import {
  Avatar,
  Button,
  ConfigProvider,
  Dropdown,
  Menu,
  type MenuProps,
  Popover,
  Typography,
} from 'antd';
import {
  type ComponentProps,
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { clearServerSession } from '../auth/session';
import type { InitialState } from '../auth/types';
import {
  AvatarContributions,
  getVisibleAvatarContributions,
  registeredAvatarContributions,
} from '../avatar/AvatarContributions';
import type { AvatarContribution } from '../avatar/contract';
import HeaderNotice from '../navigation/HeaderNotice';
import LocaleSwitcher from '../navigation/LocaleSwitcher';
import MenuSearch from '../navigation/MenuSearch';
import { queryClient } from '../query/client';
import { clearUserThemeRuntime } from '../theme/runtime';
import { useAvatarMenuStyles } from './HeaderActions.styles';
import { LayoutContributions } from './LayoutContributions';

interface AvatarMenuProps {
  initialState?: InitialState;
  compact?: boolean;
  contributions?: readonly AvatarContribution[];
}

const AvatarPanelOpen = createContext(false);

function AvatarPanelFocus({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const open = useContext(AvatarPanelOpen);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => target.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, target]);
  return null;
}

function OpenAvatarContributions(props: Omit<ComponentProps<typeof AvatarContributions>, 'open'>) {
  // The overlay retains its last content element during the closing animation.
  // Context still propagates so host effects stop immediately when it closes.
  return <AvatarContributions {...props} open={useContext(AvatarPanelOpen)} />;
}

function markPickerPopup<T extends { popup?: string | { root?: string } }>(
  classNames: T | undefined,
  marker: string,
) {
  const popup =
    typeof classNames?.popup === 'string' ? { root: classNames.popup } : classNames?.popup;
  return { ...classNames, popup: { ...popup, root: `${popup?.root ?? ''} ${marker}` } };
}

export function AvatarMenu(props: AvatarMenuProps) {
  // A new authenticated identity must not inherit an open panel or local host state.
  const identity = JSON.stringify([
    props.initialState?.currentUser?.id,
    props.initialState?.authSessionId,
    props.initialState?.authorizationVersion,
  ]);
  return <AvatarMenuContent key={identity} {...props} />;
}

function AvatarMenuContent({
  initialState,
  compact = false,
  contributions = registeredAvatarContributions,
}: AvatarMenuProps) {
  const intl = useIntl();
  const { styles } = useAvatarMenuStyles();
  const { datePicker, timePicker } = useContext(ConfigProvider.ConfigContext);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const focusWithin = useRef(false);
  const popupID = useId();
  const nestedPopupClass = `${popupID}-nested-popup`;
  const nestedEscape = useRef(false);
  const currentUser = initialState?.currentUser;
  const label = currentUser?.name ?? currentUser?.username ?? 'MSS User';
  const custom = getVisibleAvatarContributions(currentUser, contributions).length > 0;
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  const menuItems: MenuProps['items'] = [
    {
      key: 'center',
      icon: <UserOutlined />,
      label: <Link to="/account/center">{intl.formatMessage({ id: 'menu.account-center' })}</Link>,
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: (
        <Link to="/account/settings">{intl.formatMessage({ id: 'menu.account-settings' })}</Link>
      ),
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: intl.formatMessage({ id: 'menu.logout' }),
      onClick: async () => {
        const { clearThemeIdentitySession } = await import('../theme/snapshot');
        const previousSessionID = clearThemeIdentitySession({
          broadcast: false,
          expectedSessionId: initialState?.authSessionId,
        });
        queryClient.clear();
        clearUserThemeRuntime();
        try {
          await clearServerSession();
        } finally {
          if (previousSessionID) {
            void import('../theme/sync')
              .then(({ publishThemeIdentityCleared }) =>
                publishThemeIdentityCleared(previousSessionID),
              )
              .catch(() => {});
          }
          history.replace('/user/login');
        }
      },
    },
  ];
  const avatarButton = (
    <Button
      ref={trigger}
      aria-controls={custom && open ? popupID : undefined}
      aria-expanded={open}
      aria-haspopup={custom ? 'dialog' : 'menu'}
      aria-label={intl.formatMessage({ id: 'navigation.accountMenu' }, { name: label })}
      className="h-auto px-1 py-0"
      htmlType="button"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setOpen(true);
        }
      }}
      icon={
        <Avatar src={currentUser?.avatar || undefined}>{label.slice(0, 1).toUpperCase()}</Avatar>
      }
      type="text"
    >
      {compact ? null : <Typography.Text>{label}</Typography.Text>}
    </Button>
  );
  return (
    <AvatarPanelOpen.Provider value={open}>
      {custom ? (
        <Popover
          arrow={false}
          destroyOnHidden
          open={open}
          onOpenChange={setOpen}
          placement="bottomRight"
          trigger="click"
          styles={{ container: { padding: 0, background: 'transparent' } }}
          content={
            <div
              ref={popup}
              aria-label={intl.formatMessage({ id: 'navigation.avatarPanel' })}
              className={styles.panel}
              data-testid="mss-avatar-panel"
              id={popupID}
              onFocusCapture={() => {
                // React focus events include owned portals such as host modals.
                focusWithin.current = true;
              }}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (
                  next instanceof Node &&
                  next !== trigger.current &&
                  !event.currentTarget.contains(next)
                ) {
                  focusWithin.current = false;
                  // The next focus event determines React ownership. DOM containment
                  // alone would dismiss the panel when a host portal gains focus.
                  queueMicrotask(() => {
                    if (!focusWithin.current && document.activeElement !== trigger.current)
                      setOpen(false);
                  });
                }
              }}
              onKeyDownCapture={(event) => {
                if (event.key !== 'Escape') return;
                const target = event.target;
                const expanded =
                  target instanceof Element
                    ? target.closest('[aria-haspopup][aria-expanded="true"]')
                    : null;
                // Some input-based popups (including DatePicker) handle Escape
                // without stopping propagation or exposing aria-expanded.
                // Read our public semantic marker before the child closes it.
                nestedEscape.current =
                  Boolean(expanded && event.currentTarget.contains(expanded)) ||
                  Array.from(document.getElementsByClassName(nestedPopupClass)).some((node) => {
                    const style = getComputedStyle(node);
                    // Closed popups disable pointer events inline; entry animation CSS
                    // may also disable them while the input still owns an open popup.
                    return (
                      style.display !== 'none' &&
                      style.visibility !== 'hidden' &&
                      !(node instanceof HTMLElement && node.style.pointerEvents === 'none')
                    );
                  });
              }}
              onKeyDown={(event) => {
                // Owned portals handle their own keyboard lifecycle.
                if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target))
                  return;
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  if (!event.defaultPrevented && !nestedEscape.current) close();
                }
              }}
              role="dialog"
              tabIndex={-1}
            >
              <AvatarPanelFocus target={popup} />
              <div className={styles.content}>
                <ConfigProvider
                  datePicker={{
                    ...datePicker,
                    classNames: (info) =>
                      markPickerPopup(
                        typeof datePicker?.classNames === 'function'
                          ? datePicker.classNames(info)
                          : datePicker?.classNames,
                        nestedPopupClass,
                      ),
                  }}
                  timePicker={{
                    ...timePicker,
                    classNames: (info) =>
                      markPickerPopup(
                        typeof timePicker?.classNames === 'function'
                          ? timePicker.classNames(info)
                          : timePicker?.classNames,
                        nestedPopupClass,
                      ),
                  }}
                >
                  <OpenAvatarContributions
                    close={close}
                    contributions={contributions}
                    currentUser={currentUser}
                  />
                </ConfigProvider>
              </div>
              <div className={styles.menu}>
                <Menu
                  items={menuItems}
                  onClick={close}
                  selectable={false}
                  className="mss-menu-plain"
                />
              </div>
            </div>
          }
        >
          {avatarButton}
        </Popover>
      ) : (
        <Dropdown
          autoFocus
          destroyOnHidden
          open={open}
          onOpenChange={setOpen}
          placement="bottomRight"
          trigger={['hover', 'click']}
          menu={{ items: menuItems }}
        >
          {avatarButton}
        </Dropdown>
      )}
    </AvatarPanelOpen.Provider>
  );
}

function DocumentationLink() {
  const intl = useIntl();
  return (
    <Button
      type="text"
      href="https://docs.mss-boot-io.top"
      target="_blank"
      rel="noreferrer"
      icon={<QuestionCircleOutlined />}
      aria-label={intl.formatMessage({ id: 'navigation.documentation' })}
    />
  );
}

export function HeaderActions({
  initialState,
  compact = false,
}: {
  initialState?: InitialState;
  compact?: boolean;
}) {
  return (
    <>
      <LayoutContributions compact={compact} initialState={initialState} position="header" />
      <MenuSearch items={initialState?.authorizedMenu ?? []} variant={compact ? 'icon' : 'field'} />
      <HeaderNotice user={initialState?.currentUser} />
      {compact ? null : <DocumentationLink />}
      <LocaleSwitcher />
    </>
  );
}

export function desktopHeaderActions(initialState?: InitialState) {
  return [
    <LayoutContributions key="custom-content" initialState={initialState} position="header" />,
    <MenuSearch key="menu-search" items={initialState?.authorizedMenu ?? []} variant="field" />,
    <HeaderNotice key="notice" user={initialState?.currentUser} />,
    <DocumentationLink key="documentation" />,
    <LocaleSwitcher key="language" />,
  ];
}
