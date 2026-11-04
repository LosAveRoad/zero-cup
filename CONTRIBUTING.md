# 团队开发指南

## 认领与分支

- 先阅读任务的依赖 Issue、输入输出和验收标准；依赖未完成时可用契约/mock 并行，不自行改变公共数据结构。
- 在 Issue 留言认领，再由维护者或有权限的成员分配 Assignee；不要重复实现已认领任务。
- 从最新 `main` 创建 `feat/<issue>-<short-name>`、`fix/<issue>-<short-name>` 或 `docs/<issue>-<short-name>`。
- 一个 PR 聚焦一个可独立验收任务。先开 Draft PR 可以提早讨论接口。

```bash
git switch main
git pull --ff-only
git switch -c feat/123-profile-editor
npm ci
npm run dev
```

## 开发与提交

保持 TypeScript strict，禁止用 `any` 隐藏错误。算法留在 `src/core`，React 事件和视图留在 `src/components`，存储仅通过 `src/storage` 调用。修改公共接口时同时更新类型、文档、消费者和测试。

为新算法先添加行为测试，覆盖边界、失败输入和历史回退；不要只测试实现细节。不要把 60 FPS、显存稳定性或真实 GPU 表现写成 CI 已证明的结论。

```bash
npm run format
npm run check
npx playwright install chromium
npm run test:e2e
git add <本次修改文件>
git commit -m "feat: implement profile editor"
git push -u origin HEAD
```

## PR 与完成定义

- 填 PR 模板，用 `Closes #123` 关联任务；附验收清单、验证命令和结果。UI 附截图/录屏；性能附浏览器、硬件、分辨率、测量步骤。
- 所有检查通过；另一位成员完成 review、讨论已解决。修改后重新检查；不直接向 `main` 推送。
- Reviewer 检查契约一致性、错误路径、资源释放、跨缝/撤销行为和需求范围。
- 维护者使用 Squash 合并并删除功能分支；Issue 自动关闭。若功能只完成部分，不能用 Closes 关闭整项任务。
- 不使用跳过测试、`continue-on-error`、降低覆盖率、固定等待或注释断言的方式让 CI 变绿。失败时先查看 Actions 日志和 Playwright trace。

## 资产与数据

禁止提交密钥、个人作品/个人信息、`node_modules`、构建产物和浏览器档案。预置图片需补充 `public/assets/README.md`，记录名称、作者、来源 URL、许可、用途。未经许可的参考图片不能作为发布资产。

## 协作权限

公开仓库可通过 fork 发 PR；直接推送分支需要维护者授予 Write 权限。成员账号尚未提供，不预设 Assignee 或 CODEOWNERS。模块负责人在认领 Issue 时确认。
