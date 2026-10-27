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

部署到网站子路径（例如 `https://example.com/game/`）时，指定以 `/` 结尾的路径前缀：

```sh
npm run build -- --base=/game/
```

将 `dist/` 的全部内容放到网站的 `/game/` 目录或对应的静态服务挂载点。页面、模型、贴图、场景数据和音频都会使用该前缀。访问 `/game/`（保留末尾 `/`），并将 `/game` 重定向到 `/game/`。

本地验证子路径构建：

```sh
npm run preview -- --base=/game/
```

打开 `http://127.0.0.1:4173/game/`（端口以终端输出为准）。也可使用 `npm run dev -- --base=/game/` 在开发环境调试。

在其他页面嵌入：

```html
<iframe
  src="https://example.com/game/"
  title="游戏"
  style="display:block;width:100%;height:80vh;min-height:480px;border:0;"
  allow="fullscreen"
  allowfullscreen
></iframe>
```

将示例地址替换为实际部署地址。部署服务需允许目标网站通过 iframe 嵌入；点击游戏内的开始按钮后即可使用键盘操作。

换成其他子路径时，修改 `--base` 后重新构建即可；部署到域名根路径仍使用 `npm run build`。
