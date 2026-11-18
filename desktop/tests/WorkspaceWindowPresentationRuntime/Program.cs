using System.Runtime.InteropServices;
using System.Text.Json;
using Zhike.Desktop.Services;

if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Real HWND placement acceptance requires Windows.");
var title = $"Zhike isolated placement acceptance {Guid.NewGuid():N}";
var window = Native.CreateWindowExW(0x00000080 /* WS_EX_TOOLWINDOW */, "STATIC", title,
    0x00CF0000 /* WS_OVERLAPPEDWINDOW */, 137, 119, 913, 647, 0, 0, 0, 0);
var other = Native.CreateWindowExW(0x00000080, "STATIC", title + " mismatch guard", 0x00CF0000, 51, 57, 400, 300, 0, 0, 0, 0);
if (window == 0 || other == 0) throw new InvalidOperationException($"CreateWindowExW failed: {Marshal.GetLastWin32Error()}");
var results = new List<object>();
try
{
    foreach (var initial in new[] { "normal", "maximized", "minimized", "minimized-from-maximized" })
    {
        _ = Native.ShowWindow(window, 1);
        if (!Native.SetWindowPos(window, 0, 137, 119, 913, 647, 0x0014)) throw new InvalidOperationException("SetWindowPos failed.");
        if (initial is "maximized" or "minimized-from-maximized") _ = Native.ShowWindow(window, 3);
        if (initial is "minimized" or "minimized-from-maximized") _ = Native.ShowWindow(window, 2);
        var before = RequireSnapshot(window);
        var presentation = new WorkspaceWindowPresentationService();
        var enter = presentation.Enter(window);
        Require(enter.Changed && enter.Succeeded && RequireSnapshot(window).IsMaximized, $"{initial}: real HWND was not maximized.");
        Require(!presentation.Exit(other).Succeeded && presentation.IsActive, "Wrong HWND must not consume saved placement.");

        // A second route/bounds callback must neither replace the original
        // snapshot nor force a user's restore/minimize action back to max.
        _ = Native.ShowWindow(window, 1);
        var userRestored = RequireSnapshot(window);
        var duplicate = presentation.Enter(window);
        Require(!duplicate.Changed && RequireSnapshot(window) == userRestored, "Repeated enter changed user window state.");
        _ = Native.ShowWindow(window, 2);
        presentation.Enter(window);
        Require(RequireSnapshot(window).IsMinimized, "Repeated enter unminimized an active workspace.");

        var exit = presentation.Exit(window);
        var after = RequireSnapshot(window);
        Require(exit.Changed && exit.Succeeded && !presentation.IsActive, $"{initial}: placement restore failed.");
        Require(before.ShowCommand == after.ShowCommand && before.IsMaximized == after.IsMaximized
            && before.IsMinimized == after.IsMinimized, $"{initial}: entry state was not restored.");
        Require(before.X == after.X && before.Y == after.Y && before.Width == after.Width && before.Height == after.Height,
            $"{initial}: normal placement rectangle was not restored.");
        Require(!presentation.Exit(window).Changed, "Repeated exit changed the window.");
        results.Add(new { initial, before, enter, after, sameHwnd = window.ToInt64() });
    }
    var invalid = new WorkspaceWindowPresentationService();
    Require(!invalid.Enter(0).Succeeded && !invalid.IsActive, "Invalid HWND must not report success or retain a snapshot.");
    Console.WriteLine(JsonSerializer.Serialize(new { kind = "real-win32-placement-runtime", passed = true, cases = results }));
}
finally
{
    Native.DestroyWindow(window);
    Native.DestroyWindow(other);
}

static WindowPresentationSnapshot RequireSnapshot(nint window)
    => WorkspaceWindowPresentationService.Snapshot(window) ?? throw new InvalidOperationException("Actual window placement could not be read.");
static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

static class Native
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateWindowExW(uint extendedStyle, string className, string title, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindow(nint window, int command);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(nint window, nint insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyWindow(nint window);
}
