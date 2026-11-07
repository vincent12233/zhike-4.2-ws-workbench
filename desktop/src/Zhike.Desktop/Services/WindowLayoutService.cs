namespace Zhike.Desktop.Services;

public sealed record LayoutState(double Width, double Height, double LeftPaneWidth, double RightPaneWidth, double ContentWidth, bool LeftCollapsed, bool RightCollapsed, double DpiScale);

public sealed class WindowLayoutService
{
    public LayoutState ApplyLayout(double width, double height, double dpiScale, bool leftCollapsed, bool rightCollapsed)
    {
        var scale = dpiScale is > 0 and < 4 ? dpiScale : 1;
        var logicalWidth = Math.Max(820, width / scale);
        var logicalHeight = Math.Max(540, height / scale);
        var left = leftCollapsed ? 0 : Math.Clamp(logicalWidth * 0.18, 170, 260);
        var right = rightCollapsed ? 0 : Math.Clamp(logicalWidth * 0.24, 260, 360);
        var content = Math.Max(360, logicalWidth - left - right - 24);
        return new LayoutState(logicalWidth, logicalHeight, left, right, content, leftCollapsed, rightCollapsed, scale);
    }
}
