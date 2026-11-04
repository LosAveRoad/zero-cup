# 自动检查与主分支保护

## 已提交的工作流

`PR checks` 对所有指向 `main` 的 PR（含 fork）及 main push 运行，没有路径过滤和跳过规则。

- **Quality**：`npm ci`、Prettier、ESLint、TypeScript、Vitest+核心覆盖率、Vite build。
- **Browser smoke**：安装 Chromium 并运行 Playwright，保存 report/失败 trace 7 天。功能逐步增加后扩展为完整创作闭环。
- **CI required**：无论依赖成功/失败均执行，只有前两项均成功才通过；供 branch protection 作为统一必需检查。
- 默认 `contents: read`，无 secrets、不使用 `pull_request_target` 执行 PR 代码。
- Dependabot 每周检查 npm 与 Actions；PR 按同一检查要求合并。

## 仓库设置（与 YAML 分开）

工作流文件不会自动禁止合并。维护者需在 Settings → Rules → Rulesets（或 Branches）对 `main` 启用：

1. Require a pull request before merging；至少 1 approval、dismiss stale approvals、require conversation resolution。
2. Require status checks to pass：首次运行后选择 **CI required**，要求 branch up to date。
3. 禁止 force push 和删除 main；不要设置所有成员都可绕过规则。
4. 建议只允许 Squash merge、合并后自动删分支。

当前 GitHub 连接没有修改仓库设置的接口，因此这些设置尚未由初始化自动开启；不能把绿灯视为已有强制门禁。若 Actions 因账户/仓库策略禁用或 workflow 写权限被拒绝，需要维护者处理后重新运行。

## 故障排查

锁文件变化后使用 `npm ci` 验证干净安装。格式失败运行 `npm run format`；类型与 lint 修复源代码；浏览器失败下载 Actions 的 playwright-report，检查 trace。不要跳过 CI、删除测试或降低门槛来合并。
