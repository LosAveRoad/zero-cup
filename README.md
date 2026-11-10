# 瓷器物语 · Porcelain Tales

桌面浏览器中的青花瓷数字工坊：**拉坯 → 彩绘 → 烧制 → 拍照归档**。

> 当前可运行版本：二维轮廓拖动与滑块拉坯、3D 表面画笔/橡皮擦/印章、撤销重做、连续烧制、1080 PNG（含推荐机位与成品排版）、本地保存与刷新恢复均已接通。高级编辑、多图层与真机性能实测仍未完成。

## 3D 展陈

进入「成品」工作台后，在「展陈场景」中切换素色展台、云山留白、木格暖阁或月门夜庭。场景会随 1080×1080 PNG 一起导出，保存到藏品后会在重新打开时恢复。旧藏品使用素色展台。

展陈使用 Three.js 程序化几何、Canvas 壁画和项目内编写的地面 shader，无需下载外部模型或贴图。

在「成品」工作台先将想展示的一面转向镜头，再点击「生成演示视频」，即可用当前展陈场景拍出约 12 秒的 720p 横屏短片。三段运镜配有原创诗句和淡入淡出，末尾播放统一的瓷器物语落款动画。请在生成时保持页面在前台。视频在本机录制，优先下载 MP4，浏览器不支持时下载 WebM。

## 开始开发

Node.js 22（最低 22.12），npm；建议使用 `nvm use`。

```bash
git clone https://github.com/LosAveRoad/zero-cup.git
cd zero-cup
nvm use
npm ci
npm run dev
```

打开终端显示的本地地址。无账号、服务端或环境密钥要求。

## 检查命令

| 命令                              | 用途                                             |
| --------------------------------- | ------------------------------------------------ |
| `npm run check`                   | Prettier、ESLint、类型、Vitest 覆盖率、生产构建  |
| `npm run test:watch`              | 单元测试开发模式                                 |
| `npx playwright install chromium` | 首次安装浏览器（Linux 缺依赖可加 `--with-deps`） |
| `npm run test:e2e`                | Playwright 桌面 Chromium 检查                    |
| `npm run format`                  | 格式化                                           |

## 从哪里开始

1. 阅读 [需求与边界](docs/PRODUCT.md)、[架构与契约](docs/ARCHITECTURE.md)。
2. 先阅读 **[contribute.md](contribute.md)**；AI 也从根目录 `AGENTS.md` 进入同一规则。
3. 在 [Issue 列表](https://github.com/LosAveRoad/zero-cup/issues) 认领一个依赖已满足的任务，按 [协作指南](CONTRIBUTING.md) 开发。
4. PR 填写 `Closes #编号` 和验收证据，检查通过后由另一成员审阅。

[任务路线图](docs/ROADMAP.md) · [CI 与分支保护](docs/CI.md) · [部署到 Cloudflare Pages](docs/DEPLOY.md)

线上演示：<https://porcelain-tales.pages.dev/>

## 技术与范围

React 18 / TypeScript / Vite / Three.js / Canvas 2D / IndexedDB。MVP0 仅桌面 Chrome、Edge；不包含登录、云同步、移动触控、多图层、非轴对称建模。

本仓库暂未授予开源许可证；公开可读不等于允许任意再分发。纹样等资产须记录来源与许可。
