# CN Capital 新版三端 UI 预览

本分支只用于预览 `ui/stage2-20261108` 提交的新版三端静态界面：

- `/`：电脑前台
- `/mobile.html`：手机端
- `/admin.html`：管理后台

该预览不连接数据库、登录、真实行情、订单、资金、客服或管理 API。页面中的数据仅用于展示 UI 空态和失败状态，不代表真实账户或交易能力。

## Render Static Site

- Branch: `deploy/cn-capital-ui-preview-20261108`
- Build command: `node build-preview.mjs`
- Publish directory: `dist`

原始交接包保存在父提交的 `ui/stage2-20261108/` 路径；本分支根目录只保留发布所需的三份静态页面和最小构建配置，避免把后端源代码发布到静态目录。
