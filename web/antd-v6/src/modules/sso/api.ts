import { request } from '@umijs/max';

export interface SSOClientInput {
  name: string;
  enabled: boolean;
  revision: number;
  redirectURIs: string[];
  scopes: string[];
  claims: string[];
  userIDs: string[];
  roleIDs: string[];
}
export interface SSOClient extends SSOClientInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface SSOAudit {
  id: string;
  userID: string;
  action: string;
  resource: string;
  status: string;
  createdAt: string;
}
interface Envelope<T> {
  success: boolean;
  data: T;
}
const options = { skipErrorHandler: true };
export const ssoAPI = {
  clients: async (current: number) =>
    (
      await request<Envelope<{ list: SSOClient[]; total: number; issuer: string }>>(
        '/sso/clients',
        { ...options, params: { current, pageSize: 20 } },
      )
    ).data,
  create: async (data: SSOClientInput) =>
    (
      await request<Envelope<{ client: SSOClient; secret: string }>>('/sso/clients', {
        ...options,
        method: 'POST',
        data,
      })
    ).data,
  update: async (id: string, data: SSOClientInput) =>
    request(`/sso/clients/${encodeURIComponent(id)}`, { ...options, method: 'PUT', data }),
  rotate: async (id: string, revision: number) =>
    (
      await request<Envelope<{ secret: string }>>(
        `/sso/clients/${encodeURIComponent(id)}/rotate-secret`,
        { ...options, method: 'POST', data: { revision } },
      )
    ).data,
  audit: async (current: number) =>
    (
      await request<Envelope<{ list: SSOAudit[]; total: number }>>('/sso/audit', {
        ...options,
        params: { current, pageSize: 20 },
      })
    ).data,
  rotateKey: async () => request('/sso/signing-keys/rotate', { ...options, method: 'POST' }),
};
