<p align="right">
  <strong>English</strong> · <a href="./README_ZH.md">简体中文</a>
</p>

# dsh-better-workspace-group

A workspace grouping plugin for DeepSeek Harness. Built on [z-col/dsh-workspace-groups](https://github.com/z-col/dsh-workspace-groups), it keeps workspaces, folders, and sessions easier to organize and use from the sidebar.

## Preview

<img src="screenshot.png" alt="Workspace grouping plugin preview" width="280" />

## Implemented features

- **Workspace groups**: browse by group → project → session, with group creation, renaming, deletion, folding, and pinning.
- **Drag-and-drop organization**: move projects into or out of groups and reorder groups and projects.
- **Group appearance**: set group colors and icons, including a new Materials & Lab section for lab work, material structures, characterization, and functional devices.
- **Multiple folders per project**: attach extra folders, choose the default root, and place sessions under the folder that matches their working directory.
- **Local and remote directories**: create folders in local workspaces and registered SSH remote workspaces without falling back to a local mirror when a remote operation fails.
- **Session tabs**: open, switch, pin, rename, reorder, and close tabs, including closing other tabs or tabs to the right.
- **Sidebar refinements**: keep the default workspace pinned at the bottom, align row metadata and actions consistently, and scroll long appearance dialogs.
- **Search and persistence**: search sessions without losing their group context and keep groups, ordering, tabs, and folder settings across refreshes and restarts.

## Install

For the Desktop profile:

```sh
dsh plugin --profile desktop add github:newbieQQ/dsh-better-workspace-group
```

For Web, replace `desktop` with `web`. Fully restart DSH or the corresponding Web profile after installation.

## Basic use

1. Click **New Group** in the workspace header, then drag projects into it.
2. Use the `⋯` menu on a project or group to manage grouping, appearance, and folders.
3. Open **Folders…** on a project to attach folders or choose its default root.

For automatic grouping by path or name, see [workspace-groups.example.yaml](./workspace-groups.example.yaml) and configure `~/.dsh/workspace-groups.yaml`. Manual grouping works without this file.

## Uninstall

```sh
dsh plugin --profile desktop remove workspace-groups-local
```

## Credit and license

The original project was created by [zcol](https://github.com/z-col) under the MIT License. This fork adds Materials & Lab icons, the bottom default-workspace bar, consistent row actions, remote-workspace folders, and other refinements.

Original work © 2026 zcol; modifications © 2026 newbieQQ. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).
