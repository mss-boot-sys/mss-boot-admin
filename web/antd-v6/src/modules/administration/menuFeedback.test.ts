import { describe, expect, it } from 'vitest';
import { localizedMenuNameKeys, menuWriteErrorMessage } from './menuFeedback';

describe('menu search and mutation feedback', () => {
  it('finds nested translated labels without sending unrelated locale entries', () => {
    const messages = {
      'menu.origination.user': '用户管理',
      'menu.business.review': '业务审核',
      'user.field.name': '用户管理',
      'menu.dynamic': [{ type: 0, value: '用户管理' }],
    };
    expect(localizedMenuNameKeys(messages, ' 用户 ')).toEqual(['menu.origination.user']);
    expect(localizedMenuNameKeys(messages, '审核')).toEqual(['menu.business.review']);
    expect(localizedMenuNameKeys({ 'menu.users': 'Users' }, 'USERS')).toEqual(['menu.users']);
    expect(localizedMenuNameKeys(messages, '   ')).toEqual([]);
  });

  it('explains protected regrouping in the active language and retains unknown failures', () => {
    expect(
      menuWriteErrorMessage(
        { response: { status: 409, data: { errorCode: 'MENU_AUTHORIZATION_IN_USE' } } },
        (id) => `translated:${id}`,
      ),
    ).toBe('translated:menu.error.authorizationInUse');
    expect(menuWriteErrorMessage(new Error('unavailable'), (id) => id)).toBe('unavailable');
  });
});
