# 部署到 Cloudflare Pages

本项目是纯静态前端（React + Vite），没有服务端、没有环境变量、没有密钥，
因此部署就是把 `dist/` 传到 Cloudflare Pages。

线上地址：<https://porcelain-tales.pages.dev/>

## 一次性准备

```bash
npm install -g wrangler      # 或用 npx wrangler@4
wrangler login               # 浏览器里点 Allow，会写 ~/.wrangler/config/default.toml
wrangler whoami              # 确认账号与 Account ID
```

CI 环境不要走 OAuth，改用 API Token：

```bash
export CLOUDFLARE_API_TOKEN=<token>       # 权限：Account > Cloudflare Pages > Edit
export CLOUDFLARE_ACCOUNT_ID=<account id>
```

## 发布

```bash
npm run build                                   # 产出 dist/
wrangler pages project create porcelain-tales --production-branch=main   # 首次才需要
wrangler pages deploy dist --project-name=porcelain-tales --branch=main
```

`wrangler pages deploy` 会返回两个地址：

- `https://<hash>.porcelain-tales.pages.dev` —— 本次部署的固定地址，方便回看；
- `https://porcelain-tales.pages.dev` —— 生产别名，跟着生产分支走。

## 缓存与响应头

`public/_headers` 会随构建复制到 `dist/_headers`，由 Pages 解释：

- `/assets/*` 的文件名带内容哈希，可以长缓存（`max-age=31536000, immutable`）；
- HTML 用 Pages 默认的 `max-age=0, must-revalidate`，发版后立刻生效；
- 其余是 `nosniff`、`Referrer-Policy`、`X-Frame-Options` 等安全头。

**不要在 `/*` 规则里再写一条 `Cache-Control`。** Pages 会把匹配到的多条
`Cache-Control` 拼接成一条，于是同一个响应同时带 `max-age=31536000` 和
`max-age=0`，缓存行为取决于浏览器怎么取舍。

## 路由

应用没有前端路由（单页四个阶段由 React 状态切换），所以不需要
`_redirects` 的 SPA 回退。若以后引入路由，给 `public/` 加一条：

```
/*  /index.html  200
```

## 发布后验证

```bash
curl -sI https://porcelain-tales.pages.dev/            # 200 + Cache-Control
curl -sI https://porcelain-tales.pages.dev/assets/...  # 200 + immutable
```

再打开线上地址手动走一遍：改半径 → 画线 → 撤销/重做 → 烧制 → 下载 PNG
→ 保存 → 刷新 → 打开 → 删除。

## 注意

- 作品存在浏览器本地 IndexedDB 里，**换设备或换浏览器看不到**。线上站点的
  存档与本地开发站点的存档互相独立。
- 仓库里不要提交 Cloudflare 凭据；`~/.wrangler/config/default.toml` 在
  用户目录，不进版本库。
