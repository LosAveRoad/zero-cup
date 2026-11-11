# 架构与模块契约

> 以下包含完整MVP0的目标架构。当前可运行版本的真实代码与存档格式以 [BASELINE.md](BASELINE.md) 和 [contribute.md](../contribute.md) 为准；不要按目标类型直接覆盖已有数据。

## 目录职责

| 路径                   | 职责                              | 禁止耦合                    |
| ---------------------- | --------------------------------- | --------------------------- |
| `src/types/artwork.ts` | PRD §6.2 公共数据契约             | 不导入 React/Three.js       |
| `src/components`       | 阶段 UI、Viewport、事件与生命周期 | 不直接散落 IndexedDB 调用   |
| `src/core/geometry`    | 约束、样条、LatheGeometry         | 纯计算不依赖 DOM            |
| `src/core/painting`    | Canvas、UV、命令和撤销            | 不保存 React 状态对象       |
| `src/core/materials`   | 材质配方和光照管理                | 所有可释放资源均明确所有者  |
| `src/storage`          | 数据版本、校验、IndexedDB         | 不接管视图导航              |
| `tests/e2e`            | 跨页面与持久化行为                | 不以固定 sleep 替代条件等待 |

## 数据与生命周期

UI State → Three Scene → Canvas/UV Engine；Storage 保存可序列化的数据与 Blob。Three Mesh、Material、Texture、Canvas 和回调不能直接放进持久化契约。模块通过明确的函数/类接口连接；任务中的签名是初始建议，变更需同步依赖任务。

`ProfileControlPoint` 的高度和半径都归一化；uv 的 v 原点在底部，Canvas 像素 y 在顶部：`x=u*2048; y=(1-v)*2048`。网格采样后也要重新检查半径和高度单调性，防止样条过冲，不能仅 clamp 控制点。

`PaintingAction.size` 使用纹理像素，stamp `rotation` 用弧度、`scale` 相对原图尺寸，`opacity` 在 [0,1]。这些单位是仓库初始约定，改动需同步所有消费者。纹理透明底和陶瓷底色分离，橡皮擦只擦纹样——渲染器因此持有**底色层、墨迹层和一张擦除预览用副本**三张 2048 画布，释放时都要处理。

名品模版落绘时用器壁局部周长和母线长度计算贴图宽高，并将其保存为印章命令的可选 `footprint`（单位为完整 UV 宽度和高度的比例）。旧命令按原有 `scale` 重放，已有模版的纹样 ID 继续解析到落绘时的版本。

采样得到的 u 是**连续量**，跨接缝时可以越出 [0,1]（例如 0.98 → 1.04）。这是有意表示接缝穿越，不要再 clamp 回 [0,1]，否则会重新引入贯穿贴图的长线。

`ArtworkMetadata.snapshotBlob` 保存 2048×2048 彩绘纹理，`thumbnailBlob` 用于画廊。相片为 1080×1080 另行导出。若添加 schemaVersion 或新字段，先定义向后兼容读取与迁移测试。完整记录与基线快照的取舍见历史 Issue；不能只保存最近 20 次命令造成作品丢失。

## WebGL 资源所有权

Viewport 负责 renderer、controls、RAF、resize observer 和监听器。几何模块生成网格前释放被替换的 geometry。材质/贴图由创建者 dispose；共享资源不能被多个组件重复 dispose。React StrictMode 下 mount→unmount→mount 必须无多余 RAF 或监听器。

## 测试门槛

`vitest.config.ts` 对 `src/core/**/*.ts` 启用 100% lines/statements/functions/branches。当前 core 已实现轮廓采样与单调样条、方位角接缝、命令与历史、印章几何、釉料与光照、机位与排版、挑战评分、作品库版本与迁移；浏览器测试覆盖创作闭环与各项工具行为。新增核心模块时必须同时添加行为测试。Canvas、IndexedDB、资源释放和端到端流程由相应任务补齐。
