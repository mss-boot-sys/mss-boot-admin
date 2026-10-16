import { getRequestErrorCode, getRequestErrorMessage } from '@mss-admin-core/shared/api/errors';

/** Search translated labels without teaching the backend a frontend locale catalog. */
export function localizedMenuNameKeys(messages: Record<string, unknown>, query?: string): string[] {
  const search = query?.normalize('NFKC').trim().toLocaleLowerCase();
  if (!search) return [];
  return Object.entries(messages)
    .filter(
      ([key, label]) =>
        key.startsWith('menu.') &&
        typeof label === 'string' &&
        label.normalize('NFKC').toLocaleLowerCase().includes(search),
    )
    .map(([key]) => key)
    .sort()
    .slice(0, 1_000);
}

const MENU_ERROR_MESSAGES: Record<string, string> = {
  MENU_HIERARCHY_INVALID: 'menu.error.hierarchy',
  MENU_AUTHORIZATION_IN_USE: 'menu.error.authorizationInUse',
  MENU_PERMISSION_CONFLICT: 'menu.error.permissionConflict',
  MENU_NOT_FOUND: 'menu.error.notFound',
};

export function menuWriteErrorMessage(error: unknown, localize: (id: string) => string): string {
  const messageID = MENU_ERROR_MESSAGES[getRequestErrorCode(error) ?? ''];
  return messageID ? localize(messageID) : getRequestErrorMessage(error);
}
