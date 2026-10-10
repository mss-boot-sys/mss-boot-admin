# 自定义头像面板、顶部操作区和页脚

本文对应 v1.3.9 的编译期头像、页头与页脚业务扩展能力。

已发布的 v1.3.9 不包含本页介绍的扩展接口。
采用包含该能力的正式 Admin Distribution 后，Thin Host 可以在桌面和移动端的
同一个头像面板中注册自己的 React 内容。官方继续管理账户中心、个人设置、
退出登录和会话清理。没有注册内容时，保留官方账户菜单。

该能力的机器契约见
[`admin-avatar-contributions`](https://github.com/mss-boot-sys/mss-boot-admin/blob/main/.mss/features/admin-avatar-contributions.yaml)。
Foundation 提供通用内容扩展；数据、文案、接口和业务规则由宿主负责。

## 注册内容

在业务目录添加 `web/src/business/avatar.ts`：

```ts
import { defineAvatarContributions } from '@mss-boot-sys/admin-web/runtime';
import { lazy } from 'react';

export default defineAvatarContributions([
  { id: 'custom-panel', component: lazy(() => import('./CustomPanel')) },
]);
```

业务组件 `web/src/business/CustomPanel.tsx` 可以使用已有的 React、Ant Design、
国际化和查询 Provider。例如下面的中性示例只展示当前用户，并提供关闭按钮：

```tsx | pure
import type { AvatarContext } from '@mss-boot-sys/admin-web/runtime';
import { useIntl } from '@umijs/max';
import { Button, Space, Typography } from 'antd';

export default function CustomPanel({ currentUser, close }: AvatarContext) {
  const intl = useIntl();
  return (
    <Space orientation="vertical">
      <Typography.Text>{currentUser.name || currentUser.username}</Typography.Text>
      <Button onClick={close}>
        {intl.formatMessage({ id: 'business.customPanel.close' })}
      </Button>
    </Space>
  );
}
```

宿主在中英文语言文件中定义 `business.customPanel.close`。无需修改生成的
`app.tsx`、覆盖整个头部、深层导入核心模块或复制官方退出逻辑。

需要其他文件位置时，使用现有 `defineBusinessAdmin` 的可选配置：

```ts
defineBusinessAdmin({ avatarContributions: './src/business/custom-avatar.ts' });
```

显式路径优先于约定文件；未提供时读取 `src/business/avatar.ts`，文件不存在则使用空注册。
构建、TypeScript 和安装包测试使用相同解析规则。路径是可信的编译期模块，不接受远程脚本。

## 契约和生命周期

| 字段 | 行为 |
| --- | --- |
| `id` | 唯一小写字母开头，可含数字与连字符，最长 64 字符；最多 12 项，按声明顺序显示。 |
| `component` | React 组件，支持函数、类、`memo`、`forwardRef` 和 `lazy`。 |
| `permission` | 可选；省略表示已登录用户可见，指定时必须是非空权限标识并通过现有可见性检查。 |
| `currentUser` | 已验证的当前用户资料。 |
| `open` | 面板展开状态；内容只在展开且有权限时挂载，正常挂载期间为 `true`。 |
| `close()` | 关闭面板并将焦点返回头像按钮。 |

面板关闭、身份或会话变化时，宿主内容卸载，局部组件状态重置。没有身份、面板未展开或
没有相应权限时，不挂载组件，也不触发首次懒加载。再次展开会重新挂载；模块本身仍遵循
React 和浏览器的加载缓存。每个组件有独立的加载提示和渲染错误边界，其他内容及官方菜单仍可用。
事件处理和异步请求的错误需要业务组件自行处理。

需要请求数据时，在组件内使用现有查询客户端，以用户 ID 作为查询键的一部分；在卸载时
取消订阅或请求，避免旧响应覆盖新身份的数据。定义清楚的加载、空、失败和重试状态。
前端 `permission` 只控制展示，业务接口仍必须在后端鉴权。

## 交互和验证

注册内容后，头像按钮通过点击、Enter、Space 或向下箭头打开面板。Tab 可穿过自定义控件，
Escape 返回头像按钮，点击外部或将焦点移出面板会关闭；外部点击不会强行抢回焦点。
自定义区域和官方菜单在同一浮层中，普通控件交互不会自动关闭面板，需要时调用 `close()`。

使用 Ant Design 公共 token 和响应式布局，避免固定最小宽度；为交互控件提供可访问名称，
并同步宿主的中英文文案。面板有窄屏宽度和视口高度限制，但业务组件仍负责自身的可读性。

该业务目录属于宿主，协调升级保留注册文件及组件。Foundation 的验证覆盖空注册、显式路径、
可见性、懒加载、错误隔离、身份变化和官方动作，并使用真实 npm 安装的外部 Thin Host
验证构建、升级保留及桌面/移动交互。退出功能始终由官方组件执行。

撤销定制时移除注册项；无需数据迁移，也不需要更改后端权限。

## 顶部操作区和页脚

这两个位置共用 `web/src/business/layout.ts` 注册文件：

```ts
import { defineLayoutContributions } from '@mss-boot-sys/admin-web/runtime';
import { lazy } from 'react';

export default defineLayoutContributions([
  { id: 'custom-action', position: 'header', component: lazy(() => import('./CustomAction')) },
  { id: 'custom-footer', position: 'footer', component: lazy(() => import('./CustomFooter')) },
]);
```

显式文件位置使用 `defineBusinessAdmin({ layoutContributions: './src/business/custom-layout.ts' })`。
每项同样具有唯一 `id`、可选 `permission` 和 `component`，另需指定
`position: 'header' | 'footer'`；最多 12 项。没有注册时不添加区域。

组件接收公开 `LayoutContext`：`currentUser` 和 `compact`。`compact` 在移动端顶部操作区
为 `true`，桌面顶部和页脚为 `false`。顶部组件应适应紧凑空间，例如根据 `compact` 显示
有可访问名称的图标按钮。自定义区域限制自身宽度，保留官方菜单搜索、通知、语言切换等控件。
页脚内容追加在已有版权、备案和官方链接之后。

布局内容随已登录的应用外壳挂载；身份、会话变化会重置局部状态。没有身份或权限时不挂载。
懒加载和错误边界逐项隔离，异步数据及控件交互仍由宿主负责。顶部、页脚没有头像的
`open/close` 生命周期。注册文件和组件放在宿主业务目录，协调升级会保留这些文件。

## 现有定制入口的边界

| 位置 | 通用入口 | 官方保留的职责 |
| --- | --- | --- |
| 头像面板 | `avatarContributions` | 账户导航、退出和会话清理 |
| 顶部操作区、页脚 | `layoutContributions` | 核心操作、版权和备案信息 |
| 工作台 | 已有 `workplaceContributions` | 欢迎区、快捷链接、监控 |
| 业务页面、菜单 | 已有业务路由及模块注册 | 核心路由、认证和后端授权 |
| 标题、标志、主题及页面呈现 | 已有应用与呈现配置 | 配置校验及生效规则 |

以上均为增加宿主拥有的内容。账户设置标签页涉及保留键、深链接和安全设置生命周期，
登录页涉及认证流程；本次没有开放这两类页面的替换接口。
