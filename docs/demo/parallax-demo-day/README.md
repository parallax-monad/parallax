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

## 在线访问

GitHub Pages 已配置为 GitHub Actions，但当前尚无成功发布；截至 2026-10-04，正式版和 PR 预览地址均返回 HTTP 404。部署成功前请使用上方本地方式查看。正式版地址（发布成功后）：

<https://parallax-monad.github.io/parallax/parallax-demo-day.html>

PR 预览使用独立目录，不会覆盖正式版：

```text
https://parallax-monad.github.io/parallax/previews/pr-<PR-number>/parallax-demo-day.html
```

本 PR 分支中的工作流会把生产演示和同仓库 PR 的静态演示分别放入发布目录，不运行 PR 脚本；PR 新建、更新、重新打开或关闭时会重建预览。此预览触发器要等工作流合入默认分支后才会由 `pull_request_target` 生效。当前 `main` 上的工作流尚不包含 PR 预览构建；合入前从 PR 分支手动触发则受 `github-pages` environment 限制，目前仅允许 `main`。如需合入前发布预览，仓库管理员需在 Settings → Environments → `github-pages` → Deployment branches and tags 中明确允许可信分支 `codex/parallax-pitch-narrative`。Fork PR 不发布；当前两个 Pages 地址在成功部署前不可用。

## 操作方式

- `←` / `→`、`Page Up` / `Page Down`：上一页 / 下一页
- `Home` / `End`：跳到开头 / 结尾
- `Esc`：打开或关闭总览
- `B`：切换动态模式与低功耗静态模式
- 鼠标滚轮：翻页
- 触摸左右滑动：翻页
