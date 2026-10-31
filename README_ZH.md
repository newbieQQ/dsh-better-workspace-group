<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

# dsh-better-workspace-group

DeepSeek Harness 工作区分组插件。基于 [z-col/dsh-workspace-groups](https://github.com/z-col/dsh-workspace-groups) 二次开发，让工作区、文件夹和会话在侧栏里更容易整理和使用。

## 预览

<img src="screenshot.png" alt="工作区分组插件预览" width="280" />

## 已实现的功能

- **工作区分组**：按「分组 → 项目 → 会话」浏览，支持新建、重命名、删除、折叠和置顶分组。
- **拖拽整理**：把项目拖入或移出分组，并调整分组、项目的显示顺序。
- **分组外观**：设置分组颜色和图标；新增「材料与实验」图标分区，包含实验操作、材料结构、表征测试和功能器件图标。
- **一个项目多个文件夹**：为项目添加额外文件夹、选择默认根目录，会话会按工作目录归入对应文件夹。
- **本地与远程目录**：本地工作区和已注册的 SSH 远程工作区都可以创建文件夹；远程操作失败时不会误建到本地镜像。
- **会话标签栏**：打开、切换、固定、重命名、拖动排序和关闭会话标签，支持关闭其他标签及右侧标签。
- **侧栏布局优化**：默认工作区固定在底部；各行的数量、时间和操作按钮统一右对齐；外观弹窗内容可滚动。
- **搜索与保存**：保留分组层级搜索会话，分组、排序、标签和文件夹设置都会保存，刷新或重启后仍然有效。

## 安装

Desktop 环境：

```sh
dsh plugin --profile desktop add github:newbieQQ/dsh-better-workspace-group
```

Web 环境将 `desktop` 改为 `web`。安装完成后，完全重启 DSH 或对应的 Web profile。

## 基本使用

1. 点击工作区标题栏的「新建分组」，再把项目拖进去。
2. 在项目或分组的 `⋯` 菜单中管理分组、外观和文件夹。
3. 在项目的「文件夹…」弹窗中添加文件夹或选择默认根目录。

需要按路径或名称自动分组时，可参考 [workspace-groups.example.yaml](./workspace-groups.example.yaml) 配置 `~/.dsh/workspace-groups.yaml`。不配置也不影响手动分组。

## 卸载

```sh
dsh plugin --profile desktop remove workspace-groups-local
```

## 致谢与许可

原项目由 [zcol](https://github.com/z-col) 开发并以 MIT 许可发布。本仓库在其基础上增加了材料与实验图标、底部默认工作区、统一行尾布局、远程工作区文件夹等功能。

原始作品 © 2026 zcol；本仓库修改 © 2026 newbieQQ。详见 [LICENSE](./LICENSE) 和 [NOTICE.md](./NOTICE.md)。
