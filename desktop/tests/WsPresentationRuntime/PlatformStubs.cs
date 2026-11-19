// These are value-only adapters for XAML and the session owner. The actual
// visibility, opacity, bounds and account decisions are extracted unchanged
// from LegacyUiHostPage.xaml.cs at each test invocation.
using System.Collections.ObjectModel;

enum Visibility { Visible, Collapsed }
sealed class XamlRoot { public double RasterizationScale { get; set; } = 1; }
class FrameworkElement
{
    public object? Parent { get; internal set; }
    public Visibility Visibility { get; set; } = Visibility.Visible;
    public bool IsHitTestVisible { get; set; }
    public double Opacity { get; set; } = 1;
    public double Width { get; set; } = double.NaN;
    public double Height { get; set; } = double.NaN;
    public double ActualWidth { get; set; }
    public double ActualHeight { get; set; }
    public XamlRoot? XamlRoot { get; set; } = new();
    internal int ZIndex { get; set; }
    internal double Left { get; set; }
    internal double Top { get; set; }
}
class Panel : FrameworkElement
{
    public ElementCollection Children { get; }
    public Panel() => Children = new(this);
}
sealed class ElementCollection(Panel owner) : Collection<FrameworkElement>
{
    protected override void InsertItem(int index, FrameworkElement item)
    {
        if (item.Parent is not null) throw new InvalidOperationException("Element already has a parent.");
        base.InsertItem(index, item); item.Parent = owner;
    }
    protected override void RemoveItem(int index) { this[index].Parent = null; base.RemoveItem(index); }
}
sealed class Grid : Panel { }
sealed class Border : FrameworkElement { }
sealed class Canvas : Panel
{
    public static void SetZIndex(FrameworkElement element, int value) => element.ZIndex = value;
    public static int GetZIndex(FrameworkElement element) => element.ZIndex;
    public static void SetLeft(FrameworkElement element, double value) => element.Left = value;
    public static void SetTop(FrameworkElement element, double value) => element.Top = value;
}
sealed class WebView2 : FrameworkElement
{
    public object? CoreWebView2 { get; set; } = new();
    public Uri? Source { get; set; } = new("about:blank");
}
sealed record Session(string AccountId, long Generation, WebView2 View, WebView2? CollectorView = null)
{
    public bool IsReady => View.CoreWebView2 is not null;
}
sealed class Runtime
{
    public string? ForegroundAccountId { get; private set; }
    public Runtime Snapshot() => this;
    public void SetForegroundAccount(string? account) => ForegroundAccountId = account;
}
sealed class SessionOwner
{
    public List<Session> Stored { get; } = [];
    public string ActiveAccountId { get; set; } = string.Empty;
    public Session? ActiveSession => Stored.FirstOrDefault(session => session.AccountId == ActiveAccountId);
    public IReadOnlyList<Session> Sessions() => Stored;
    public bool TryGetSession(string account, out Session? session)
    {
        session = Stored.FirstOrDefault(item => item.AccountId == account); return session is not null;
    }
    public void HideForeground() => App.WsRuntime.SetForegroundAccount(null);
}
sealed class MainWindow
{
    public bool RouteActive { get; private set; }
    public void NotifyWorkspaceRouteVisibility(object host, bool active) => RouteActive = active;
}
sealed class SendGuard
{
    public int Invalidations { get; private set; }
    public void Invalidate() => Invalidations++;
}
static class App
{
    public static SessionOwner WsService { get; private set; } = new();
    public static Runtime WsRuntime { get; private set; } = new();
    public static MainWindow? MainWindowInstance { get; private set; } = new();
    public static void Reset() { WsService = new(); WsRuntime = new(); MainWindowInstance = new(); }
}
