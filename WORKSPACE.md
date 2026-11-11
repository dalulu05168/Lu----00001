# 当前维护入口

本目录为保留原项目Git历史的交付工作树，分支delivery/unified-platform-audit。原临时checkout及桌面原型不覆盖、不删除。

- cloudflare-release：电脑前台、后台、服务端、数据库迁移及验收脚本。
- mobile-client：客户手机界面及后台App镜像共用源文件。
- 运行构建：`node cloudflare-release/scripts/build.cjs`。
- 手机单元测试：`node --test mobile-client/adapter.test.mjs mobile-client/experience.test.mjs`。

归并基线的Worker SHA256为9bc7e753e04c0fe7c04ab368f873d8c532b9da04b7972c0b753f459a6a5f416a。后续候选改动会改变哈希，不代表已经上线。

生产实测仅确认主站和后台域名属于Cloudflare活动版本bea31227。m子域名尚为旧Vercel展示页。历史docs中的生产版本与测试属于相应历史阶段，不自动适用于本分支候选改动。

禁止提交或发布凭证、fixtures、测试数据库、artifacts中的原始敏感记录。生产客户数据不可作为假数据测试目标。
