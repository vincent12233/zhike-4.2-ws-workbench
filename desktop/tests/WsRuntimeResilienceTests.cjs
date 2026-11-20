const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const legacy = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8').replaceAll('\r\n', '\n');
const capability = fs.readFileSync(path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Services', 'WsCollectionCapability.cs'), 'utf8');

const loginProbe = legacy.match(/private const string WsLoginProbeScript = """\s*([\s\S]*?)\s*""";/)?.[1];
assert.ok(loginProbe, '必须存在 WebView2 登录状态检测脚本');
function probeChatSidebar(present) {
  const document = {
    body: { innerText: '' },
    querySelectorAll() { return []; },
    querySelector(selectors) {
      return present && selectors.split(',').some(selector => selector.trim() === '#pane-side') ? {} : null;
    },
  };
  return JSON.parse(vm.runInNewContext(loginProbe, { document })).chat === true;
}
assert.equal(probeChatSidebar(true), true, '工作台必须用当前 WhatsApp 会话栏识别已登录状态');
assert.equal(probeChatSidebar(false), false, '空白登录页不能被识别为已登录');
assert.doesNotMatch(legacy, /documentElement\.style\.zoom\s*=/, '生产工作台不得缩放 WhatsApp 根节点，否则 WebView 底部留下空白并裁切二维码');

assert.match(legacy, /SetWsStatusAsync\(accountId,\s*"已连接"\)[\s\S]{0,500}_wsQueue\.EnqueueAsync/, '收到授权页面采集后应先更新连接状态并持久化队列');
const wsMessageHandler = legacy.match(/private async void OnWsWebMessageReceived[\s\S]*?\n    }\n\n    private async Task FlushWsQueueAsync/)?.[0] || '';
assert.ok(wsMessageHandler, '必须保留 WS 页面异步采集消息接收器');
assert.doesNotMatch(wsMessageHandler, /ReferenceEquals\(sender,\s*_wsView\.CoreWebView2\)/, '同一 WebView2 原生页面的回调包装对象可能不同，不能用引用相等丢弃完整历史消息');
assert.match(wsMessageHandler, /IsAllowedWsPopupNavigation\(args\.Source\)/, '回调必须使用 HTTPS 官方 WhatsApp 域名白名单');
assert.match(wsMessageHandler, /OnWsWebMessageReceived\(string sessionAccountId, long sessionGeneration/, '异步完整历史消息必须携带池化会话账号与代次');
assert.match(wsMessageHandler, /App\.WsSessions\.IsCurrent\(sessionAccountId, sessionGeneration, sourceView\)/, '异步完整历史消息必须通过当前账号代次和来源视图栅栏');
assert.match(wsMessageHandler, /WsCollectorIngress\.TryAuthorize\(sourceSession, sessionGeneration, sourceView, claimedAccountId, collectorRole/,
  '页面声明账号和角色必须经过宿主实际来源视图鉴权');
assert.match(legacy, /_wsFlushGate/, 'WS 入库必须串行化，避免大批量扫描压死 SQLite sidecar');
assert.match(legacy, /CancelAfter\(TimeSpan\.FromSeconds\((?:10|15|20)\)\)/, 'WS 入库必须有短超时并可回退本机队列');
assert.match(legacy, /current\.length\s*>=\s*250/, '单个 WS 入库包必须限制记录数，避免同步 SQLite 长时间阻塞健康接口');
assert.match(legacy, /BuildWsCollectorScript\(session\.AccountId, purpose\)/, '独立扫码后的采集会话安装绑定可信用途的实际采集器');
assert.match(legacy, /session\.CollectorState != "running"/, '未运行或暂停的采集端不能接受采集命令');
assert.match(capability, /BackgroundCollection => true/);
assert.match(capability, /AutomaticHistory => true/);
assert.match(capability, /AutomaticAi => false/);
assert.match(capability, /ForegroundFallback => false/);
assert.match(capability, /ManualVisibleImport => true/);
assert.match(legacy, /if \(kind is "discover" or "collect-all-read"\)[\s\S]{0,750}ExecuteCollectorCommandAsync/,
  '发现和完整历史必须通过独立采集视图，不得退回前台');
assert.match(legacy, /if \(kind is not \("messages" or "selection"\)\)/,
  '保留一次性人工可见原文或选中文本导入，不将其冒充完整历史');
assert.match(legacy, /_ => BuildWsVisibleCaptureScript\(accountId\)/,
  '已有人工可见聊天导入路径保持可用');
assert.match(legacy, /RecoverLocalServiceAsync|EnsureLocalServiceAsync/, '工作台必须具备本机服务恢复路径');
assert.match(legacy, /_wsQueue\.EnqueueAsync\(/, '工作台必须先进入持久队列再写入数据库');

console.log('WS 运行时恢复与节流回归测试通过');
