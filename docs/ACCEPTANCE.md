# 增量验收记录（Issue #21）

## 2026-11-08：混合历史恢复

基线：`d45b2e62a256b1f32ebcabeeee4a79179161da9d`。
本次范围是跨功能存档恢复，不代表 #21 全部完成。

环境：macOS Darwin 23.5.0 / arm64，Node.js 22.14.0，已安装的 Google Chrome，Playwright Desktop Chrome 默认窗口 1280×720。浏览器按仓库配置使用 SwiftShader；不作为硬件性能证据。

复现：

```bash
npm ci
npm run check
npm run test:e2e -- tests/e2e/archive.spec.ts
```

自带 Chrome 的环境可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。

新增场景：修改半径；依次使用画笔、印章、橡皮擦共 24 次；烧制保存；刷新打开；撤销 20 次后保留 4 次且无法再撤销；重做全部；重新烧制保存。核对同一存档、完整动作顺序及参数、器型、纹理 SHA-256 一致，并检查无 pageerror。条件断言等待状态，不使用固定 sleep。

## 尚待完成

- 双向接缝与跨功能资源生命周期验收。
- 重复新建、打开 20 次，测量 RAF、监听器、geometry/texture 趋势。
- Chrome、Edge 真机测量：记录 CPU/GPU、内存、浏览器版本、窗口、操作步骤及样本；目标 60 FPS、几何更新 <16 ms、内存 <400 MB。
- 真机指标尚未测量，不能由软件渲染测试通过推断达标。
