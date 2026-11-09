# 自动检查与主分支保护

## 已提交的工作流

`PR checks` 对所有指向 `main` 的 PR（含 fork）及 main push 运行，没有路径过滤和跳过规则。

- **Quality**：`npm ci`、Prettier、ESLint、TypeScript、Vitest+核心覆盖率、Vite build。
- **Browser smoke**：安装 Chromium 并运行 Playwright 基础版完整创作/导出/存储闭环，保存 report/失败 trace 7 天。高级功能随增量扩展回归。
- **CI required**：无论依赖成功/失败均执行，只有前两项均成功才通过；供 branch protection 作为统一必需检查。
- 默认 `contents: read`，无 secrets、不使用 `pull_request_target` 执行 PR 代码。
- Dependabot 每周检查 npm 与 Actions；PR 按同一检查要求合并。

## 仓库设置（已于 2026-11-09 实际开启）

`main` 已启用分支保护，通过 GitHub API 写入并读回确认过：

1. 必须走 PR 才能合并；**必需审批数 0**；dismiss stale approvals；require conversation resolution。
2. 必需状态检查 **CI required**，且要求分支与 `main` 同步（strict）。
3. 禁止 force push 和删除 `main`；管理员同样受约束（`enforce_admins`）。
4. 线性历史（配合 Squash 合并）、允许 fork 同步。

另外开启了仓库级 auto-merge 与「合并后自动删除分支」。

### 为什么必需审批数是 0

GitHub **不允许 PR 作者 approve 自己的 PR**（报错 `Review Can not approve your own pull request`）。所以只要必需审批数 ≥ 1，就必然需要第二个人在场；当前团队规模下这会让单人推进完全卡住。

设为 0 之后，门禁的实际形态是：**改动必须走 PR、必须等 CI 全绿、讨论必须解决、禁止强推与删分支**，而 review 变成可选——想看的人照常提 review，不提也能合并。若团队人数增加、希望恢复「至少一位他人审批」，把 `required_approving_review_count` 调回 1 即可。

### 验证过门禁确实在拦

- 带一个提交直接推 `main` → `remote rejected (protected branch hook declined)`，远端提示 `Changes must be made through a pull request.` 与 `Required status check "CI required" is expected.`
- `PATCH /git/refs/heads/main` → `422 Changes must be made through a pull request.`

## 故障排查

锁文件变化后使用 `npm ci` 验证干净安装。格式失败运行 `npm run format`；类型与 lint 修复源代码；浏览器失败下载 Actions 的 playwright-report，检查 trace。不要跳过 CI、删除测试或降低门槛来合并。

浏览器作业已拆成两个 Playwright 分片（`--shard=1/2`、`--shard=2/2`）跑在两个 runner 上，`fail-fast: false`，两个分片都通过 `CI required` 才算绿。这样单个作业不会撞上 15 分钟上限。
