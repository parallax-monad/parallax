# Parallax Buildathon Pitch Presentation

本目录包含 Parallax 的七页 HTML 路演演示文稿。正式版已通过 GitHub Pages 发布：

<https://parallax-monad.github.io/parallax/parallax-demo-day.html>

## PR 预览

正式版地址保持独立，不会被 PR 内容覆盖。包含演示文稿变更的同仓库开放 PR 会在以下路径生成静态预览：

```text
https://parallax-monad.github.io/parallax/previews/pr-<PR-number>/parallax-demo-day.html
```

PR 新建、更新、重新打开或关闭时，GitHub Actions 会从 `main` 重新组装正式版及仍开放的同仓库 PR 预览。关闭的 PR 不会继续出现在下一次发布产物中。工作流只归档静态演示文件，不运行 PR 分支中的脚本；Fork PR 不发布预览。预览需等待对应的 Pages 工作流成功后才可访问。

## 本地查看

从仓库根目录运行：

```bash
cd docs/demo/parallax-demo-day
python3 -m http.server 8000
```

打开 <http://localhost:8000/parallax-demo-day.html>。

## 操作方式

- `←` / `→`、`Page Up` / `Page Down`：上一页 / 下一页
- `Home` / `End`：跳到开头 / 结尾
- `Esc`：打开或关闭总览
- `B`：切换动态模式与低功耗静态模式
- 鼠标滚轮或触摸左右滑动：翻页
