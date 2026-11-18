using System.Text.Json;
using System.Security.Principal;
using System.Security.AccessControl;
using Zhike.Desktop.Services;

var root = Path.Combine(Path.GetTempPath(), "zhike-stage51-native-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
File.WriteAllText(Path.Combine(root, ".stage51-isolated"), Stage51Isolation.Marker);
Environment.SetEnvironmentVariable("ZHIKE_STAGE51_ROOT", root);
try
{
    var production = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6");
    var paths = new[] { "", "ws-profiles", "queue", "window", "ws-accounts", "diagnostics" };
    foreach (var relative in paths)
    {
        var mapped = Stage51Isolation.MapDataPath(Path.Combine(production, relative));
        if (mapped != Path.Combine(root, "data", relative)) throw new Exception("Native path isolation mismatch.");
    }
    var escapedRejected = false;
    try { Stage51Isolation.MapDataPath(Path.GetTempPath()); } catch (InvalidOperationException) { escapedRejected = true; }
    if (!escapedRejected) throw new Exception("Unsafe path accepted.");
    var outside = Path.Combine(Path.GetTempPath(), "zhike-stage51-outside-" + Guid.NewGuid().ToString("N"));
    var unsafeConstructorRejected = false;
    try { _ = new LocalServiceManager(Path.GetTempPath(), outside); } catch (InvalidOperationException) { unsafeConstructorRejected = true; }
    if (!unsafeConstructorRejected || Directory.Exists(outside)) throw new Exception("Unsafe constructor performed outside-path side effects.");
    Stage51Isolation.PublishConnection(new LocalServiceInfo(new Uri("http://127.0.0.1:12345/"), "synthetic-test-token", 12345));
    var acl = new DirectoryInfo(root).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier));
    var sid = WindowsIdentity.GetCurrent().User!;
    if (acl.Cast<FileSystemAccessRule>().Any(rule => rule.AccessControlType == AccessControlType.Allow && rule.IdentityReference != sid)) throw new Exception("Unexpected allowed identity on temporary root.");
    for (var count = 0; count < 1024; count++) Stage51Isolation.Record("bounded-test", new { sequence = count });
    Stage51Isolation.Record("sidecar-stopped", new { running = false });
    using var counters = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, $"native-event-counts-{Environment.ProcessId}.json")));
    var counter = counters.RootElement.GetProperty("counts").GetProperty("bounded-test");
    if (counter.GetProperty("total").GetInt32() != 1024 || counter.GetProperty("emitted").GetInt32() != 256 || counter.GetProperty("suppressed").GetInt32() != 768) throw new Exception("Bounded trace lost event totals.");
    if (File.ReadLines(Path.Combine(root, "native-events.jsonl")).Count(line => line.Contains("\"kind\":\"bounded-test\"")) != 256) throw new Exception("Trace exceeded per-kind budget.");
    Stage51Isolation.Record("shutdown-tail");
    Stage51Isolation.Record("application-stopping");
    Stage51Isolation.Record("host-unloaded");
    using var finalCounters = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, $"native-event-counts-{Environment.ProcessId}.json")));
    foreach (var kind in new[] { "shutdown-tail", "application-stopping", "host-unloaded" })
        if (finalCounters.RootElement.GetProperty("counts").GetProperty(kind).GetProperty("total").GetInt32() != 1) throw new Exception("Shutdown trace did not flush its final counters.");
    Console.WriteLine(JsonSerializer.Serialize(new { ok = true, mappedPaths = paths.Length, escapedRejected, unsafeConstructorRejected, boundedDiagnostics = true, acl = "current-user-only", productionOpened = false }));
}
finally { Directory.Delete(root, recursive: true); }

namespace Zhike.Desktop { public static class App { public static LocalServiceManager? LocalService => null; } }
