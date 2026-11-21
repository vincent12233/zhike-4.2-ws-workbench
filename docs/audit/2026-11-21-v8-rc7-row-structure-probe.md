# 2026-11-21 · RC7：群组核验行结构诊断

## 现状

RC6 实测仍是“现场已识别 0 个群组，前台至少 18 行缺少可靠标识”。包装容器回退没有改变结果，说明这一版 WhatsApp Web 的聊天列表行根本不暴露 JID 属性。继续猜选择器没有意义，改为让程序自己报告真实结构。

## 本次改动

- 第一条无法识别 JID 的列表行，会记录：`tag`、`role`、`data-testid`、该节点上全部 `data-*` 属性名；同时记录向上三层祖先节点的同样信息。
- 只记录结构名称，不记录标题、预览、aria-label 或任何聊天文字。
- 群组核验的“查看诊断”会多出一行：`行结构样本 · […]`。
- ws 套件 252/252；x64 Release 0 错误；ReleaseGate passed。

## 产物

| 项 | 值 |
| --- | --- |
| 安装包 | `work\releases\zhike-6.1.0-rc7-win-x64-setup.exe` |
| 大小 | 114,417,734 字节（109.12 MiB） |
| SHA-256 | `7CF57F6DF86BD0C94642874FE9CB8729D55F4CC4D320FD0B72BE2E9EAC2AF9B0` |
| 对应 commit | `13c6ee5` |
| Bundle SHA-256 | `2DDAE7D6D0433A2592EA0A1EDBB7401BB0ED93F2546F8A382A717F74EE21F9A4` |

## 注意

第一次打包时旧的 `work\winui-bundle\zhike-winui-6.1.0-win-x64` 目录被占用，脚本删除失败并把不完整内容留在了安装包里；RC7 改用独立目录 `work\winui-bundle-rc7` 重新构建，并核对了 `resources/app/node.exe`、`ws-workbench.js` 标记与 EXE 版本戳，安装包大小回到 109.12 MiB。

## 下一步

用户安装 RC7 后，在群组核验里点“查看诊断”，把 `行结构样本 ·` 那一行发回来。按真实结构补选择器，才算修复；在拿到样本之前不宣称群组发现已修复。
