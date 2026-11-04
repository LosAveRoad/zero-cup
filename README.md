# 瓷器物语 · Porcelain Tales

桌面浏览器中的青花瓷数字工坊：**拉坯 → 彩绘 → 烧制 → 拍照归档**。

> 当前为工程初始化版本，仅包含应用入口、数据契约和检查流水线。制作玩法尚未实现；不能将冒烟测试通过视为 MVP0 验收完成。

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
2. 在 [Issue 列表](https://github.com/LosAveRoad/zero-cup/issues) 认领一个依赖已满足的任务，按 [协作指南](CONTRIBUTING.md) 开发。
3. PR 填写 `Closes #编号` 和验收证据，检查通过后由另一成员审阅。

[任务路线图](docs/ROADMAP.md) · [CI 与分支保护](docs/CI.md)

## 技术与范围

React 18 / TypeScript / Vite / Three.js / Canvas 2D / IndexedDB。MVP0 仅桌面 Chrome、Edge；不包含登录、云同步、移动触控、多图层、非轴对称建模。

本仓库暂未授予开源许可证；公开可读不等于允许任意再分发。纹样等资产须记录来源与许可。
