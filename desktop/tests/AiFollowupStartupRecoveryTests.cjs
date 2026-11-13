const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'src', 'Zhike.Desktop', 'Views', 'AiFollowupPage.xaml.cs');
const source = fs.readFileSync(pagePath, 'utf8');

assert.doesNotMatch(
  source,
  /readonly\s+ApiClient\?\s+_api\s*=\s*ApiClient\.TryCreateFromEnvironment\(\)/,
  'AI 跟进页不得在页面构造阶段永久缓存未就绪的 API 客户端'
);
assert.match(
  source,
  /await\s+App\.EnsureLocalServiceAsync\(\)/,
  'AI 跟进页加载时必须等待本机服务启动'
);
assert.match(
  source,
  /_api\s*=\s*App\.LocalService\?\.CreateApiClient\(\)/,
  '服务启动后必须重新创建 API 客户端'
);

console.log('AI 跟进页启动恢复回归测试通过');
