const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const legacy = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Views', 'WsWorkbenchPage.xaml.cs'), 'utf8');

for (const [name, source] of [['兼容主界面', legacy], ['原生工作台', native]]) {
  assert.match(source, /querySelector\(['"]#pane-side['"]\)/, `${name} 必须用当前 WhatsApp 会话栏识别已登录状态`);
  assert.match(source, /documentElement\.style\.zoom='80%'/, `${name} 必须缩放 WS 页面以完整显示登录二维码和聊天界面`);
}

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
assert.match(native, /LegacyUiHostPage\.BuildWsCollectorScript\(accountId\)/, '原生 WS 页面必须复用完整列表采集器，不得退回仅当前可见列表');
assert.match(native, /await App\.RecoverLocalServiceAsync\(\)/, '原生 WS 页面必须周期恢复假死的本机服务');
assert.match(native, /_localQueue\.EnqueueAsync\("api\/ws\/ingest\/batch"/, '原生 WS 页面必须先进入持久队列再写入数据库');
assert.match(native, /_flushGate/, '原生 WS 页面批量写入必须串行化');

console.log('WS 运行时恢复与节流回归测试通过');
