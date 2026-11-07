# 内置 SSH 与远程文件夹实施方案（审阅稿）

日期：2026-11-03  
仓库：`dsh-workspace-groups`（`workspace-groups-local@1.3.0`）  
目标：不再把 `@zhangfengshun/dsh-remote-ssh` 作为运行依赖，由本插件自己提供 SSH 连接、远程目录、远程文件夹工作区和文件/终端能力。

---

## 0. 结论先行

1. **传输层用系统 OpenSSH，不自写 SSH 协议。** 继续用 `ssh` / `sftp` 这套已验证的客户端，保留 `~/.ssh/config`、ProxyJump、known_hosts、密钥代理、老 HPC 算法和 2FA 兼容性；插件自己负责连接管理、文件操作、镜像工作区和 UI。这样“内置”指**不依赖 Remote-SSH 插件**，不是“不依赖系统 ssh”。
2. **远程文件夹仍然使用 mirror-backed 原生 Workspace。** 浏览器只看到本地镜像路径，Host 用 `.workspace-groups-remote.json` 把它映射到远端；原生 Workspace 身份和已有会话不重建。
3. **先做可替换的最小闭环，再补完整工具面。** 先完成“连接配置 → 远程选目录 → 建远程文件夹 → 重启后仍可用 → 删除/迁移”，再接文件写回、终端、exec、glob/grep、同步。不要一开始就重写 13 个工具。

> 关键限制先说清楚：DSH 的通用 bash/终端执行仍以本地 Workspace 的 `cwd` 为准。内置 SSH 能做到“远程文件夹 + 显式远程工具 + 远程终端”，**不能仅靠插件让 Agent 的所有 bash 命令在 HPC 上执行**；后者需要 DSH 平台提供远程执行层。若你的预期是后者，这份方案的边界需要先扩大。

---

## 1. 目标与非目标

### 1.1 目标

- 卸载 `@zhangfengshun/dsh-remote-ssh` 后，分组、文件夹、远程目录选择、远程工作区创建仍可用。
- Host 端持有 SSH 配置、密钥路径、连接池、超时/重连、SFTP/命令执行；浏览器端不接触私钥内容和密码。
- 远程目录选择、远程文件夹创建、删除、重新打开、离线提示完整。
- 远程写入失败**硬失败**，绝不静默写本地镜像；读缓存明确标记“离线副本”。
- 兼容现有 `~/.dsh/remote-workspaces` 镜像和旧 Remote-SSH 记录，可回滚。
- Windows 本地 + Linux/macOS 远程；Unicode、空格、单引号路径可用。

### 1.2 非目标（v1 不做）

- 不做远程 Windows 主机（Remote-SSH 当前也主要按 POSIX 远程设计）。
- 不把 SSH 私钥、密码、passphrase 写入浏览器 bundle、URL、日志、marker 或普通配置文件。
- 不做跨设备云同步；镜像仍是本机缓存。
- 不在本方案里顺手修“本地/云端会话拆分”和“图标分类”，它们独立跟踪；但会预留 project identity 接口，避免再次写死。

---

## 2. 现状与约束

### 2.1 当前调用链

```text
GroupsBrowser / FoldersDialog
  -> src/client/folder-directory.ts
       POST /remote-ssh/api/{listProfiles,listDir,remoteExec,createRemoteWorkspace,listWorkspaces,mkdir}
  -> @zhangfengshun/dsh-remote-ssh (Host)
       OpenSSH CLI + 连接池 + 镜像 + workspaceRegistry
  -> ctx.workspaceRegistry.create(mirrorDir, title)
```

唯一远程 seam 是 `src/client/folder-directory.ts:30-53`；`remoteExec("cd ... && pwd -P")` 在 `:141`。当前 Host 只 `inject = ['webServer']`（`src/index.ts:57-61`），路由在 `:122-348`。

### 2.2 关键事实

- Remote-SSH 2.4.41 已安装，MIT，只发布 `lib/index.js` / `lib/client.js`，**没有源码**；不能可靠地 fork/vendor 维护。
- 它用 `ctx.subprocess`、`ctx.workspaceRegistry`，底层是系统 `ssh`，不是 ssh2。
- 远程工作区本质是 `workspaceRegistry.create(mirrorDir, title)` 注册的本地镜像目录；会话 `cwd` 指向镜像。
- 现有镜像 marker 是 `.remote-ssh.json`，里面含 `keyPath`；新方案不能继续把密钥路径写进工作区可见文件。
- 现有测试：`tests/folders.test.ts`、`tests/tree.test.ts`、`tests/core.test.ts`、`tools/verify-folders.mjs`、`tools/verify-folder-directory.mjs`（mock）、`tools/verify-directory-flow.mjs`、`scripts/verify-groups.mjs`（CDP 真机）。
- 构建：Host ESM + client CJS（`tsdown.config.ts:82-136`），浏览器包不能 import Node builtins。

---

## 3. 传输层选型

| 维度 | 系统 OpenSSH（推荐） | ssh2 / node-ssh |
|---|---|---|
| 配置兼容 | 原生读 `~/.ssh/config`、ProxyJump、Match、Include | 要自己解析，容易漏 |
| 认证 | key、agent、password、keyboard-interactive/2FA 都由 ssh 处理 | 要自己实现 askpass/2FA 流程 |
| 老 HPC 算法 | 跟随系统 ssh，兼容性最好 | 受库的算法列表限制 |
| 文件操作 | 需要 shell/SFTP 组合，需严格转义 | SFTP 原生、结构化、最稳 |
| 依赖 | 系统需有 `ssh`（Windows 可选功能） | 纯 JS，但 ssh2 有可选原生依赖 |
| 安全边界 | 复用成熟客户端；参数数组调用，不拼 shell | 自己处理 host key、超时、通道，代码面更大 |
| 迁移风险 | 与现有 Remote-SSH 行为最接近 | 需重新验证跳板、密码、算法、终端 |

**决定：v1 用系统 OpenSSH。**  
理由：当前插件的行为基线就是 OpenSSH；用户环境已能连 HPC；换成 ssh2 会把“替换插件”变成“重写 SSH 客户端”，风险和工作量都更高。

本机已确认 `C:\Windows\System32\OpenSSH\ssh.exe` 与 `sftp.exe` 存在（PATH 中另有 OpenSSH_10.5p1），v1 不需要额外安装依赖。

保留后路：`SshTransport` 做成接口；如果未来要求“零系统依赖”，再加 `ssh2` 实现，不动上层。

---

## 4. 目标架构

```text
Browser (React)
  ├─ SSH 设置 / 连接测试 / 远程目录选择器
  ├─ 只知道 profileId、displayName、目录项；不知道 keyPath/password
  └─ fetch /workspace-groups/ssh/*
                 │
Host (Node ESM)
  ├─ SshProfileStore         ~/.dsh/workspace-groups/ssh-profiles.json (0600)
  ├─ SecretVault             仅内存；密码/passphrase，重启即清
  ├─ SshTransport            ctx.subprocess + ssh/sftp；超时、取消、重连、并发上限
  ├─ RemoteFs                stat/list/read/write/mkdir/rename/delete/glob/grep
  ├─ RemoteWorkspaceService  镜像目录 + marker + workspaceRegistry.create/delete
  ├─ Migrator                旧 Remote-SSH 记录/镜像一次性导入
  └─ RemoteTools             远程 exec/read/write/...（Host 工具，不经浏览器）
                 │
        ctx.workspaceRegistry.create(mirrorDir, title)
                 │
        ~/.dsh/remote-workspaces/<recordId>/   ← 原生 Workspace 的 cwd
```

### 4.1 新增/修改文件

| 文件 | 作用 |
|---|---|
| `src/host-ssh/profiles.ts` | profile CRUD、校验、0600 原子写、导入 `~/.ssh/config` |
| `src/host-ssh/transport.ts` | 连接测试、命令执行、超时/取消、并发池、host key 策略 |
| `src/host-ssh/files.ts` | 远程文件操作、路径规范化、原子写、大小上限 |
| `src/host-ssh/workspaces.ts` | 镜像、marker、workspaceRegistry 注册/清理、幂等 |
| `src/host-ssh/migrate.ts` | 旧记录/旧镜像导入、双读、回滚 |
| `src/host-ssh/tools.ts` | Host 侧 `remote_*` 工具注册（M2 起） |
| `src/client/ssh-settings.tsx` | 连接管理 UI；密码只提交到 Host，不回显 |
| `src/client/remote-picker.tsx` | 远程目录浏览；复用现有目录选择器样式 |
| `src/client/folder-directory.ts` | 把 `/remote-ssh/api/*` 换成 `/workspace-groups/ssh/*`；保留六种操作 DTO，删掉 generic `remoteExec` |
| `src/index.ts` | 注入 `workspaceRegistry`；注册 SSH 路由；统一错误 envelope |
| `src/host-folders.ts` | remote marker 只做 fail-closed；新增我们自己的 marker 校验 |
| `src/client/folders-persist.ts` | 创建失败回滚，保证 members round-trip |
| `cordis.patch.yml` | 如接终端 wrapper，补 terminal-controller 补丁；M2 再做 |

### 4.2 Host 路由（示意）

```text
GET    /workspace-groups/ssh/profiles
POST   /workspace-groups/ssh/profiles
PATCH  /workspace-groups/ssh/profiles/:id
DELETE /workspace-groups/ssh/profiles/:id
POST   /workspace-groups/ssh/profiles/:id/test
POST   /workspace-groups/ssh/profiles/:id/list
POST   /workspace-groups/ssh/profiles/:id/mkdir
POST   /workspace-groups/ssh/workspaces
GET    /workspace-groups/ssh/workspaces
DELETE /workspace-groups/ssh/workspaces/:recordId
POST   /workspace-groups/ssh/workspaces/:recordId/sync
```

响应统一 `{ ok: true, value }` / `{ ok: false, error: { code, message } }`；沿用当前 `HttpError` 和请求体上限，不引入新的网络暴露面。

---

## 5. 数据模型

### 5.1 Profile

```ts
type SshAuth =
  | { kind: 'key'; keyPath: string }       // 仅 Host 可读；浏览器只看到 basename
  | { kind: 'agent' }
  | { kind: 'password' }                   // 密码不落盘，仅 SecretVault

interface SshProfile {
  id: string                 // crypto.randomUUID()
  name: string
  host: string
  port: number               // 默认 22
  user: string
  auth: SshAuth
  proxyJump?: string
  remoteRoot: string         // 默认 '~'；文件操作必须落在此根下
  connectTimeoutMs: number   // 默认 15000
  keepaliveSeconds: number   // 默认 30
}
```

- 存储：`~/.dsh/workspace-groups/ssh-profiles.json`，权限 `0600`，原子 rename。
- 不存密码/passphrase；`SecretVault` 以 `profileId` 为键存在 Host 内存，重启清空。
- 导入 `~/.ssh/config` 只复制 host/user/port/keyPath/proxyJump，不复制密码。

### 5.2 远程工作区记录

```ts
interface RemoteWorkspaceRecord {
  id: string                 // 稳定 recordId，不用时间戳拼
  profileId: string
  title: string
  remotePath: string         // 用户看到的绝对路径
  mirrorPath: string         // 本地绝对路径
  workspaceId: string        // 原生 workspaceRegistry id
  createdAt: string
  schemaVersion: 1
}
```

Marker：`<mirror>/.workspace-groups-remote.json`

```json
{"schemaVersion":1,"recordId":"...","profileId":"...","remotePath":"/home/u/proj"}
```

**不写** host/user/keyPath/proxyJump；这些只在 Host profile store。旧 `.remote-ssh.json` 只读，不修改。

### 5.3 FolderMember

沿用 `src/core/folders.ts:20-68` 的 `FolderMember`，不新增必填字段；可选加：

```ts
remoteRecordId?: string   // 只做诊断/迁移，不参与归属
```

`workspaceId` 仍是唯一权威；`path` 仍是镜像路径。不要用标题或 host 反推归属。

---

## 6. 安全不变量

| # | 不变量 | 验证 |
|---|---|---|
| S1 | 私钥内容永不进入 Host 响应、浏览器 bundle、日志、marker | 构建产物 grep `BEGIN OPENSSH PRIVATE KEY`；路由快照断言无 keyPath |
| S2 | keyPath 只在 Host profile store；浏览器只拿 basename | API 单测 |
| S3 | password/passphrase 只存内存，响应不回显，日志脱敏 | 重启后连接需重输；日志 grep |
| S4 | host key 默认 `StrictHostKeyChecking=yes`，使用应用私有 known_hosts；首次连接显示指纹并要求确认 | 中间人测试：换 key 必须失败 |
| S5 | 远程路径必须落在 profile `remoteRoot` 内，`realpath -m` 后校验；拒绝 `..`、NUL、换行 | 路径穿越测试 |
| S6 | 所有进程用 argv 数组调用，禁止 `shell: true`；远程命令参数用 POSIX 单引号 + base64 | 注入测试（`'`, `$(...)`, 空格, 中文） |
| S7 | 写文件先写同目录临时文件，再 `mv` 原子替换；失败保留原文件 | 断连/磁盘满测试 |
| S8 | 远程写失败绝不回落本地镜像；读缓存只读并标 `offline` | 断网测试：镜像 mtime 不变，UI 明确报错 |
| S9 | 单命令/单文件有超时与大小上限；可取消；输出截断 | 大文件、`sleep 999`、`kill` |
| S10 | 删除远程文件夹只删本地记录/镜像，**不删远端目录**；删除远端目录需单独确认 | UI 文案 + 测试 |

补充：
- 使用应用私有 known_hosts：`~/.dsh/workspace-groups/known_hosts`，提供“从 `~/.ssh/known_hosts` 导入”按钮；不静默接受新主机。
- 密码认证只在回环/受信 Host 上可用；若 GUI 通过局域网访问，提示改用密钥。
- 命令输出做 secret redaction；`ssh -v` 诊断只保留认证相关行，其他丢弃。

---

## 7. 远程工作区生命周期

### 7.1 创建

1. 校验 profile + `remotePath`，`cd <path> && pwd -P` 解析绝对路径；不存在则按用户选择 `mkdir -p`。
2. 按 `profileId + remotePath` 查重；已存在则复用 record，不新建。
3. 生成稳定 `recordId`；镜像目录沿用 `~/.dsh/remote-workspaces/<recordId>`。
4. 创建镜像目录，写 marker（不含密钥信息），写一份只读 `README.md` 说明“这是远程镜像，写操作请走远程工具”。
5. `ctx.workspaceRegistry.create(mirrorPath, title)`；若已有同路径原生 Workspace，复用其 id 并 `setTitle`。
6. 保存 record；返回 `{mirrorPath, workspaceId, recordId, remotePath, profileId, reused}`。
7. 任一步失败：回滚已创建的原生 Workspace / 镜像；**不写 folders overlay**。客户端只有在拿到完整返回后才 PUT members。

### 7.2 删除

- 从 folders overlay 移除 member；
- 若无其他 member 引用同一 `workspaceId`，删除原生 Workspace 记录和镜像；
- **不执行远端 `rm -rf`**；UI 明确写“只移除本地映射，不会删除服务器文件”。

### 7.3 重开/离线

- 启动时只读 marker + record，不自动连 SSH；目录行显示“远程（离线）”状态。
- 用户点开或执行操作时才连接；失败显示具体阶段（DNS/TCP/认证/host key/权限），不把本地镜像伪装成远端成功。

---

## 8. 从 Remote-SSH 迁移

原则：**先双读，后切换，可回滚；不重建原生 Workspace，不丢已有会话。**

1. 一次性读取旧插件 `listWorkspaces`（若仍安装）或扫描 `~/.dsh/remote-workspaces/*/.remote-ssh.json`。
2. 按 `host + user + port + keyPath basename` 匹配/创建新 profile；密码不迁移，要求重输。
3. 复用旧 `mirrorPath` 和 `shellWorkspaceId`（旧记录里有）；生成我们的 record + marker。
4. 迁移 `FolderMember` 时保留 `workspaceId`，只补 `remoteRecordId`；不按标题合并。
5. 旧插件仍保留安装但禁用；新插件通过 feature flag 接管。验收通过后再卸载旧插件。
6. 回滚：保留旧 `.remote-ssh.json` 和旧设置不动；关闭新 backend 即可回到旧插件。

---

## 9. 会话拆分问题（独立小任务）

用户看到的“同一项目在本地文件夹和云端文件夹分成两个会话列表”，根因大概率不是 SSH 传输，而是**每个远程文件夹注册了不同的原生 Workspace，Session 的 `workspaceId` 不同**。本方案只做两件事，避免加重问题：

- 创建远程文件夹时优先复用同一逻辑项目的 owner/member 归属，不产生新的顶层项目行。
- 预留 `projectKey` 投影接口；后续用“canonical project”聚合会话，不直接改写 Session 归属。

需要一次平台能力验证（Phase 0）：

> 能否在 owner Workspace 下创建 `cwd = 远程镜像` 的 Session？
> - 能：远程文件夹不新建 Workspace，会话天然统一，这是最优解。
> - 不能：保留 mirror-backed Workspace，另做 UI 投影聚合。

在验证前不承诺“合并历史会话”。

---

## 10. 分阶段实施

| 阶段 | 内容 | 交付/验收 | 预估 |
|---|---|---|---|
| P0 决策与探针 | 确认传输选型；验证 owner Workspace + mirror cwd 是否可行；冻结六种 DTO 和错误码 | 一页探针结论；不写生产代码 | 0.5–1 天 |
| P1 连接与目录 | profiles、连接测试、known_hosts、远程 list/mkdir、SSH 设置页 | 不装 Remote-SSH 也能连 HPC、浏览目录 | 3–5 天 |
| P2 远程文件夹闭环 | 镜像、marker、workspaceRegistry、创建/删除/重开、folders 回滚、迁移 | 建远程文件夹，重启后仍在；删记录不删远端 | 3–5 天 |
| P3 文件与终端 | read/write/stat/rename/delete/glob/grep、原子写、离线态、终端 wrapper | 远程改文件失败不落本地；终端进 HPC | 4–7 天 |
| P4 工具面/同步 | exec 超时/取消、sync/push、上传、13 工具对齐、并发池 | 与旧插件功能对照表全绿 | 4–8 天 |
| P5 加固发布 | 安全测试、Unicode/空格/引号、大文件、断网、CDP 真机、文档与迁移说明 | 验收清单全过；可卸载旧插件 | 3–5 天 |

**总计约 15–30 个工作日**（单人；不含会话合并和图标分类）。如果只做 P1–P2，约 7–11 天，就能先摆脱“建远程文件夹必须装 Remote-SSH”。

---

## 11. 验收清单

### 功能

- [ ] 全新 profile：密钥、agent、密码（内存）三种认证都能连。
- [ ] ProxyJump / `~/.ssh/config` 的 Host 别名可用。
- [ ] 远程目录浏览支持 `~`、绝对路径、空格/中文/单引号目录。
- [ ] 创建远程文件夹后，原生 Workspace 的 `cwd` 是镜像路径，标题正确。
- [ ] 重启 DSH 后，远程文件夹仍在，能重新打开。
- [ ] 删除远程文件夹只删本地映射，远端目录和文件不变。
- [ ] 旧 Remote-SSH 记录迁移后，已有会话仍挂在原 Workspace 下。

### 安全/失败

- [ ] 构建产物和 API 响应中搜不到私钥内容、密码、完整 keyPath。
- [ ] host key 变化时连接失败，不自动接受。
- [ ] 远程路径 `../../etc`、symlink 逃逸被拒绝。
- [ ] `$(touch /tmp/pwned)`、反引号、换行注入不执行。
- [ ] 断网写文件：报错，镜像文件字节不变。
- [ ] 命令超时/取消后子进程被 kill，无孤儿 ssh。
- [ ] 日志不含 Authorization、密码、passphrase。

### 兼容

- [ ] Windows 本地 + Linux 远程；macOS 本地 smoke。
- [ ] 远程 Unicode 文件名 round-trip。
- [ ] 大文件超过上限时明确拒绝，不截断后写回。
- [ ] 卸载 Remote-SSH 后，P1–P4 功能不回退。

---

## 12. 风险与待确认

1. **“完整内置”的边界**：如果要求 Agent 的普通 bash 也在 HPC 执行，这不是本插件能单独完成的，需要 DSH 平台远程执行层；本方案只能做到显式远程工具 + 远程终端。
2. **系统 OpenSSH 依赖**：Windows 需启用 OpenSSH Client；安装页要检测 `ssh -V` 并给出一键说明。若你要求零系统依赖，需改 ssh2，工期和兼容风险上升。
3. **密码/2FA**：v1 密码只存内存，重启要重输；keyboard-interactive 先走终端，Host 工具面后补。若必须持久化，需要接 OS 凭据库（DPAPI/Keychain/libsecret），单独评估。
4. **远程 Windows 主机**：v1 不做；POSIX shell 假设（`sh`、`base64`、`find`、`grep`）。
5. **终端 wrapper**：需要 `nodePath` 逃生舱（旧插件已有同类问题）；Desktop 的 Host node 不一定在 PATH。
6. **会话拆分**：见第 9 节，先探针后承诺。
7. **图标分类**：与 SSH 无关，独立处理；当前通用 50 个图标未分节，材料 28 个已分 4 节。

---

## 13. 需要你拍板的三件事

1. **传输层**：系统 OpenSSH（推荐，兼容最好）还是纯 JS `ssh2`（零系统依赖，但重写配置/跳板/2FA）？
2. **首期范围**：只做 P1–P2（远程文件夹闭环，最快摆脱 Remote-SSH），还是一次做到 P4（完整工具面）？
3. **密码策略**：只存内存、重启重输（推荐，安全）还是接 OS 凭据库持久化？

确认后我再动代码；当前仓库工作树干净，未改任何实现文件。
