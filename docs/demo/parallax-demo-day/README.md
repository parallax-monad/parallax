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

正式版由 `main` 发布，地址保持不变：

<https://parallax-monad.github.io/parallax/parallax-demo-day.html>

PR 预览使用独立目录，不会覆盖正式版：

```text
https://parallax-monad.github.io/parallax/previews/pr-<PR-number>/parallax-demo-day.html
```

同仓库 PR 新建、更新或重新打开时，GitHub Actions 会从 PR 分支发布演示目录的静态文件；关闭 PR 时也会触发重建并移除对应预览。每次 `main` 部署都会从正式版和仍打开的同仓库演示 PR 重建站点。Fork PR 不发布，部署流程不会运行 PR 脚本。首次启用预览触发器时，可通过同一工作流的 `workflow_dispatch` 手动生成预览；部署仍受 GitHub Pages `github-pages` environment 的分支保护和审批规则约束，未获准的 ref 不会发布预览。

## 操作方式

- `←` / `→`、`Page Up` / `Page Down`：上一页 / 下一页
- `Home` / `End`：跳到开头 / 结尾
- `Esc`：打开或关闭总览
- `B`：切换动态模式与低功耗静态模式
- 鼠标滚轮：翻页
- 触摸左右滑动：翻页
