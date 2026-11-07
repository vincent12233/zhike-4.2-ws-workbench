using System.Diagnostics;

var node = Environment.GetEnvironmentVariable("ZHike_NODE") ?? "node";
var script = Path.Combine(AppContext.BaseDirectory, "migrate.cjs");
if (!File.Exists(script)) throw new FileNotFoundException("缺少迁移脚本", script);

var startInfo = new ProcessStartInfo { FileName = node, UseShellExecute = false };
startInfo.ArgumentList.Add(script);
foreach (var argument in args) startInfo.ArgumentList.Add(argument);
using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动 Node 迁移脚本");
await process.WaitForExitAsync();
return process.ExitCode;
