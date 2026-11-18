using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record LayoutState(
    double Width,
    double Height,
    double LeftPaneWidth,
    double RightPaneWidth,
    double ContentWidth,
    bool LeftCollapsed,
    bool RightCollapsed,
    double DpiScale,
    int X = 0,
    int Y = 0,
    bool IsMaximized = false);
public sealed record ResponsiveLayout(double Width, double Height, double LeftPaneWidth, double CenterWidth, double RightPaneWidth, bool LeftCollapsed, bool RightCollapsed, bool UseMobileTabs, double DpiScale);

public sealed class WindowLayoutService
{
    private readonly string _statePath;

    public WindowLayoutService(string scope = "shared", string? root = null)
    {
        var basePath = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "window");
#if STAGE51_ISOLATED_UI
        basePath = Stage51Isolation.MapDataPath(basePath);
#endif
        Directory.CreateDirectory(basePath);
        var safeScope = new string((scope ?? "shared").Where(character => char.IsLetterOrDigit(character) || character is '-' or '_').ToArray());
        _statePath = Path.Combine(basePath, $"layout-{(safeScope.Length == 0 ? "shared" : safeScope)}.json");
    }

    public LayoutState ApplyLayout(double width, double height, double dpiScale, bool leftCollapsed, bool rightCollapsed)
    {
        var scale = dpiScale is > 0 and < 4 ? dpiScale : 1;
        // XAML ActualWidth/ActualHeight are already device-independent pixels.
        // Dividing them by the rasterization scale makes 125%-200% displays
        // enter compact layouts too early and clips otherwise reachable UI.
        var logicalWidth = Math.Max(0d, width);
        var logicalHeight = Math.Max(0d, height);
        var left = leftCollapsed ? 0 : Math.Clamp(logicalWidth * 0.18, 170, 260);
        var right = rightCollapsed ? 0 : Math.Clamp(logicalWidth * 0.24, 260, 360);
        var content = Math.Max(0d, logicalWidth - left - right - 24);
        return new LayoutState(logicalWidth, logicalHeight, left, right, content, leftCollapsed, rightCollapsed, scale);
    }

    public ResponsiveLayout CalculateLayout(double width, double height, double dpiScale, bool leftCollapsed, bool rightCollapsed)
    {
        var scale = dpiScale is > 0 and < 4 ? dpiScale : 1;
        var logicalWidth = Math.Max(0d, width);
        var logicalHeight = Math.Max(0d, height);
        var mobile = logicalWidth <= 900;
        var narrow = logicalWidth <= 1200;
        var left = leftCollapsed ? 52 : (narrow ? 190 : 224);
        var right = rightCollapsed ? 52 : (narrow ? 300 : 340);
        if (mobile && !rightCollapsed) right = 52;
        var center = Math.Max(0d, logicalWidth - left - right - 24);
        return new ResponsiveLayout(logicalWidth, logicalHeight, left, center, right, leftCollapsed, rightCollapsed || mobile, mobile, scale);
    }

    public LayoutState WithWindowBounds(LayoutState state, int x, int y, int width, int height, bool isMaximized)
        => state with { X = x, Y = y, Width = Math.Max(0, width), Height = Math.Max(0, height), IsMaximized = isMaximized };

    public async Task SaveAsync(LayoutState state, CancellationToken cancellationToken = default)
    {
        var temporary = $"{_statePath}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(state), cancellationToken);
        File.Move(temporary, _statePath, true);
    }

    public async Task<LayoutState?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_statePath)) return null;
        await using var stream = File.OpenRead(_statePath);
        return await JsonSerializer.DeserializeAsync<LayoutState>(stream, cancellationToken: cancellationToken);
    }
}
