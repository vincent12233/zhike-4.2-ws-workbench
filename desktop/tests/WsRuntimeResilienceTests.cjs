const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const legacy = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8').replaceAll('\r\n', '\n');
const capability = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Services', 'WsCollectionCapability.cs'), 'utf8');

assert.match(legacy, /querySelector\(['"]#pane-side['"]\)/, '工作台必须用当前 WhatsApp 会话栏识别已登录状态');
assert.doesNotMatch(legacy, /documentElement\.style\.zoom\s*=/, '生产工作台不得缩放 WhatsApp 根节点，否则 WebView 底部留下空白并裁切二维码');

assert.match(legacy, /SetWsStatusAsync\(accountId,\s*"已连接"\)[\s\S]{0,500}_wsQueue\.EnqueueAsync/, '收到授权页面采集后应先更新连接状态并持久化队列');
const wsMessageHandler = legacy.match(/private async void OnWsWebMessageReceived[\s\S]*?\n    }\n\n    private async Task FlushWsQueueAsync/)?.[0] || '';
assert.ok(wsMessageHandler, '必须保留 WS 页面异步采集消息接收器');
assert.doesNotMatch(wsMessageHandler, /ReferenceEquals\(sender,\s*_wsView\.CoreWebView2\)/, '同一 WebView2 原生页面的回调包装对象可能不同，不能用引用相等丢弃完整历史消息');
assert.match(wsMessageHandler, /IsAllowedNavigation\(args\.Source,\s*"web\.whatsapp\.com"\)/, '移除引用相等检查后仍必须校验 WhatsApp 来源域名');
assert.match(wsMessageHandler, /OnWsWebMessageReceived\(string sessionAccountId, long sessionGeneration/, '异步完整历史消息必须携带池化会话账号与代次');
assert.match(wsMessageHandler, /App\.WsSessions\.IsCurrent\(sessionAccountId, sessionGeneration\)/, '异步完整历史消息必须通过当前账号代次栅栏');
assert.match(wsMessageHandler, /claimedAccountId[\s\S]*?string\.Equals\(claimedAccountId, accountId, StringComparison\.Ordinal\)/, '页面声明账号必须与隔离会话账号一致');
assert.match(legacy, /_wsFlushGate/, 'WS 入库必须串行化，避免大批量扫描压死 SQLite sidecar');
assert.match(legacy, /CancelAfter\(TimeSpan\.FromSeconds\((?:10|15|20)\)\)/, 'WS 入库必须有短超时并可回退本机队列');
assert.match(legacy, /current\.length\s*>=\s*250/, '单个 WS 入库包必须限制记录数，避免同步 SQLite 长时间阻塞健康接口');
assert.doesNotMatch(legacy, /BuildWsCollectorScript\(accountId\)/,
  'RD02 不得向前台或复制认证状态的后台注入自动完整列表采集器');
assert.match(legacy, /if \(WsCollectionCapability\.BlocksAction\(action\)\) return WsCollectionBlocked\(requestId, id\);[\s\S]{0,260}_activeWsAccountId = id/,
  '自动采集请求必须在账号或会话状态变更前被明确拒绝');
assert.match(capability, /BackgroundCollection => false/);
assert.match(capability, /AutomaticHistory => false/);
assert.match(capability, /ForegroundFallback => false/);
assert.match(capability, /ManualVisibleImport => true/);
assert.match(legacy, /if \(kind is "discover" or "collect-all-read"\) return WsCollectionBlocked\(requestId, accountId\)/,
  '直接调用采集入口也不得绕过阻断或退回前台采集');
assert.match(legacy, /if \(kind is not \("messages" or "selection"\)\)/,
  '保留一次性人工可见原文或选中文本导入，不将其冒充完整历史');
assert.match(legacy, /_ => BuildWsVisibleCaptureScript\(accountId\)/,
  '已有人工可见聊天导入路径保持可用');
assert.match(legacy, /RecoverLocalServiceAsync|EnsureLocalServiceAsync/, '工作台必须具备本机服务恢复路径');
assert.match(legacy, /_wsQueue\.EnqueueAsync\(/, '工作台必须先进入持久队列再写入数据库');

console.log('WS 运行时恢复与节流回归测试通过');
