using System.Runtime.InteropServices;

namespace Zhike.Desktop.Services;

// Owns only the presentation of the existing HWND. It has no WebView, account,
// navigation, or runtime dependencies, and never creates a replacement window.
internal sealed class WorkspaceWindowPresentationService
{
    private nint _window;
    private WindowPlacement? _restorePlacement;

    internal bool IsActive => _restorePlacement.HasValue;

    internal WindowPresentationResult Enter(nint window)
    {
        if (IsActive)
            return new(false, _window == window, Snapshot(window), "already-active");
        if (!TryReadPlacement(window, out var placement))
            return new(false, false, null, "capture-failed");

        _window = window;
        _restorePlacement = placement;
        // ShowWindow's return value describes the previous visibility, not
        // whether maximization succeeded. Inspect the actual HWND instead.
        _ = ShowWindow(window, 3 /* SW_SHOWMAXIMIZED */);
        var observed = Snapshot(window);
        return new(true, observed?.IsMaximized == true, observed, "enter");
    }

    internal WindowPresentationResult Exit(nint window)
    {
        if (_restorePlacement is not { } placement)
            return new(false, true, Snapshot(window), "already-inactive");
        if (_window != window || !IsWindow(window))
            return new(false, false, Snapshot(window), "window-mismatch");

        // Preserve showCmd, flags (including restore-to-maximized), and the
        // normal rectangle in Windows' own placement coordinate system. This
        // restores normal, maximized and minimized entry states accurately.
        if (!SetWindowPlacement(window, ref placement))
            return new(false, false, Snapshot(window), "restore-failed");
        _restorePlacement = null;
        _window = 0;
        return new(true, true, Snapshot(window), "exit");
    }

    internal static WindowPresentationSnapshot? Snapshot(nint window)
        => TryReadPlacement(window, out var placement)
            ? new(placement.ShowCommand, placement.Flags,
                placement.NormalPosition.Left, placement.NormalPosition.Top,
                placement.NormalPosition.Right - placement.NormalPosition.Left,
                placement.NormalPosition.Bottom - placement.NormalPosition.Top,
                IsZoomed(window), IsIconic(window))
            : null;

    private static bool TryReadPlacement(nint window, out WindowPlacement placement)
    {
        placement = new() { Length = (uint)Marshal.SizeOf<WindowPlacement>() };
        return window != 0 && IsWindow(window) && GetWindowPlacement(window, ref placement);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { internal int X; internal int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { internal int Left; internal int Top; internal int Right; internal int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowPlacement
    {
        internal uint Length;
        internal uint Flags;
        internal uint ShowCommand;
        internal Point MinPosition;
        internal Point MaxPosition;
        internal Rect NormalPosition;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowPlacement(nint window, ref WindowPlacement placement);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPlacement(nint window, ref WindowPlacement placement);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(nint window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsZoomed(nint window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(nint window);
}

internal sealed record WindowPresentationSnapshot(
    uint ShowCommand, uint Flags, int X, int Y, int Width, int Height, bool IsMaximized, bool IsMinimized);

internal sealed record WindowPresentationResult(
    bool Changed, bool Succeeded, WindowPresentationSnapshot? Observed, string Phase);
