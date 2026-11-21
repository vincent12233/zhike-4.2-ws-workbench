'use strict';
// V8.0 white-screen follow-up: the host must surface the real failure instead
// of a generic message, and diagnostics must report the actual chain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const service = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/LocalServiceManager.cs'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log('PASS ' + name); }
  catch (error) { results.push(false); console.log('FAIL ' + name + ' :: ' + error.message); }
}
const diagStart = host.indexOf('private async void ShowHostDiagnostics');
const diagEnd = host.indexOf('internal static string BuildWsBoundsObserverScript', diagStart);
const diag = host.slice(diagStart, diagEnd);

check('the sidecar keeps a bounded output tail and last failure', () => {
  assert.match(service, /private readonly StringBuilder _outputTail/);
  assert.match(service, /public string OutputTail/);
  assert.match(service, /public string\? LastFailure/);
  assert.match(service, /private void AppendTail\(string line\)/);
  assert.match(service, /_outputTail\.Length > 3072/);
  assert.match(service, /ErrorDataReceived \+=[\s\S]{0,160}AppendTail\(e\.Data\)/);
});
check('a failed start reports the sidecar stderr excerpt', () => {
  assert.match(service, /private string WithTail\(string message\)/);
  assert.match(service, /throw new InvalidOperationException\(WithTail\("本机数据服务启动后立即退出/);
  assert.match(service, /throw new TimeoutException\(WithTail\("本机数据服务启动超时/);
  assert.match(service, /LastFailure = error\.Message/);
});
check('both host load paths keep the real exception message', () => {
  assert.match(host, /RememberHostFailure\("打开知客页面", error\)/);
  assert.match(host, /知客页面加载失败：\{error\.GetBaseException\(\)\.Message\}/);
  assert.match(host, /RememberHostFailure\("启动工作台", error\)/);
  assert.match(host, /知客页面资源暂时不可用：\{error\.GetBaseException\(\)\.Message\}/);
});
check('diagnostics list version, paths, WebView2, service, health and last failure', () => {
  for (const label of ['应用版本：', 'EXE 路径：', '资源根目录：', 'WebView2 运行时：', 'WebView2 状态：', '本机服务：', '健康检查：', '数据目录：', '最近失败阶段：', '最近失败原因：', '本机服务最后输出：']) {
    assert.ok(diag.includes(label), label);
  }
  assert.match(host, /CoreWebView2Environment\.GetAvailableBrowserVersionString\(\)/);
});
check('diagnostics never print the api token', () => {
  assert.doesNotMatch(diag, /ApiToken/);
  assert.doesNotMatch(diag, /token/i);
});

const failed = results.filter(ok => !ok).length;
console.log(`Host diagnostics contract: ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
