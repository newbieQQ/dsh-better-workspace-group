# 更新日志

## 未发布 — 一个工作区收拢多个文件夹（2026-11-07）

会话的文件范围就是它所在的工作区目录，所以分散在不同位置的文件夹无法被同一个会话同时读写。
新增「合并成一个总文件夹」：在 `$DSH_HOME/workspace-groups/farms/<名称>/` 建一个真实目录，
用链接（Windows junction / POSIX 目录符号链接）把该项目的每个文件夹放进去，再注册成一个工作区。
不复制、不移动、不改动原文件夹。

- 新增宿主路由 `POST /workspace-groups/farm` 与 `DELETE /workspace-groups/farm?path=`。宿主只接受绝对路径，
  不存在的目录直接拒绝，已存在的农场拒绝复用（避免静默合并到别人建的目录）。
- 删除只解链接：遇到真实目录立刻中止，绝不递归删除，避免顺链接删掉用户的真实文件夹。
- 侧栏「管理文件夹」对话框在该工作区有 2 个及以上文件夹时显示该操作；成功后提示新工作区路径。
- 新增 `tests/farm.test.ts`（11 项）：写入穿透链接落到真实文件夹、同名文件夹去重命名、相对/缺失目录拒绝、
  重复农场拒绝、删除后原文件夹内容不变、农场根外路径拒绝、农场内真实目录拒绝删除。

## 未发布 — 文件夹管理安全性与一致性修复（2026-11-07）

针对「工作区内的文件夹管理」扫描发现的 10 类问题做的一次集中修复。本次只改本插件，
未触碰核心 workspace.json / session 存储；`lib/` 已重新构建，Source map 不再随包发布。

### 数据完整性（高危）
- 读取 `workspace-groups.folders.json` 失败（EACCES / EISDIR / JSON 损坏）现在返回 HTTP 500，
  不再伪装成「空文档」；客户端 loadFolders 改为 `ok:false` 并禁用全部编辑，杜绝「读失败 → 下次 PUT
  写回空文档 → 所有工作区文件夹永久清空」。
- 新增基于文件内容的 `revision`（sha256 前 16 位）+ `ETag` / `If-Match` 乐观并发：PUT 不匹配返回
  409 并携带服务端最新文档；宿主侧 read→compare→write 串行化，客户端写操作排队、失败回滚、
  409 自动重载。多窗口不再静默互相覆盖。
- 未知 schema 版本只报告 `schemaWarning` 并禁用编辑，绝不降级写回 v1。
- PUT body 上限从 64KB 提到 1MB（合法文档上限约 92KB 曾永远 413）；保存请求去掉 `keepalive`
  并加 15 秒超时，避免大文档被静默截断。

### 路径与远程判定
- `canonicalPath` 增加 NFC 归一与词法 `.` / `..` 折叠；`isAbsoluteFolderPath` 改为按路径拼写判定，
  宿主与客户端共用同一函数，不再因 `process.platform` 漂移而丢弃跨平台 sidecar 条目。
- `defaultRemoteMirrorBase` 硬编码 `~/.dsh/remote-workspaces` 的问题改为显式诊断：
  `$DSH_HOME` 与硬编码根不一致时 GET 返回 `remoteBaseWarning` 并在界面显示。
- 宿主写校验现在强制 `kind:'remote'` 的 member.path 必须位于镜像根内，并拒绝 `..` 段；
  镜像归属不再只靠浏览器自觉。
- `subfolderOf` 用浏览器返回的绝对 `resolved` 路径比较（`~` 别名由 `openFoldersFor` 先解析），
  分隔符归一；云端输入框改为显式「本项目子目录 / 独立云端工作区」二选一，消除一个输入框两种语义。

### 会话与孤儿工作区
- 创建会话前必须等文件夹 overlay 落盘成功；原生工作区创建失败可补偿注销，远程文件夹创建有
  pending 复用，避免重复建镜像。
- `addMember` 同路径重注册时保留 `root`；`isDefaultWorkspace` 改为路径判据优先；
  跨 entry 拒绝「member.workspaceId 同时是 owner」，宽容读会丢弃这类旧数据。
- `parseFolderEntry` 允许缺 `folders` 字段（不再连带丢掉 members），`remoteSubpath` 与
  `joinSubpath` 对绝对/盘符/UNC 输入的判定统一；`joinSubpath` 额外拒绝 `C:foo`。

### 侧栏文件夹行
- 一个项目只占一行。此前工作区挂上额外文件夹后，每个文件夹都会变成一条带自己会话列表的行；
  云端工作区的路径是本地镜像目录，于是侧栏出现 `wmvl31c7ilkuc` 这种内部 id，项目自身的
  会话又被藏进那一行，看起来像「一个项目套在它自己里面」。
- 现在不再渲染文件夹行：工作区自己的目录和所有额外文件夹共用同一个会话列表，全部列在
  工作区标题下面。文件夹仍然可以在工作区的「⋯ → 管理文件夹」里增删、设根、打开，
  只是不再各自分裂出一套会话。
- 工作区没有额外文件夹时，节点形状与引入文件夹功能之前完全一致。

### 测试与工程
- 新增 `tests/folders-cas.test.ts`、`tests/folders-persist.test.ts`、`tests/remote-paths.test.ts`
  覆盖上述回归点；`tsc -p tsconfig.json` / `tsconfig.client.json` 与 290 个 vitest 用例全部通过。
- `tsdown.config.ts` 关闭客户端 sourcemap，`lib/client.js.map`（内嵌完整源码）已从构建产物移除；
  `.gitignore` 补 `*.map` / `*.tsbuildinfo` / `dist/` / `coverage/` / `tools/_tmp/`，并取消对
  `docs/` 的忽略，把 `remote-ssh-integration-plan.md` 纳入版本控制。
- 工作区根目录新增 README 说明目录职责；`dsh-workspace-groups-0.4.2/` 与 `tools/` 各加说明，
  标明 0.4.2 是**有意保留的重建基线，不可删除**。未删除/移动任何既有目录或文件。

### 仍未处理（需另行确认）
- `lib/` 里历史遗留的其它 37 个 tracked 文件是构建产物，未做 `git rm --cached`；若要改为
  构建时再生成，需要同步调整发布流程。
- `iggfeed.yaml` 与 `tools/fetch_clash_sub.py` 含本机代理地址/订阅 URL，仅在工作区 README 中提示，
  未改动。
- remote-ssh 2.4.40 的远程子目录会话限制、SSH 能力完整内置、会话拆分仍是
  `docs/remote-ssh-integration-plan.md` 与任务板里的独立待办，本次未动。

## 1.0.0 — 2026-10-28

首个本地稳定版本，包名 `workspace-groups-local`。基于原项目扩展，保留原 MIT 许可证与版权声明。

### 功能
- 工作区分组：颜色、图标、置顶、折叠动画、拖拽归组与排序。
- 分组行新增工作区入口，创建后自动归组并展开。
- 会话标签：固定、拖拽排序、中键关闭、右键菜单、双击重命名。
- 多文件夹与默认根目录配置。
- 移除侧栏花朵的连线，保留花朵标记。

### SSH 兼容与修复
- 顶部与分组新增工作区入口复用已注册的自包含目录选择窗口，包括 remote-ssh 的本地／远程窗口。
- 未注册选择窗口时，回退 DSH 原生本地目录选择器；不强制依赖 SSH 插件。
- 统一创建文件夹入口：本地使用 DSH API，远程使用 SSH 插件接口；远程失败禁止回退本地写入。
- 停止复制子目录 SSH 标记，旧标记不自动删除。
- 对需要额外渲染器上下文的第三方选择窗口明确报错，不静默丢弃其上下文。

### 验证与限制
- 类型检查、构建及纯逻辑／模拟接口回归测试通过。
- 用户已确认本次界面改动可用；未完成卸载 SSH 插件的独立环境测试及所有真实服务器组合测试。
- remote-ssh 2.4.40 的远程子目录会话路由不一致：暂时阻止从这些子目录新建会话，可在注册的远程工作区根启动。
- 本次仅本地 Git 提交与版本标记；未发布 npm、GitHub Release 或插件市场。公开发布前需设置自己的仓库元数据并完成安装验证。
