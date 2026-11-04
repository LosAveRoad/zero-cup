# 从可运行基础版开始增量开发

先运行应用，再认领Issue。执行规范：[contribute.md](../contribute.md)；基础版范围：[BASELINE.md](BASELINE.md)；任务总入口：[Issue #1](https://github.com/LosAveRoad/zero-cup/issues/1)。

## 当前起点

滑块拉坯→3D画线→撤销重做→烧制→PNG→本地存档→刷新打开/删除已接通。该基础版是团队共同的运行基线，不再安排成员分别从零搭Viewport、Canvas和导航后最后拼装。

## 可独立验收的增量

| Issue                                                   | 在现有版本上增加什么      | 完成后如何演示                     |
| ------------------------------------------------------- | ------------------------- | ---------------------------------- |
| [#12](https://github.com/LosAveRoad/zero-cup/issues/12) | 平滑器型与二维轮廓编辑    | 拖动轮廓点→模型变化→彩绘保存仍正常 |
| [#16](https://github.com/LosAveRoad/zero-cup/issues/16) | 橡皮擦、印章与工具上下文  | 画线→落印→擦除→撤销→保存刷新一致   |
| [#15](https://github.com/LosAveRoad/zero-cup/issues/15) | 画笔/历史交互稳健性和性能 | 跨缝/快速输入/20次以上操作不丢画面 |
| [#17](https://github.com/LosAveRoad/zero-cup/issues/17) | 连续烧制材质与光照效果    | 同机位烧制前后效果明显，操作锁定   |
| [#18](https://github.com/LosAveRoad/zero-cup/issues/18) | 推荐机位与导出排版        | 切机位/背景→导出1080图片→继续创作  |
| [#19](https://github.com/LosAveRoad/zero-cup/issues/19) | 存储校验、迁移和失败恢复  | 旧作品可打开；配额失败不丢当前作品 |
| [#20](https://github.com/LosAveRoad/zero-cup/issues/20) | 三种器型挑战              | 选挑战→目标剪影和分数→完成并保存   |
| [#21](https://github.com/LosAveRoad/zero-cup/issues/21) | 增量回归与性能验收        | Chrome/Edge真机证据与闭环回归      |

#12、#15、#17、#18、#19可按现有契约开始；#16和#15均修改笔划数据，需先协调契约并避免同时重写引擎；#20可并行做评分，但UI接入需与#12协调。一个大Issue允许拆成多个保持可运行的小PR。

原#10/#11/#13/#14的底层模块任务已由基础版和以上增量替代，保留记录、不让成员继续从零重复实现。关闭为替代/不再按旧方案执行，不表示原PRD全部细项完成。

## 完成标准

每个PR都保持基础创作闭环；功能验收逐项记录，不能靠“目录已建立”或“标题可见”宣告完成。完整MVP0仍需高级编辑、材质、挑战、错误路径和性能实测。

仓库主分支强制门禁与成员权限仍见 [#22](https://github.com/LosAveRoad/zero-cup/issues/22)，工作流本身不代表已开启branch protection。
