'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktop = path.join(__dirname, '../desktop/src/Zhike.Desktop');
const read = filename => fs.readFileSync(path.join(desktop, filename), 'utf8').replace(/\r\n/g, '\n');
const markup = read('MainWindow.xaml');
const source = read('MainWindow.xaml.cs');

function method(name) {
  const start = source.indexOf(name + '\n    {');
  assert.ok(start >= 0, 'Missing native sizing method ' + name);
  return source.slice(start, source.indexOf('\n    }', start) + 6);
}

test('the shared WinUI executable manifest opts into PerMonitorV2 before window creation', () => {
  const project = read('Zhike.Desktop.csproj');
  assert.match(project, /<ApplicationManifest>app\.manifest<\/ApplicationManifest>/);
  const manifest = read('app.manifest');
  const application = manifest.match(/<application xmlns="urn:schemas-microsoft-com:asm\.v3">([\s\S]*?)<\/application>/);
  assert.ok(application, 'Windows process DPI awareness belongs under the asm.v3 application element');
  assert.match(application[1], /<windowsSettings>\s*<dpiAwareness xmlns="http:\/\/schemas\.microsoft\.com\/SMI\/2016\/WindowsSettings">PerMonitorV2<\/dpiAwareness>\s*<\/windowsSettings>/);
});

test('native tracking minima translate the existing XAML client minima into outer window pixels', () => {
  const scope = markup.match(/x:Name="RootShell"\s+MinWidth="(\d+)"\s+MinHeight="(\d+)"/);
  assert.ok(scope);
  const [, width, height] = scope.map(Number);
  const sizing = method('MinimumWindowSize(AppWindow window)');
  assert.match(sizing, /scale = CurrentRasterizationScale\(\)/);
  assert.match(sizing, /outer = window\.Size/);
  assert.match(sizing, /client = window\.ClientSize/);
  assert.match(sizing, /frameWidth = client\.Width > 0 \? Math\.Max\(0, outer\.Width - client\.Width\) : 0/);
  assert.match(sizing, /frameHeight = client\.Height > 0 \? Math\.Max\(0, outer\.Height - client\.Height\) : 0/);
  assert.match(sizing, /Math\.Ceiling\(RootShell\.MinWidth \* scale\) \+ frameWidth/);
  assert.match(sizing, /Math\.Ceiling\(RootShell\.MinHeight \* scale\) \+ frameHeight/);
  const setTracking = method('ApplyMinimumWindowSize(AppWindow? window)');
  assert.match(setTracking, /if \(presenter\.PreferredMinimumWidth != minimum\.Width\) presenter\.PreferredMinimumWidth = minimum\.Width/);
  assert.match(setTracking, /if \(presenter\.PreferredMinimumHeight != minimum\.Height\) presenter\.PreferredMinimumHeight = minimum\.Height/);
  const examples = [
    [1, [820, 540]], [1.25, [1025, 675]], [1.5, [1230, 810]], [2, [1640, 1080]],
  ];
  for (const [scale, expected] of examples) assert.deepEqual([Math.ceil(width * scale), Math.ceil(height * scale)], expected);
  assert.ok(942 < Math.ceil(width * 1.25), 'Reported outer width was already smaller than the required client area');
});

test('initial native size, XAML DPI changes and presenter changes share the same calculation', () => {
  assert.match(method('SetBrandTitle()'), /ApplyMinimumWindowSize\(_appWindow\)/);
  assert.match(method('CurrentRasterizationScale()'), /RootShell\.XamlRoot is \{ RasterizationScale: > 0 \} root\) return root\.RasterizationScale/);
  assert.match(method('CurrentRasterizationScale()'), /GetDpiForWindow\(WindowNative\.GetWindowHandle\(this\)\)[\s\S]*dpi \/ 96d/);
  assert.match(source, /RootShell\.Loaded \+= OnShellLoaded/);
  assert.match(method('OnShellLoaded(object sender, RoutedEventArgs args)'), /root\.Changed \+= OnSizingRootChanged/);
  assert.match(source, /OnSizingRootChanged\(XamlRoot sender, XamlRootChangedEventArgs args\)\s*=> ApplyMinimumWindowSize\(_appWindow\)/);
  assert.match(method('OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)'), /if \(args\.DidPresenterChange\) ApplyMinimumWindowSize\(sender\)/);
  const close = method('OnClosed(object sender, WindowEventArgs args)');
  assert.match(close, /RootShell\.Loaded -= OnShellLoaded/);
  assert.match(close, /_sizingRoot\.Changed -= OnSizingRootChanged/);
});

test('saved physical bounds clamp to the same native minimum when the work area can accommodate it', () => {
  const restore = method('RestoreLayoutAsync()');
  assert.match(restore, /minimum = MinimumWindowSize\(_appWindow\)/);
  assert.match(restore, /if \(work\.Width < minimum\.Width \|\| work\.Height < minimum\.Height\) return/);
  assert.match(restore, /Math\.Clamp\(Math\.Round\(saved\.Width\), minimum\.Width, work\.Width\)/);
  assert.match(restore, /Math\.Clamp\(Math\.Round\(saved\.Height\), minimum\.Height, work\.Height\)/);
  assert.doesNotMatch(restore, /saved\.Width < 820|saved\.Height < 540/);
  assert.match(restore, /_appWindow\.MoveAndResize/);
});
