#if STAGE51_ISOLATED_UI
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.Foundation;

namespace Zhike.Desktop.Services;

internal static class Stage51InputDiagnostics
{
    internal static bool Enabled { get; } = Environment.GetEnvironmentVariable("ZHIKE_STAGE51_NATIVE_INPUT") == "1";
    internal static bool PreviewEnabled { get; } = Environment.GetEnvironmentVariable("ZHIKE_STAGE51_NATIVE_PREVIEW") == "1";

    internal static object? Bounds(FrameworkElement? element)
    {
        if (element?.XamlRoot is not { } root) return null;
        Point? origin = null;
        try { origin = element.TransformToVisual(null).TransformPoint(new Point(0, 0)); }
        catch (COMException) { /* A detached visual can lack a transform for this sample. */ }
        return new
        {
            xDip = origin?.X, yDip = origin?.Y, widthDip = element.ActualWidth, heightDip = element.ActualHeight,
            visible = element.Visibility == Visibility.Visible, hitTestVisible = element.IsHitTestVisible,
            rasterizationScale = element.RasterizationScale, xamlRootScale = root.RasterizationScale,
        };
    }

    internal static object NativeInput(nint hwnd, XamlRoot? root)
    {
        var cursorKnown = GetPhysicalCursorPos(out var cursor) != 0;
        var hit = cursorKnown ? WindowFromPoint(cursor) : 0;
        var overWindow = hit != 0 && (hit == hwnd || IsChild(hwnd, hit) != 0);
        var client = cursor;
        var mapped = overWindow && ScreenToClient(hwnd, ref client) != 0;
        var focus = GetFocus();
        return new
        {
            foreground = GetForegroundWindow() == hwnd,
            hwndFocus = focus == 0 ? "unavailable" : focus == hwnd ? "window" : IsChild(hwnd, focus) != 0 ? "child" : "other",
            xamlFocus = root is null ? null : FocusManager.GetFocusedElement(root)?.GetType().Name,
            windowHit = !cursorKnown ? "unavailable" : hit == hwnd ? "window" : overWindow ? "child" : "outside",
            screenXpx = cursorKnown ? (int?)cursor.X : null,
            screenYpx = cursorKnown ? (int?)cursor.Y : null,
            clientXpx = mapped ? (int?)client.X : null,
            clientYpx = mapped ? (int?)client.Y : null,
        };
    }

    internal static object MessageContext()
    {
        // WinUI can deliver a routed callback outside the original message
        // dispatch. These values describe the thread's message context.
        var timeMs = unchecked((uint)GetMessageTime());
        var position = GetMessagePos();
        var sourceAvailable = GetCurrentInputMessageSource(out var source) != 0;
        return new
        {
            lastMessageTimeMs = timeMs,
            lastMessageScreenXpx = unchecked((short)(position & 0xffff)),
            lastMessageScreenYpx = unchecked((short)(position >> 16)),
            dispatchDevice = sourceAvailable ? source.DeviceType.ToString() : null,
            dispatchOrigin = sourceAvailable ? source.OriginId.ToString() : null,
        };
    }

    internal static long MonitorIdentity(nint hwnd) => MonitorFromWindow(hwnd, 0).ToInt64();

    [DllImport("user32.dll")]
    internal static extern uint GetDpiForSystem();

    internal static string GetDpiAwareness(nint hwnd)
    {
        var context = GetWindowDpiAwarenessContext(hwnd);
        if (AreDpiAwarenessContextsEqual(context, -4) != 0) return "per-monitor-v2";
        return GetAwarenessFromDpiAwarenessContext(context) switch
        {
            0 => "unaware",
            1 => "system",
            2 => "per-monitor",
            _ => "unavailable",
        };
    }

    // Persist a reconstructed sample of controlled fields. Never write the
    // original WebMessage, arbitrary DOM attributes, text, URLs or key values.
    internal static object? ReadDomSample(JsonElement root, string expectedPhase)
    {
        if (!root.TryGetProperty("phase", out var phase) || phase.ValueKind != JsonValueKind.String
            || phase.GetString() != expectedPhase) return null;
        if (!root.TryGetProperty("geometry", out var geometry) || geometry.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("state", out var state) || state.ValueKind != JsonValueKind.Object) return null;

        return new
        {
            phase = expectedPhase,
            eventMs = Number(root, "eventMs"), wheelCount = Number(root, "wheelCount"),
            frameCount = Number(root, "frameCount", 128),
            domTimeOriginMs = Number(root, "timeOriginMs", 4_000_000_000_000),
            sampleMs = Number(root, "sampleMs"),
            theme = Token(geometry, "theme", "dark", "light"),
            palette = Token(geometry, "palette", "atelier-dawn", "horizon-night"),
            view = Token(geometry, "view", "home", "customers", "ws-workbench", "settings"),
            modalOpen = Boolean(geometry, "modalOpen"),
            drawerOpen = Boolean(geometry, "drawerOpen"),
            domFocus = Token(state, "focus", RegionNames),
            domFocused = Boolean(state, "focused"),
            geometry = new
            {
                dpr = Number(geometry, "dpr"), widthCss = Number(geometry, "width"), heightCss = Number(geometry, "height"),
                visualWidthCss = Number(geometry, "visualWidth"), visualHeightCss = Number(geometry, "visualHeight"),
                visualScale = Number(geometry, "visualScale"),
                visualLeftCss = Number(geometry, "visualLeft"), visualTopCss = Number(geometry, "visualTop"),
                tableRectCss = Numbers(geometry, "table", 4), footerRectCss = Numbers(geometry, "footer", 4),
                dialogRectCss = Numbers(geometry, "dialog", 4),
            },
            wheel = expectedPhase.StartsWith("wheel", StringComparison.Ordinal) ? new
            {
                target = Token(state, "target", RegionNames), hit = Token(state, "hit", RegionNames),
                pointer = Numbers(state, "pointer", 4), wheelPoint = Numbers(state, "wheelPoint", 4),
                pointerAgeMs = Number(state, "pointerAgeMs"),
                deltaX = Number(state, "deltaX"), deltaY = Number(state, "deltaY"), deltaMode = Number(state, "deltaMode"),
                ctrl = Boolean(state, "ctrl"), shift = Boolean(state, "shift"), meta = Boolean(state, "meta"),
                modal = Boolean(state, "modal"), cancelable = Boolean(state, "cancelable"),
                trusted = Boolean(state, "trusted"),
                preventedBefore = Boolean(state, "preventedBefore"), preventedAfter = Boolean(state, "preventedAfter"),
                firstWheelCount = Number(state, "firstWheelCount"), quietMs = Number(state, "quietMs"),
                offsetsStable = Boolean(state, "offsetsStable"),
                candidates = ReadCandidates(state), overlap = Boolean(state, "overlap"),
            } : null,
        };
    }

    private static readonly string[] RegionNames =
        ["other", "sidebar", "page", "ws-navigation", "ws-content", "table", "dialog", "drawer", "pre", "editor", "scrollable", "document"];

    private static object[] ReadCandidates(JsonElement state)
    {
        if (!state.TryGetProperty("candidates", out var candidates) || candidates.ValueKind != JsonValueKind.Array
            || candidates.GetArrayLength() > 10) return [];
        return candidates.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.Object).Select(item => (object)new
        {
            region = Token(item, "region", RegionNames),
            before = Numbers(item, "before", 6),
            afterDispatch = Numbers(item, "afterDispatch", 6),
            afterFrames = Numbers(item, "afterFrames", 6),
            afterQuiet = Numbers(item, "afterQuiet", 6),
        }).ToArray();
    }

    private static string? Token(JsonElement root, string key, params string[] allowed)
        => root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? allowed.FirstOrDefault(option => option == value.GetString()) : null;

    private static bool? Boolean(JsonElement root, string key)
        => root.TryGetProperty(key, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean() : null;

    private static double? Number(JsonElement root, string key, double limit = 1_000_000_000)
        => root.TryGetProperty(key, out var value) ? Number(value, limit) : null;

    private static double? Number(JsonElement value, double limit)
        => value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)
            && double.IsFinite(number) && Math.Abs(number) <= limit ? number : null;

    private static double?[]? Numbers(JsonElement root, string key, int length)
        => root.TryGetProperty(key, out var values) && values.ValueKind == JsonValueKind.Array
            && values.GetArrayLength() == length ? values.EnumerateArray().Select(value => Number(value, 1_000_000_000)).ToArray() : null;

    [StructLayout(LayoutKind.Sequential)]
    private struct PointPx
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct InputMessageSource
    {
        public InputMessageDevice DeviceType;
        public InputMessageOrigin OriginId;
    }

    private enum InputMessageDevice : uint
    {
        Unavailable = 0, Keyboard = 1, Mouse = 2, Touch = 4, Pen = 8, Touchpad = 16,
    }

    private enum InputMessageOrigin : uint
    {
        Unavailable = 0, Hardware = 1, Injected = 2, System = 4,
    }

    [DllImport("user32.dll")]
    private static extern int GetPhysicalCursorPos(out PointPx point);

    [DllImport("user32.dll")]
    private static extern int GetMessageTime();

    [DllImport("user32.dll")]
    private static extern uint GetMessagePos();

    [DllImport("user32.dll")]
    private static extern int GetCurrentInputMessageSource(out InputMessageSource source);

    [DllImport("user32.dll")]
    private static extern nint WindowFromPoint(PointPx point);

    [DllImport("user32.dll")]
    private static extern int IsChild(nint parent, nint child);

    [DllImport("user32.dll")]
    private static extern int ScreenToClient(nint window, ref PointPx point);

    [DllImport("user32.dll")]
    private static extern nint GetFocus();

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern nint MonitorFromWindow(nint window, uint flags);

    [DllImport("user32.dll")]
    private static extern nint GetWindowDpiAwarenessContext(nint window);

    [DllImport("user32.dll")]
    private static extern int AreDpiAwarenessContextsEqual(nint first, nint second);

    [DllImport("user32.dll")]
    private static extern int GetAwarenessFromDpiAwarenessContext(nint context);
}
#endif
