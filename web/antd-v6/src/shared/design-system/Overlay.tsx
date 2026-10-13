import { Drawer, type DrawerProps, Grid, Modal, type ModalProps } from 'antd';
import { type DrawerSize, type ModalSize, overlayWidths } from './tokens';

export interface FormModalProps extends Omit<ModalProps, 'width'> {
  size?: ModalSize;
}

/** Create/edit/confirm dialog with standard widths. */
export function FormModal({ size = 'sm', ...props }: FormModalProps) {
  return <Modal width={overlayWidths.modal[size]} {...props} />;
}

export interface DetailDrawerProps extends Omit<DrawerProps, 'width' | 'size'> {
  size?: DrawerSize;
}

/** Detail / secondary-flow drawer: standard widths, full screen on phones. */
export function DetailDrawer({ size = 'md', ...props }: DetailDrawerProps) {
  const screens = Grid.useBreakpoint();
  return <Drawer size={screens.sm === false ? '100%' : overlayWidths.drawer[size]} {...props} />;
}
