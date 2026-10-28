<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

# dsh-workspace-groups-local

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Fork of z-col/dsh-workspace-groups](https://img.shields.io/badge/fork-z--col%2Fdsh--workspace--groups-blueviolet.svg)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-purple.svg)
<img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness plugin">

> **本仓库是 [z-col/dsh-workspace-groups](https://github.com/z-col/dsh-workspace-groups) 的 fork。**
> 三层树、拖拽归类、sidecar 规则与会话标签栏均为原作者设计实现（MIT）；本 fork 在其之上
> 增加了科研图标分区、固定在底部的默认工作区栏、以及统一的右侧尾槽——详见
> [鸣谢与上游](#鸣谢与上游)。

> **DeepSeek Harness（DSH）Web 客户端插件：完整的工作区分组管理工具。**
> 把 GUI 侧边栏的工作区列表从两层「项目 → 会话」升级为三层
> **「分类文件夹 → 项目文件夹 → 会话」**，并围绕它提供完整的分组管理能力——
> 手动建组、重命名/删除分组、拖拽归类、项目与分组的自由排序、规则自动归类、
> 树形搜索。所有操作**即时生效并持久化**，对官方数据**零侵入**。

典型场景：多个 DSH 插件项目（SkillsManagePlugins / Documentation-Driven AI Coding /
DeepSeek峰谷小组件 等）归入一个「DSH 插件」分类文件夹，点开是各项目，再点开是各自会话；
临时项目随手建个「临时」分组拖进去，用完删除分组，项目全部回归**顶层**。

## 截图

<img src="screenshot.png" alt="dsh-workspace-groups 工作区分组管理" width="280" />

## 特性

### 分组树浏览
- **分组文件夹 → 项目文件夹 → 会话行**，分组/项目均可折叠；展开状态独立持久化
  （`dsh.workspace.groups.view.v1`，刷新/重启保留）
- **顶层项目行**：不归组的项目（不匹配任何规则、被移出分组、删除分组后回归的）
  直接显示在分组列表之后，与分组平级——**没有「未分类」桶**

### 分组管理（完整生命周期）
- **手动新建分组**：区头「新建分组」按钮即建即显，空分组也渲染
- **重命名 / 删除任意分组**：每个分组行（**含规则分类**）悬停 `⋯` 菜单；
  删除分组后组内所有项目回到**顶层**；规则分类的改名/删除经 overlay 生效
  （`renamed` / `hidden`），**规则 YAML 原样保留**
- **规则自动归类**：sidecar YAML 声明分类规则（`pathPrefix` / `pathExact` /
  `nameContains` / `basenameContains`），改配置即可调整归类，无需改代码

### 拖拽归类 + 排序
- **拖项目进分组**：拖到任意分组行 / 分组内项目行即移入（跨组移动 = 覆盖规则归类）
- **从分组拖出**：拖动时**整个顶层区域都是移出落点**，用**插入横线**指示（非高亮框）——
  拖到任意顶层项目行（插到它前/后）、拖到最后一行下方空白（追加末尾）、顶层为空时
  在最后一个分组行下方显示独立横线 = 移出分组；分组内项目行的菜单「移出分组」
  （规则归类项目也有）
- **项目组内排序**：拖到项目行上半 = 插到它前面、下半 = 插到它后面
- **顶层项目排序**：顶层项目行也可拖拽排序（上半 = 插到它前、下半 = 插到它后），
  顺序持久化在 `workspaceOrder["__topLevel__"]`
- **分组排序**：分组行可拖动，拖到另一分组行上半 = 移到它前面、下半 = 移到它后面
- **插入位置指示线**：拖动中实时显示 2px 指示线（行上/下方），松手落点所见即所得
- **按级别收起 + 结束后恢复**：拖项目只收起项目行（分组内 + 顶层，分组行不收）；
  拖分组只收起分组行（项目行不收）；dragend 自动恢复拖动前的展开状态
- **行图标可区分**：分组行是文件夹图标、项目行是项目符号图标（官方同款），
  分组与项目一眼可分

### 分组外观（颜色 / 图标 / 置顶）

- **分组配色**：10 种主题色，在分组行左侧画 2px 内嵌色条，并把文件夹图标染色
- **分组图标**：20 个内置图标（取自 DSH 图标集），或 1–4 个字符的自定义字形（emoji/拉丁）；
  未知值降级为默认文件夹图标而不是报错，数据与客户端版本因此可以各自演进
- **置顶分组**：置顶分组排到树的最前面；把分组拖过置顶边界时会在同一次写入里翻转
  置顶状态，落点就是指示线显示的位置
- **折叠动画**：展开/收起分组或项目时行高与透明度过渡，动画期间隐藏花朵标记，
  花不会滞后于所在行；大树、拖动折叠中、`prefers-reduced-motion` 下自动跳过动画
- 存放在 overlay 的 `appearance` 里，**绝不写进规则 YAML**

### 一个工作区多个文件夹（multi-root）
- **给项目挂多个文件夹**：项目行的 `⋯` 菜单里点 **文件夹…**，弹窗第一行是项目自带的
  目录（**基础文件夹**，永远是 #0，不可移除），下面是你自己加的额外文件夹
- **每个项目一个根目录**：弹窗里的单选列，或文件夹行的 `⋯ → 设为根目录`，决定“新建会话”
  默认落在哪个文件夹；根目录那一行会被提到最前面并带 ★ 标记
- **会话按自己的 cwd 归位**：项目一旦有额外文件夹，会话上方会多出文件夹行，每条会话按
  自己记录的 cwd 落进所属文件夹（最具体的文件夹优先，Windows 下大小写不敏感）；没有额外
  文件夹的项目保持原来的两层扁平结构，行为完全不变
- **在指定文件夹里开会话**：文件夹行悬停的 `＋` 会以该文件夹为 cwd 新建会话；基础文件夹
  沿用平台自己的“新建会话”手势，连点两次会复用已打开的空白会话，而不是堆一堆空会话
- 文件夹默认展开，挂上新文件夹不会把本来能看到的会话藏起来；折叠状态只是当前视图状态，
  故意不持久化
- **统一“创建文件夹”**：输入一个子目录名，本地调用 DSH 原生 `uiWorkspace.createDirectory`；
  已注册的远程镜像调用 SSH 专属 `/remote-ssh/api/mkdir`，传连接 ID 和映射后的远端路径。
  本地功能不依赖 SSH 插件。远端接口为 `mkdir -p`，同名目录存在时复用；本地沿用原生行为。
  SSH 不可用或请求失败时绝不降级为镜像里的本地创建。普通本地目录仍可用“添加文件夹”选取。
- 通过 SSH 的 `listWorkspaces` 识别已注册镜像，支持非默认镜像位置；重叠注册根、坏响应、
  未注册的默认镜像路径会报错。此功能不另建 SSH 工作区，也不改动它的连接配置。
- **remote-ssh 2.4.40 不完整支持子目录会话**：新建此类会话暂时阻断并提示从注册的远程工作区根
  打开。创建远端文件夹本身不受此限制；另一个远端根请通过 SSH 插件注册。
- **不再复制 `.remote-ssh.json` 到子目录**，旧 POST 接口返回 410。复制标记不能修复模型工具
  上下文，还可能绕过父工作区写回限制。历史子目录标记不会自动删除，应审查后再使用旧会话；
  工作区根标记仍由 SSH 插件管理。此前“子标记永远不会同步”的说明不成立，已撤回。
- 自动验证使用模拟 API 和临时目录；真实 SSH、终端和界面尚需发布前联调。

### 搜索与操作
- **树形搜索**：命中后仍保留三层树结构（分类 → 项目 → 命中会话），命中行高亮 +
  内容摘要，防抖 250ms
- **工作区/会话操作不退化**：Add Workspace、项目重命名/删除、新建/打开/重命名/
  派生/归档会话

### 持久化与零侵入
- 所有手动操作（分组、归类、排序、改名、隐藏）写入插件自有 overlay
  （`~/.dsh/workspace-groups.manual.json`），host 校验后**原子写入**（写坏返回 400 并
  保留原文件）；标签栏同样处理，独立文件 `~/.dsh/workspace-groups.tabs.json`；项目的
  额外文件夹与根目录选择也一样，独立文件 `~/.dsh/workspace-groups.folders.json`
  （写时严格、读时宽容 —— 不认识的文件夹直接丢弃，不会把树弄坏）
- **零侵入**：不修改 `~/.dsh/storages/workspace.json`、不修改会话落盘结构、不修改官方
  `@deepseek-ai/dsh-client-ui-workspace` 包；规则 YAML 永不改写
- **产物自包含**：`lib/` 已构建并随仓库分发，Git 安装无需执行任何依赖脚本

## 工作原理

- 本插件是 **client 插件**，注册进官方 sidebar shell 声明的 `sidebar.workspaces`
  slot（`kind: 'single'`），以 `priority: -1` 顶替官方默认 WorkspaceBrowser
  （官方以 priority 0 注册；single 槽位最低 priority 胜出）。
- 数据源全部复用运行时 API：`useWorkspaces` / `useSessions` 全局 hooks 与
  `ctx.workspaces.*` / `ctx.sessions.*`，分类只是**展示层变换**。
- host 半做两件事：把 sidecar YAML 解析为 JSON 与运行时 overlay 合并，经
  `GET /workspace-groups/config` 路由（`Cache-Control: no-cache`）供 client 获取；
  `PUT /workspace-groups/manual` 接收整份 overlay（手动分组、每工作区归类覆盖、
  分组/项目排序、规则分类改名与隐藏），校验后原子写入
  `$DSH_HOME/workspace-groups.manual.json`。
- **归类优先级**：手动覆盖（拖拽/菜单写入；`null` = 强制顶层、规则匹配也无效）→
  YAML 规则自动归类（被隐藏的规则分类失效）→ **顶层**（不归组的项目显示为顶层行）。
  YAML 永不改写。

## 安装（GitHub 分发）

> 前置：已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
> （`dsh` 命令可用），并已初始化好目标 profile（如内置 `web`）。

```sh
dsh plugin --profile web add github:z-col/dsh-workspace-groups
```

这会自动：

1. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加入
   `"dsh-workspace-groups": "github:z-col/dsh-workspace-groups"`（含版本/commit）
2. 在 `dsh.profile.bundles` 末尾追加 `"dsh-workspace-groups"`
3. 运行 pnpm 安装并校验 bundle 层

**安装后重启 web profile**（bundle 与 host 半只有在重启后才会被加载）：

```sh
# 停止现有 dsh web 进程后重新启动，例如：
dsh web
```

验证安装：

```sh
dsh --profile web --dump-config | grep -A3 workspace-groups
# 应出现 - id: workspace-groups / name: dsh-workspace-groups / config: {}
curl http://127.0.0.1:3080/workspace-groups/config
# 应返回 sidecar YAML 解析后的 JSON
```

## 卸载

```sh
dsh plugin --profile web remove dsh-workspace-groups
```

这会自动从 `dependencies` 删除该依赖并从 `dsh.profile.bundles` 移除对应行。
同样需要**重启 web profile** 后生效。

> 手动等价做法（任选其一，不要重复）：编辑 `~/.dsh/profiles/web/package.json`，
> 从 `dependencies` 删除 `dsh-workspace-groups` 行、从 `dsh.profile.bundles`
> 删除 `"dsh-workspace-groups"`，然后在该目录 `pnpm install`。

## 分类配置（sidecar）

默认位置 `~/.dsh/workspace-groups.yaml`（也可用 `$DSH_HOME` 环境变量覆盖家目录）。
模板见仓库根目录 `workspace-groups.example.yaml`。

```yaml
categories:
  - name: DSH 插件
    rules:
      - pathPrefix: /Users/zcol/Project/SkillsManagePlugins
      - nameContains: 插件
      - basenameContains: plugin
  - name: 个人项目
    rules:
      - pathPrefix: /Users/zcol/Project/yeluzi
```

规则字段（每个 rule 是 OR 关系，任一命中即归类；分类按序匹配，先到先得）：

| 字段 | 含义 |
|---|---|
| `pathPrefix` | 项目绝对路径前缀 |
| `pathExact` | 项目绝对路径精确匹配 |
| `nameContains` | 项目显示标题包含（忽略大小写） |
| `basenameContains` | 项目目录名包含（忽略大小写） |

未命中任何分类、或被移出分组的项目显示为**顶层项目行**（与分组平级），不会被隐藏。

## 手动分组与拖拽归类（runtime overlay）

规则 YAML 之外，还有一份插件自有的运行时 overlay，**只记录 UI 里的手动操作**，
默认位置 `$DSH_HOME/workspace-groups.manual.json`（例如 `~/.dsh/workspace-groups.manual.json`）：

```json
{
  "categories": ["临时", "归档"],
  "assignments": {
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890": "临时",
    "a1b2c3d4-e5f6-7890-abcd-ef1234567891": null
  },
  "categoryOrder": ["临时", "DSH 插件"],
  "workspaceOrder": { "临时": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"] },
  "renamed": { "DSH 插件": "插件集" },
  "hidden": ["文档"],
  "appearance": {
    "插件集": { "color": "blue", "icon": "code", "pinned": true },
    "临时": { "color": "amber" }
  }
}
```

- `categories` —— 手动新建的分组名（无规则，空分组也渲染）。
- `assignments` —— 工作区 → 分组的归类覆盖，键是稳定的工作区 id（重命名不影响）。
  **优先级高于 YAML 规则**；值为 `null` 表示**强制移到顶层**（即使规则能匹配）。
- `categoryOrder` —— 分组显示顺序（顶层项目不在此列，恒显示在分组之后）。
- `workspaceOrder` —— 每个分组内项目的手动排序（拖拽排序写入）。
- `renamed` / `hidden` —— 规则分类的 UI 改名/删除（隐藏后其规则失效，匹配项目
  变顶层）；规则 YAML 原样保留。
- `appearance` —— 按**显示名**（与 `categoryOrder` 同一键空间）记录分组外观：
  `color`（`red`/`orange`/`amber`/`green`/`teal`/`blue`/`indigo`/`purple`/`pink`/`gray`）、
  `icon`（内置图标 id 或 1–4 个字符的字形）、`pinned`（排到未置顶分组之前）。三个字段
  都可选，写回时会把空值删掉，所以「取消设置」表现为字段消失，而不是存 `false`/`''`。
  指向**已不存在分类**的键在读写两侧都被容忍——否则删掉一条 YAML 分类后每次保存都会
  400。**颜色/图标只存在这里**：`parseGroupsConfig` 会丢弃 YAML 的未知键，所以在
  sidecar 里写 `color:` 会被静默忽略。
- **降级提醒**：旧版本会整文件覆盖 overlay，下一次保存就会丢掉 `appearance`
  （与 `categoryOrder` 同级别风险）。回退插件版本前请先备份
  `workspace-groups.manual.json`。
- 文件由浏览器 UI 全量写入（`PUT /workspace-groups/manual`，原子替换），手工编辑
  同样生效（下次加载时读取）；写坏会返回 400 并保留原文件，不会破坏规则 YAML。

| 操作 | 入口 |
|---|---|
| 新建分组 | 区头「新建分组」按钮（文件夹图标），弹窗输入名称 |
| 重命名/删除分组 | **任意分组**（含规则分类）悬停 `⋯` 菜单；删除后组内项目回顶层 |
| 设置分组外观 | `⋯` 菜单「颜色与图标…」：色板、图标网格、自定义字形；每次点击立即写入（没有「确定」按钮） |
| 置顶分组 | `⋯` 菜单「置顶分组」/「取消置顶」；把分组拖过置顶边界时会在同一次写入里自动翻转 |
| 拖项目进分组 | 拖动项目行到目标分组行 / 分组内任意项目行，松手即移入 |
| 项目排序 | 拖动项目行到同组另一项目行：**上半 = 插到它前、下半 = 插到它后**（指示线显示落点）；拖动时所有项目行收起、dragend 恢复 |
| 顶层排序 | 拖动顶层项目行到另一顶层行：**上半 = 插到它前、下半 = 插到它后**；顺序持久化 `workspaceOrder["__topLevel__"]` |
| 移出分组 | 拖到**顶层区域任意位置**（用插入横线指示落点——拖到顶层行前/后、最后一行下方追加、顶层为空时最后分组行下方独立横线），或项目行菜单「移出分组」（强制移到顶层） |
| 分组排序 | 拖动分组行到另一分组行：**上半 = 移到它前、下半 = 移到它后**（指示线显示落点；拖动时所有分组收起、dragend 恢复） |

## 会话标签栏（tab strip）

侧栏树上方常驻一条横向标签栏，每个「打开过的会话」对应一个标签，显示项目名 + 标签名：

- **打开 / 切换 / 关闭**：打开一个会话即在标签栏尾部新增一个标签；点击标签切换会话，
  点击 `×` 关闭该标签。
- **中键单击**标签直接关闭；**拖动**标签可调整顺序。固定标签始终留在前部的固定区，
  拖动不会跨越该边界。
- **重命名标签**：双击标签即可给标签单独起名（留空恢复为会话标题）。真正的会话改名
  仍在右键菜单里，标签名不会改写会话标题。
- **右键菜单**：固定/取消固定、重命名标签、重命名会话、关闭、**关闭其他标签**、
  **关闭右侧标签**。「关闭其他标签」始终保留已固定的标签。
- **持久化**：标签栏写入 `$DSH_HOME/workspace-groups.tabs.json`，走宿主路由
  `GET/PUT /workspace-groups/tabs`；旧版本写下的标签栏（没有固定/自定义名
  字段）可无缝升级——缺字段按「未固定、无自定义名」读取。

## 收录标签（topics）

本仓库面向 DSH 插件生态的自动收录（社区市场靠 GitHub topic 扫描发现），已设置：

- `dsh-plugin`（核心标签，[1024Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)
  等市场定时按此 topic 自动发现，并校验 `package.json` + 插件 bundle 清单
  （`cordis.patch.yml`））
- `deepseek-harness` / `deepseek-harness-plugin` / `dsh`
- `sidebar` / `workspace` / `workspace-groups`

`package.json` 同时提供 `keywords` 便于 npm/搜索索引。

## 开发

```sh
pnpm install
pnpm typecheck   # host + client 双 program 类型检查
pnpm test        # 核心规则、overlay、树派生单测
pnpm build       # 构建 lib/（node 半 + client bundle）
pnpm watch       # tsdown 监听（client HMR）
node scripts/verify-groups.mjs   # 真机 CDP 验证（host 已重启时；自启独立 headless Chrome，自动恢复现场）
```

产物契约（与官方 client 包一致）：

- `lib/index.js` —— host 半（ESM；读取 sidecar + `/workspace-groups/config` 路由，
  js-yaml 已内联，无运行时依赖）
- `lib/client.js` —— browser 半（`window.__ModuleLoader__.load({id, factory})`；
  仅 require 平台 seed：react / react/jsx-runtime / @deepseek-ai/dsh-client-runtime/client /
  @deepseek-ai/dsh-client-ui-primitives；跨插件值 import 在构建期被 purity 门拒绝）
- `lib/types/**` —— 声明文件

> 发布策略说明：`lib/` 构建产物随仓库提交（无 `prepare` 脚本），因此
> `dsh plugin add github:...` 全程无需执行第三方构建脚本，安装即用。

## 目录结构

```
src/
  index.ts              # host 半：config 快照路由 + manual 写路由
  host-config.ts        # sidecar YAML 读取/校验
  host-manual.ts        # runtime overlay 读写/校验（原子发布）
  context-types.ts      # host 侧 cordis 服务结构类型
  core/
    types.ts            # 配置类型（两半共享）
    matcher.ts          # 分类规则 + 手动覆盖优先级 + 排序纯函数（两半共享）
  client/
    index.ts            # apply：注册 sidebar.workspaces（priority -1）
    contract.ts         # 注入面类型
    stores.ts           # 展开状态 store（persist: dsh.workspace.groups.view.v1）
    tree.ts             # 三层树派生 + 树形搜索派生
    GroupsBrowser.tsx   # 浏览区域组件（分组弹窗 + 拖拽归类/排序 + 插入指示线）
    rows.tsx            # 分类/项目/会话/搜索结果行（拖拽源/目标）
    locales.ts          # 中英文案
    styles.css          # 内联样式
tests/
  core.test.ts          # 分类规则 + 手动覆盖优先级 + moveBefore/moveAfter + 配置解析
  manual.test.ts        # overlay 校验 + 文件原子往返
  tree.test.ts          # 树派生渲染契约（手动分组空渲染/覆盖优先）
  store.test.ts         # 展开状态语义（折叠写 false 不删 key）
scripts/
  verify-groups.mjs     # 真机 CDP 验证（自启 headless Chrome，自动恢复现场）
```

> 开发文档（`docs/` 五级框架与 `AGENTS.md`）是开发用工程文件，**不随仓库分发**
> （已在 `.gitignore` 排除）。

## 验证记录

- v0.1/v0.2 真实组合验证（headless Chrome + CDP 实操）：三层树顶替生效、分类正确、
  展开持久化、搜索保留归属；`workspace.json` / 会话落盘 / 官方 store 零侵入。
- v0.3 真机验证 24/24（`scripts/verify-groups.mjs`：建组/拖拽/排序/收起/规则分类
  菜单/重命名/删除回顶层/现场恢复，零侵入断言）。
- v0.4 真机验证 30/30（新增：插入指示线、项目/分组**向下拖**（行下半 → 插到目标
  之后）、分组向上拖（行上半 → 移到目标之前）；现场恢复通过）。
- v0.4.1 真机验证 34/34（新增：**从分组拖出**——顶层落点区/顶层行 drop =
  强制顶层；分组内项目行菜单「移出分组」）。
- v0.5 真机验证 35/35（模型变更：**无「未分类」桶**——顶层项目行、删除分组成员
  回顶层、拖拽/菜单移出到顶层、树中不存在未分类桶；现场恢复）。
- v0.6 真机验证 40/40（新增：**按级别收起**——拖项目只收起项目行（分组行不收）、
  拖分组只收起分组行（项目行不收）；dragend 还原拖动前展开快照）。
- v0.6.1 真机验证 42/42（新增：**整个顶层区域为移出落点**且拖拽中有可见高亮提示；
  分组/项目行图标区分；现场恢复）。
- v0.7 真机验证 46/46（新增：顶层落点改用**插入横线**（非高亮框）——拖到顶层行前/后、
  最后一行下方追加、顶层为空时独立横线；**顶层项目可排序**，顺序持久化
  `workspaceOrder["__topLevel__"]`；并修复 host 校验拒绝 `__topLevel__` 与
  「拖到两行之间却落在上一行上面」的落点定位 bug；现场恢复）。
- 单测 66 用例全绿（vitest：`core` / `manual` / `tree` / `store`）。
- 可复跑的自动化真机验证：`node scripts/verify-groups.mjs`（需 host 已重启）。

## 鸣谢与上游

本仓库是 [**z-col/dsh-workspace-groups**](https://github.com/z-col/dsh-workspace-groups) 的
**fork**，原作者为 [**zcol**](https://github.com/z-col)（297114876@qq.com），以 MIT 许可发布。
三层「分类 → 项目 → 会话」树、拖拽归类、sidecar YAML 规则、runtime overlay、顶层排序与
会话标签栏，均出自原作者的设计与实现——没有这些工作就没有本仓库，在此致谢。

上游仍是本项目的正源：若某个问题在上游同样存在，请提交到上游仓库的 issue tracker；
本仓库以 `upstream` remote 指向它作为来源。

本 fork 在上游 `release: workspace-groups-local 1.0.0` 之上新增/调整的内容：

- 外观弹窗新增 **「材料与实验」图标分区**：28 个统一规格的 16×16 手绘线条字形
  （实验操作、材料结构、表征测试、功能器件），与原有 50 个宿主图标、16 个 Emoji 并列，
  带中英双语悬停提示；旧图标 ID、自定义短字形与「恢复默认」行为完全不变
- **外观弹窗在宿主 Modal 内滚动**：图标区变大后既不会把「完成」按钮挤出视野，也不会让
  默认图标输入框的聚焦边框贴住「置顶分组」按钮，浅/深主题一致
- **所有行统一一个右对齐尾槽**：成员数（会话行则是相对时间）贴着行右边界，悬停或键盘
  聚焦时让位给「＋」「⋯」按钮，零重排；每行都按「＋」在前、「⋯」在后排列
- 宿主的**默认工作区被固定在侧栏底部独立一栏**（上方分隔线，树滚动时始终可见），保留
  工作区行的全部能力（展开、新建会话、重命名、删除、`⋯` 菜单、文件夹管理、外观入口），
  并从分组、顶层与搜索结果中去除重复——识别依据来自宿主工作区数据，而不是只认目录名
- `tools/verify-row-layout.mjs`：针对样式表与行结构的断言；因为作者本机的 vitest 缺
  `@vitest/utils`、`std-env` 无法启动，改用零依赖脚本做等价验证

## License

MIT——原始作品 © 2026 zcol（[z-col/dsh-workspace-groups](https://github.com/z-col/dsh-workspace-groups)）；
本 fork 的修改 © 2026 newbieQQ。完整的署名与开源声明见 [LICENSE](./LICENSE) 与
[NOTICE.md](./NOTICE.md)。
