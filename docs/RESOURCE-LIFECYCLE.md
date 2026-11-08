# 新建 / 打开作品资源回归（#21）

## 范围

从 main `d45b2e62a256b1f32ebcabeeee4a79179161da9d` 独立开发，与混合历史恢复 PR #34 无代码依赖。

`tests/e2e/lifecycle.spec.ts` 先通过真实绘制、烧制与保存建立基准作品，然后连续 20 轮：新建 → 修改半径 → 彩绘落笔 → 打开基准存档 → 继续彩绘。每轮检查作品名、落笔计数和唯一画布。

这条路径复用同一个 Viewport，不会卸载它；本测试不声称覆盖 React 卸载后的释放或所有 GPU 驱动内存。

## 测量方法

- 在应用模块启动前包装原生 requestAnimationFrame / cancelAnimationFrame，统计尚未执行的回调；每轮等待两帧完成后比较基准值。
- 包装 WebGL1/2 的 createBuffer/deleteBuffer、createTexture/deleteTexture，统计实际存活的 GPU 句柄。器型变更需分配新 buffer，循环结束同时断言创建和释放计数确实增长。
- 主动创建 buffer、texture、RAF，再删除/取消，验证探针能检测分配和释放。
- Chromium CDP 强制 GC 后读取 Memory.getDOMCounters，每 5 轮检查 DOM 节点与监听器数量不高于同阶段基准。此指标是页面总量，不是某个业务模块的归因。
- 最终 JSON 作为 Playwright `resource-trend` 附件，记录基准及第 5/10/15/20 轮样本；失败 trace 按现有配置保留。

不添加固定 sleep，不更改产品运行时或现有性能阈值。

## 复现

```bash
npm ci
npx playwright install chromium
npm run check
npm run test:e2e -- tests/e2e/lifecycle.spec.ts
npm run test:e2e -- --workers=1
```

有系统 Chrome 时可设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 指向它。

## 环境与限制

本轮环境：macOS Darwin 23.5.0 arm64 / Node.js 22.14.0 / Google Chrome 156.0.8078.81 / Playwright Desktop Chrome 1280×720 / SwiftShader 软件渲染。

结果只证明该固定流程下被观测资源不增长；不能证明不存在所有内存泄漏，更不能证明真机 60 FPS、几何更新 <16 ms 或内存 <400 MB。Chrome/Edge 真机性能、Viewport 卸载与双向接缝仍待后续验收。完整 #21 保持开放。

## 单独回归实测结果（2026-11-08）

新增测试通过，耗时 49.0 秒。实际读数如下：

| 采样  | 待执行 RAF | 存活 buffer | 存活 texture | DOM 节点 | JS 监听器 |
| ----- | ---------- | ----------- | ------------ | -------- | --------- |
| 基准  | 1          | 8           | 9            | 240      | 197       |
| 5 轮  | 1          | 8           | 9            | 240      | 197       |
| 10 轮 | 1          | 8           | 9            | 240      | 197       |
| 15 轮 | 1          | 8           | 9            | 240      | 197       |
| 20 轮 | 1          | 8           | 9            | 240      | 197       |

buffer 累计创建/释放从 16/8 变为 177/169，包含探针自检分配的 1 个 buffer；存活数始终为 8。计数表来自本轮 Playwright 附件，不是通用性能预算。
