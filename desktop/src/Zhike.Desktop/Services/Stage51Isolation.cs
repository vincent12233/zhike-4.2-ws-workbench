#if STAGE51_ISOLATED_UI
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

// Compiled only into the opt-in acceptance executable; absent from production.
internal static class Stage51Isolation
{
    internal const string Marker = "zhike-stage51-isolated-ui-v1";
    private static readonly Lazy<string> ValidatedRoot = new(ValidateRoot);
    private static readonly object LogGate = new();
    private static readonly Dictionary<string, long> EventCounts = new(StringComparer.Ordinal);
    private static readonly HashSet<string> FailedInitializationAccounts = new(StringComparer.OrdinalIgnoreCase);
    private const int EventLimitPerKind = 256;
    internal static string Root => ValidatedRoot.Value;
    internal static string DataRoot => Path.Combine(Root, "data");

    private static string ValidateRoot()
    {
        var configured = Environment.GetEnvironmentVariable("ZHIKE_STAGE51_ROOT");
        if (string.IsNullOrWhiteSpace(configured) || !Path.IsPathFullyQualified(configured))
            throw new InvalidOperationException("An explicit isolated Stage 5.1 root is required.");
        var root = Path.GetFullPath(configured).TrimEnd(Path.DirectorySeparatorChar);
        var temporary = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var name = Path.GetFileName(root);
        const string prefix = "zhike-stage51-native-";
        if (!root.StartsWith(temporary, StringComparison.OrdinalIgnoreCase) || !name.StartsWith(prefix, StringComparison.Ordinal)
            || !Guid.TryParseExact(name[prefix.Length..], "N", out _))
            throw new InvalidOperationException("Isolated root must be a unique Stage 5.1 temporary directory.");
        if (!Directory.Exists(root) || File.ReadAllText(Path.Combine(root, ".stage51-isolated")) != Marker)
            throw new InvalidOperationException("Isolated root marker is missing.");
        for (var current = new DirectoryInfo(root); current is not null && current.FullName.Length >= temporary.Length; current = current.Parent)
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Reparse-point isolated roots are forbidden.");
        var sid = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("Current user SID unavailable.");
        var access = new DirectorySecurity();
        access.SetAccessRuleProtection(true, false);
        access.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(root).SetAccessControl(access);
        Directory.CreateDirectory(Path.Combine(root, "data"));
        return root;
    }

    internal static string MapDataPath(string path)
    {
        var original = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6"));
        var full = Path.GetFullPath(path);
        if (full.Equals(original, StringComparison.OrdinalIgnoreCase)) return DataRoot;
        if (full.StartsWith(original + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return Path.Combine(DataRoot, Path.GetRelativePath(original, full));
        if (full.Equals(Root, StringComparison.OrdinalIgnoreCase) || full.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return full;
        throw new InvalidOperationException("Acceptance executable rejected a non-isolated data path.");
    }

    internal static void Record(string kind, object? fields = null)
    {
        lock (LogGate)
        {
            var count = EventCounts.GetValueOrDefault(kind) + 1;
            EventCounts[kind] = count;
            if (count <= EventLimitPerKind)
                File.AppendAllText(Path.Combine(Root, "native-events.jsonl"),
                    JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, pid = Environment.ProcessId, kind, fields }) + Environment.NewLine, new UTF8Encoding(false));
            if (count % 32 == 0 || kind is "webview-created" or "sidecar-stopped" or "application-stopping" or "host-unloaded")
            {
                var counts = EventCounts.ToDictionary(item => item.Key, item => new { total = item.Value, emitted = Math.Min(item.Value, EventLimitPerKind), suppressed = Math.Max(0, item.Value - EventLimitPerKind) });
                var destination = Path.Combine(Root, $"native-event-counts-{Environment.ProcessId}.json");
                var temporary = destination + ".tmp";
                File.WriteAllText(temporary, JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, pid = Environment.ProcessId, limitPerKind = EventLimitPerKind, counts }), new UTF8Encoding(false));
                File.Move(temporary, destination, overwrite: true);
            }
        }
    }

    internal static void MaybeFailWsInitialization(string accountId, long generation)
    {
        // Explicit acceptance-only fault before Core creation. A later user
        // retry runs the real factory, environment and Core initialization.
        if (!string.Equals(Environment.GetEnvironmentVariable("ZHIKE_STAGE52_FAIL_WS_INIT_ONCE"), accountId, StringComparison.Ordinal)) return;
        lock (LogGate)
        {
            if (!FailedInitializationAccounts.Add(accountId)) return;
            Record("ws-initialization-injected-failure", new { accountId, generation, stage = "before-core" });
            throw new InvalidOperationException("隔离验收注入一次 WS 初始化失败；请重试。");
        }
    }

    internal static void PublishConnection(LocalServiceInfo info)
    {
        // Root ACL is current-user-only. This untracked file contains only the
        // ephemeral token of this isolated sidecar and must never enter reports.
        File.WriteAllText(Path.Combine(Root, "connection.private.json"), JsonSerializer.Serialize(new { root = Root, dataRoot = DataRoot, pid = Environment.ProcessId, endpoint = info.BaseAddress.ToString(), apiToken = info.ApiToken, isolated = true }), new UTF8Encoding(false));
        Record("sidecar-created", new { info.Port, workerEnabled = false, realWsEnabled = false, paidAiEnabled = false });
    }

    internal static string ShellScript => """
        (() => {
          const start = () => {
            document.documentElement.dataset.stage51Isolated = 'true';
            let activePage='';
            const observePage=()=>{
              const next=document.querySelector('.ws-workspace-nav-item[aria-current="page"]')?.dataset.wsWorkspaceView || '';
              if(next===activePage)return;
              if(activePage)chrome.webview.postMessage(JSON.stringify({type:'stage52.workspace',phase:'exit',page:activePage}));
              activePage=next;
              if(activePage)chrome.webview.postMessage(JSON.stringify({type:'stage52.workspace',phase:'enter',page:activePage}));
            };
            new MutationObserver(observePage).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current']});
            observePage();
            const renew = async () => {
              try {
                const current=window.__stage4AiLease;
                const payload=current ? {action:'renew',lease:current,leaseMs:120000} : {action:'acquire',scopeKey:'stage51-native-review',ownerId:'isolated-native-ui',leaseMs:120000};
                const response = await fetch('/api/ws/fencing', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
                if (response.ok) { const result=await response.json(); window.__stage4AiLease=result.lease; window.ZhikeAiReviewCenter?.render?.(); }
                else { window.__stage4AiLease=null; }
              } catch {}
            };
            void renew();
            window.__stage51LeaseTimer=setInterval(renew,20000);
          };
          addEventListener('DOMContentLoaded',start,{once:true});
        })();
        """;
}
#endif
