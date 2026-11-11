# 本地备份与安全巡检实施记录

## 已落地

- 运维代码：`ops/core.cjs`、`ops/runner.cjs`、`ops/vault.ps1`、`ops/install-local-tasks.ps1`、`ops/backup-role.sql`。
- 正式库 `bitter-heart-61838251 / br-crimson-morning-b3rhjeoi / neondb` 创建专用只读账号 `cn_backup_monitor`。为该账号增加序列 SELECT 及受保护表的 SELECT-only RLS 策略；没有关闭 RLS 或授予业务修改权限。实际检查 INSERT、UPDATE、DELETE、TRUNCATE、CREATE、序列 UPDATE 全部为 false。
- PostgreSQL 17.11 便携工具来自官方 Windows 下载页指定的 EnterpriseDB，ZIP SHA-256 与官方旁文件匹配；没有注册数据库服务或占用生产端口。
- `pg_dump` 使用 direct TLS 连接及 repeatable-read 导出快照；同一快照下记录逐表数据摘要。归档采用 AES-256-GCM，凭证和归档密钥由 Windows DPAPI 保护。
- 每次备份都恢复到随机端口的全新 localhost 数据库，比较表内容摘要、约束、序列及 RLS 策略，成功后才更新 latest-backup.json。已验证 37 张表、190 行、197 条约束和 1 个序列；不存在以“文件生成”代替恢复验收。
- 本机恢复数据库是临时的、仅监听 127.0.0.1、随机密码、受当前用户目录权限保护，核对完成后停止并清理该次临时实例。不会恢复生产库。
- 每天 04:00 加密备份及恢复核验，每 15 分钟只读巡检。Windows 普通用户计划任务 `CN-Capital-Encrypted-Backup` 和 `CN-Capital-Security-Monitor` 均实跑成功，LastTaskResult 为 0。
- 巡检覆盖两个 /ready 入口、数据库读取、登录请求限流窗口、账户余额与资金流水合计、备份文件完整性和 20 小时时效。此次巡检未发现异常。
- 告警支持连续两次站点异常、立即报告备份/账务异常、去重、恢复通知，以及数据库失联时不错误宣称账务已恢复；并发巡检与备份有互斥保护。

## 邮件状态

接收邮箱为 `dalulu05168@gmail.com`。每小时运行的 Codex 告警投递任务 `cn-capital` 已建立，只有获得 Gmail 成功回执后才将待发送事件转为已发送。

当前 Gmail 连接在执行途中失效，已经提示重新连接。**尚未发送验证邮件，不能认定邮件告警投递已完成。** 本机生成的事件保留在待发送目录；不通过制造生产故障验证投递。

## 路径与执行

运行数据和工具在 `C:/Users/mrmal/Desktop/手机端/安全备份`；不进入 Git。目录中提供三个可双击的 CMD：立即备份、检查状态、验证恢复。

在当前发布工作区运行：

```powershell
node --test cloudflare-release/ops/core.test.cjs
node cloudflare-release/ops/runner.cjs backup
node cloudflare-release/ops/runner.cjs monitor
node cloudflare-release/ops/runner.cjs restore-latest
```

7 项安全/完整性单元测试通过；已保存归档的二次恢复和计划任务恢复均通过。完整证据见 `docs/local-backup-alerts-evidence.json`。

## 使用限制与维护

- 这台电脑需要开机、登录并联网。邮件投递另需 Codex 和 Gmail 可用；本机方案不是全天候独立外部监控。
- DPAPI 密钥目前绑定当前 Windows 用户。将文件夹复制到 U 盘不能独立解决另一台电脑的解密恢复；跨机恢复密钥导出和异地托管尚未完成。
- 本次备份包含 public 模式业务数据；新增其他模式或不具备明确完整读取策略的新 RLS 表会使备份失败，需先审查备份范围，不能静默遗漏。
- 归档不含 Cloudflare 私密绑定值、外部数据服务密钥、Neon 全局角色或外部存储。生产恢复时须按运行配置清单重新配置，不能直接覆盖生产库。
- 不自动删除旧备份。只认 latest-backup.json 指向且有恢复验证记录的归档；没有成功验收记录的排查归档不当作可用备份。
- 本批未修改前台、后台、手机界面或线上 Worker。当前应用发布仍为会话安全版本 `8361c450-1112-4529-95bb-f67f88187234`；原域名、绑定与客户业务数据保留。

参考：[Neon 官方 pg_dump 备份与恢复](https://neon.com/docs/manage/backup-pg-dump)、[PostgreSQL 官方 Windows 下载](https://www.postgresql.org/download/windows/)。
