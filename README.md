# REA_Test

## 本地启动

环境：Node.js 20.19+（20.x）或 22.12+，以及 npm。

```sh
git clone https://github.com/Nagiici/REA_Test.git
cd REA_Test
npm ci
npm run dev
```

打开终端输出的地址，默认是 `http://127.0.0.1:5173`。

如需在局域网内访问：

```sh
npm run dev -- --host 0.0.0.0
```

## 构建与部署

```sh
npm run build
```

将生成的 `dist/` 目录完整部署到静态网站服务，保留其中的 `assets/` 目录。运行时不需要 Node.js 服务端。

本地预览构建结果：

```sh
npm run preview
```

## 接入其他网站

将游戏部署到独立域名或子域名的根路径，例如 `https://game.example.com/`，然后在目标网站中嵌入：

```html
<iframe
  src="https://game.example.com/"
  title="游戏"
  style="display:block;width:100%;height:80vh;min-height:480px;border:0;"
  allow="fullscreen"
  allowfullscreen
></iframe>
```

将示例地址替换为实际部署地址。部署服务需允许目标网站通过 iframe 嵌入；点击游戏内的开始按钮后即可使用键盘操作。

当前资源使用 `/assets/` 绝对路径。直接部署到 `/game/` 等子路径前，需要同步调整构建路径与代码中的资源加载路径；仅修改 Vite 的 `base` 不够。
