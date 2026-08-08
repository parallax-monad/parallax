# Parallax Demo Day PPT

这是 Parallax Demo Day 的单文件网页演示，采用 Monad 风格的紫色 × 黑色主题，并保留中英双语内容。Motion One 已内嵌在 HTML 中，无需额外下载脚本文件。

## 本地运行

在仓库根目录打开终端，执行：

```bash
cd docs/demo/parallax-demo-day
python3 -m http.server 8000
```

然后打开：

```text
http://localhost:8000/parallax-demo-day.html
```

## Online access

部署到 Vercel 后，直接访问同一部署域名下的 `/parallax-demo-day.html`，即可打开在线 PPT。

## Controls

- `←` / `→`：上一页 / 下一页
- `Home` / `End`：跳到开头 / 结尾
- `O`：打开总览
- 鼠标滚轮或触摸滑动：翻页
