const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Services', 'LocalServiceManager.cs'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'App.xaml.cs'), 'utf8');
const host = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');

assert.match(manager, /RestartAsync\s*\(/, '本机服务管理器必须支持假死恢复');
assert.match(manager, /preferred\.Port|previous\.Port/, '恢复时必须复用原端口，确保现有 API 客户端继续可用');
assert.match(manager, /preferred\.ApiToken|previous\.ApiToken/, '恢复时必须复用会话令牌，确保页面会话连续');
assert.match(app, /RecoverLocalServiceAsync\s*\(/, '应用层必须串行执行健康检查与重启');
assert.match(app, /LocalServiceReady\s*=\s*LocalService\.StartAsync/, '首次启动失败后必须允许重新建立本机服务任务');
assert.match(app, /HealthAsync\(cancellationToken\)/, '返回服务地址前必须确认 sidecar 仍然健康');
assert.match(host, /RecoverLocalServiceAsync/, '桌面主界面必须周期检测并恢复本机服务');

console.log('本机 SQLite sidecar 假死恢复回归测试通过');
