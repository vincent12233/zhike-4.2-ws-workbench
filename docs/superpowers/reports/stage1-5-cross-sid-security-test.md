# 阶段 1.5 跨 SID 安全测试

## 状态

**NotTested**

## 已验证范围

隔离运行时输出了当前桌面 SID 与 Worker 对等 SID，二者一致：

```text
currentSid=S-1-5-21-3081219656-3052428467-741099362-1001
peerSid=S-1-5-21-3081219656-3052428467-741099362-1001
acl=current SID only
anonymous=false
wrongTokenRejected=true
tokenRotationRejected=true
```

Named Pipe 使用受保护 `PipeSecurity`，只添加当前 SID 的 `FullControl`，并在首帧读取后通过客户端模拟身份转换为 SID 再比较。协议层额外验证随机 token 的 HMAC proof、schema、session 和 request ID。

## 未测试

当前机器没有第二个真实 Windows 用户安全上下文，故以下用例必须保留 `NotTested`：

1. 用户 A 授权连接成功、用户 B 连接被 ACL 拒绝的真实跨用户过程。
2. 用户 B 使用 A 的旧 token/旧 pipe 访问的拒绝过程。
3. 不同登录会话下的窗口/服务边界权限继承。

不能以同 SID 子进程测试替代第二用户验收，不能把 IPC 总体标记为 Passed。

## 数据保护

测试只启动隔离 child Worker，不使用生产数据目录、不复制 Cookie/Token/WebView 登录态，结束后临时根目录已删除。正式 Worker feature flag 仍关闭。

## 回滚与提交

回滚实现使用 `bce0efb` 之前的版本；没有生产数据库迁移。报告对应的 IPC 实现提交为 `bce0efb`，最终准入仍保持 `FROZEN`，等待第二 SID 设备验收。
