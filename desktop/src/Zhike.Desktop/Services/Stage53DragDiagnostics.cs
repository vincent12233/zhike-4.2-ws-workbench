#if STAGE51_ISOLATED_UI
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Win32.SafeHandles;

namespace Zhike.Desktop.Services;

// Acceptance-only observations of the SDK's existing drag route. This service
// never creates a drag manager, forwards input or changes a drop operation.
internal static class Stage53DragDiagnostics
{
    internal static IDisposable Attach(WebView2 webView, UIElement root)
    {
        ArgumentNullException.ThrowIfNull(webView);
        ArgumentNullException.ThrowIfNull(root);
        if (!webView.DispatcherQueue.HasThreadAccess)
            throw new InvalidOperationException("Drag diagnostics must attach on the WinUI thread.");
        if (webView.CoreWebView2 is null)
            throw new InvalidOperationException("Drag diagnostics require an initialized WebView2.");

        var subscription = new Subscription(webView, root);
        try
        {
            subscription.Attach();
            return subscription;
        }
        catch
        {
            subscription.Dispose();
            throw;
        }
    }

    private sealed class Subscription(WebView2 webView, UIElement root) : IDisposable
    {
        private const int SamplesPerTargetAndKind = 8;
        private readonly List<Registration> _registrations = [];
        private readonly Dictionary<string, long> _counts = new(StringComparer.Ordinal);
        private bool _disposed;
        private int _observationErrors;
        private int _logErrors;

        internal void Attach()
        {
            var core = webView.CoreWebView2 ?? throw new InvalidOperationException("Drag diagnostics require an initialized WebView2.");
            Add(webView, "webview", UIElement.DragEnterEvent, "dragenter");
            Add(webView, "webview", UIElement.DragOverEvent, "dragover");
            Add(webView, "webview", UIElement.DropEvent, "drop");
            if (!ReferenceEquals(webView, root))
            {
                Add(root, "root", UIElement.DragEnterEvent, "dragenter");
                Add(root, "root", UIElement.DragOverEvent, "dragover");
                Add(root, "root", UIElement.DropEvent, "drop");
            }
            webView.Unloaded += OnWebViewUnloaded;
            Record("stage53-drag-attached", new
            {
                webview = Describe(webView),
                root = Describe(root),
                runtimeVersion = core.Environment.BrowserVersionString,
                process = ReadProcessTokenMetadata(),
                samplesPerTargetAndKind = SamplesPerTargetAndKind,
                observesHandledEvents = true,
                mutatesDragState = false,
            });
            Summary("attached");
        }

        private void Add(UIElement target, string targetName, RoutedEvent routedEvent, string kind)
        {
            DragEventHandler handler = (_, args) => Observe(targetName, kind, args);
            target.AddHandler(routedEvent, handler, handledEventsToo: true);
            _registrations.Add(new Registration(target, routedEvent, handler));
            _counts[targetName + "." + kind] = 0;
        }

        private void Observe(string targetName, string kind, DragEventArgs args)
        {
            if (_disposed) return;
            var key = targetName + "." + kind;
            var count = _counts[key] + 1;
            _counts[key] = count;
            // No DataView, text, clipboard, identity or drag payload is read.
            // Samples and intermediate summaries are bounded; counters are not.
            if (count <= SamplesPerTargetAndKind)
            {
                try
                {
                    var position = args.GetPosition(root);
                    Record("stage53-drag-sample", new
                    {
                        target = targetName,
                        kind,
                        count,
                        tick = Environment.TickCount64,
                        originalSourceType = args.OriginalSource?.GetType().Name,
                        handled = args.Handled,
                        allowedOperations = args.AllowedOperations.ToString(),
                        acceptedOperation = args.AcceptedOperation.ToString(),
                        x = position.X,
                        y = position.Y,
                        webview = Describe(webView),
                    });
                }
                catch (Exception error)
                {
                    _observationErrors++;
                    Record("stage53-drag-observation-error", new { target = targetName, kind, count, hresult = error.HResult });
                }
            }
            if (count is 16 or 64 or 256 or 1024) Summary("bounded-count");
        }

        private static object Describe(UIElement element) => new
        {
            type = element.GetType().Name,
            allowDrop = element.AllowDrop,
            hitTestVisible = element.IsHitTestVisible,
            visibility = element.Visibility.ToString(),
            opacity = element.Opacity,
            width = (element as FrameworkElement)?.ActualWidth,
            height = (element as FrameworkElement)?.ActualHeight,
        };

        private void Record(string kind, object fields)
        {
            try { Stage51Isolation.Record(kind, fields); }
            catch (Exception error)
            {
                // A failed diagnostic write is not a successful sample and
                // must not take down the native application being observed.
                _logErrors++;
                Debug.WriteLine($"Stage53 drag diagnostic log failed: 0x{error.HResult:X8}.");
            }
        }

        private void Summary(string reason) => Record("stage53-drag-summary", new
        {
            reason,
            counts = _counts.ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal),
            observationErrors = _observationErrors,
            logErrors = _logErrors,
        });

        private void OnWebViewUnloaded(object sender, RoutedEventArgs args) => DisposeCore("webview-unloaded");

        public void Dispose() => DisposeCore("explicit-dispose");

        private void DisposeCore(string reason)
        {
            if (_disposed) return;
            if (!webView.DispatcherQueue.HasThreadAccess)
                throw new InvalidOperationException("Drag diagnostics must detach on the WinUI thread.");
            _disposed = true;
            webView.Unloaded -= OnWebViewUnloaded;
            foreach (var registration in _registrations)
                registration.Target.RemoveHandler(registration.Event, registration.Handler);
            _registrations.Clear();
            Summary(reason);
        }

        private sealed record Registration(UIElement Target, RoutedEvent Event, DragEventHandler Handler);
    }

    // Query metadata of this process's existing token only. No credentials,
    // SID strings, privileges or token contents are emitted or modified.
    private static TokenMetadata ReadProcessTokenMetadata()
    {
        if (!NativeMethods.OpenProcessToken(NativeMethods.GetCurrentProcess(), NativeMethods.TokenQuery, out var token))
            return new("unavailable", null, null, null, Marshal.GetLastWin32Error());
        using (token)
        {
            if (!NativeMethods.GetTokenInformation(token, NativeMethods.TokenElevationClass, out TokenElevationData elevation,
                    (uint)Marshal.SizeOf<TokenElevationData>(), out _))
                return new("unavailable", null, null, null, Marshal.GetLastWin32Error());

            _ = NativeMethods.GetTokenInformation(token, NativeMethods.TokenIntegrityLevel, IntPtr.Zero, 0, out var bytes);
            var sizeError = Marshal.GetLastWin32Error();
            if (bytes == 0 || bytes > 65536 || sizeError != NativeMethods.ErrorInsufficientBuffer)
                return new("partial", elevation.IsElevated != 0, null, null, sizeError);
            var buffer = Marshal.AllocHGlobal(checked((int)bytes));
            try
            {
                if (!NativeMethods.GetTokenInformation(token, NativeMethods.TokenIntegrityLevel, buffer, bytes, out _))
                    return new("partial", elevation.IsElevated != 0, null, null, Marshal.GetLastWin32Error());
                var sid = Marshal.ReadIntPtr(buffer);
                if (sid == IntPtr.Zero || !NativeMethods.IsValidSid(sid))
                    return new("partial", elevation.IsElevated != 0, null, null, NativeMethods.ErrorInvalidSid);
                var countAddress = NativeMethods.GetSidSubAuthorityCount(sid);
                if (countAddress == IntPtr.Zero || Marshal.ReadByte(countAddress) == 0)
                    return new("partial", elevation.IsElevated != 0, null, null, NativeMethods.ErrorInvalidSid);
                var ridAddress = NativeMethods.GetSidSubAuthority(sid, (uint)(Marshal.ReadByte(countAddress) - 1));
                if (ridAddress == IntPtr.Zero)
                    return new("partial", elevation.IsElevated != 0, null, null, NativeMethods.ErrorInvalidSid);
                var rid = unchecked((uint)Marshal.ReadInt32(ridAddress));
                var level = rid switch
                {
                    < 0x1000 => "untrusted",
                    < 0x2000 => "low",
                    < 0x2100 => "medium",
                    < 0x3000 => "medium-plus",
                    < 0x4000 => "high",
                    < 0x5000 => "system",
                    _ => "protected-or-higher",
                };
                return new("available", elevation.IsElevated != 0, level, rid, null);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    private sealed record TokenMetadata(string Status, bool? IsElevated, string? IntegrityLevel, uint? IntegrityRid, int? ErrorCode);

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenElevationData { public uint IsElevated; }

    private static class NativeMethods
    {
        internal const uint TokenQuery = 0x0008;
        internal const int TokenElevationClass = 20;
        internal const int TokenIntegrityLevel = 25;
        internal const int ErrorInsufficientBuffer = 122;
        internal const int ErrorInvalidSid = 1337;

        [DllImport("kernel32.dll", ExactSpelling = true)]
        internal static extern IntPtr GetCurrentProcess();

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out SafeAccessTokenHandle token);

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetTokenInformation(SafeAccessTokenHandle token, int informationClass,
            out TokenElevationData information, uint informationLength, out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true, ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetTokenInformation(SafeAccessTokenHandle token, int informationClass,
            IntPtr information, uint informationLength, out uint returnLength);

        [DllImport("advapi32.dll", ExactSpelling = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsValidSid(IntPtr sid);

        [DllImport("advapi32.dll", ExactSpelling = true)]
        internal static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

        [DllImport("advapi32.dll", ExactSpelling = true)]
        internal static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);
    }
}
#endif
