# Business content on the workplace

Version scope: v1.3.9 compile-time extension. External integration acceptance must be verified for the consuming host.

For other shared interface regions, see [avatar, header, and footer customization](./avatar-panel-customization.md).

Foundation keeps ownership of `/workplace`, its greeting, quick links, monitoring, authentication and layout. After adopting a coordinated distribution containing this extension, add the business-owned `web/src/business/workplace.ts`:

```ts
import { defineWorkplaceContributions } from '@mss-boot-sys/admin-web/runtime';
import { OrdersWorkspace } from './orders/OrdersWorkspace';

export default defineWorkplaceContributions([
  { id: 'orders', permission: 'orders:read', component: OrdersWorkspace },
]);
```

The component receives the verified `currentUser`, runs inside existing providers, and owns its loading, empty, error, and responsive states. Standard React function, class, memo, forward-ref, and lazy components are supported; a lazy module shows a local loading state while other workplace content remains available. It calls normal authorized APIs; visibility permissions never grant API access. Up to twelve uniquely named contributions appear in declaration order before core quick links. A render failure is isolated to its contribution with a generic localized message. Event-handler and asynchronous errors remain the business component's responsibility.

`defineBusinessAdmin` optionally accepts an explicit `workplaceContributions` module path. Otherwise it uses the conventional business-owned file when present, or an empty module. These are trusted compile-time declarations: no remote widgets, runtime script paths, route replacements, or authentication overrides. Existing hosts without a contribution retain their current workplace. Managed facades need no manual editing, and the file remains under existing business-directory upgrade preservation.

Publish only after the change is reviewed, merged into main, and qualifies through the coordinated release process. A development tarball is for isolated external-consumer tests, never a substitute for upgrading a deployed Thin Host to an official release.
