using System.Text.Json;

var cases = new List<object>();
void Check(string name, Action action)
{
    App.Reset();
    try { action(); cases.Add(new { name, passed = true }); }
    catch (Exception error) { cases.Add(new { name, passed = false, error = error.Message }); }
}
void Assert(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
JsonElement Envelope(string account = "a", long sequence = 1, string page = "chat", bool active = true,
    bool hidden = false, double width = 960, double height = 640) => JsonSerializer.SerializeToElement(new
{
    route = "ws-workbench", routeActive = active, routeVisible = active && page == "chat" && !hidden,
    workspacePage = page, accountId = account, documentId = "test-shell-document", sequence,
    bounds = new { hidden, x = 120, y = 80, width, height, viewportWidth = 1440, viewportHeight = 900 },
});
Session AddSession(string account = "a", bool selected = true)
{
    var session = new Session(account, App.WsService.Stored.Count + 1,
        new WebView2 { Opacity = 0.01, IsHitTestVisible = false }, new WebView2());
    App.WsService.Stored.Add(session);
    if (selected) { App.WsService.ActiveAccountId = account; App.WsRuntime.SetForegroundAccount(account); }
    return session;
}
void AssertShown(PresentationHost host, Session session)
{
    Assert(host.Layer.Opacity == 1, "Visible overlay must be fully opaque.");
    Assert(host.Layer.Visibility == Visibility.Visible && host.Layer.IsHitTestVisible, "Visible overlay must receive input.");
    Assert(Canvas.GetZIndex(host.Layer) == 20, "Visible overlay must be above the shell.");
    Assert(session.View.Opacity == 1 && session.View.IsHitTestVisible, "Selected foreground view must be opaque and clickable.");
    Assert(ReferenceEquals(session.View.Parent, host.OverlayHost), "Foreground view must stay in overlay host.");
    Assert(host.Geometry.Width == 960 && host.Geometry.Height == 640, "DOM bounds must be applied to the overlay.");
}
void AssertHidden(PresentationHost host)
{
    Assert(host.Layer.Opacity == 0, "Hidden retained overlay must have zero opacity, not a faint live page.");
    Assert(!host.Layer.IsHitTestVisible, "Hidden retained overlay must not receive input.");
}

Check("Core opens before the first trusted chat bounds: hidden until the complete envelope arrives", () =>
{
    var host = new PresentationHost(); var a = AddSession();
    host.Sync(); AssertHidden(host);
    Assert(host.Accept(Envelope()), "Initial chat envelope should reveal the selected session.");
    AssertShown(host, a);
    Assert(a.View.Source!.AbsoluteUri == "about:blank", "Presentation must not navigate the session.");
});
Check("trusted chat bounds arrive before Core: later open promotes the new view from initial faint state", () =>
{
    var host = new PresentationHost();
    Assert(!host.Accept(Envelope()), "A route packet cannot create or select a session.");
    AssertHidden(host); Assert(App.WsService.Stored.Count == 0, "Bounds created a session.");
    var a = AddSession(); host.Sync(); host.Bounds(Envelope());
    AssertShown(host, a);
});
Check("unselected fallback layout anchor remains invisible and cannot claim foreground", () =>
{
    var host = new PresentationHost(); var a = AddSession(selected: false); host.Sync();
    AssertHidden(host);
    Assert(a.View.Opacity == 0 && !a.View.IsHitTestVisible, "Fallback anchor must be fully hidden, not faint.");
    Assert(!host.Accept(Envelope()), "Trusted bounds cannot activate the fallback account.");
    Assert(App.WsService.ActiveSession is null && App.WsRuntime.ForegroundAccountId is null, "Bounds changed selection.");
    App.WsService.ActiveAccountId = "a"; host.Sync(); host.Bounds(Envelope());
    AssertShown(host, a);
});
Check("hide then return to identical bounds restores opacity and input", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync(); host.Accept(Envelope());
    host.Hide(); AssertHidden(host);
    host.Bounds(Envelope()); AssertShown(host, a);
});
Check("unchanged geometry still repairs a hidden layer instead of returning before presentation", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync(); host.Accept(Envelope());
    host.Layer.Opacity = 0; host.Layer.IsHitTestVisible = false; Canvas.SetZIndex(host.Layer, -1);
    host.Bounds(Envelope()); AssertShown(host, a);
});
Check("hidden subpage and stale sequence cannot reveal the overlay; fresh chat sequence can", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync(); host.Accept(Envelope());
    Assert(!host.Accept(Envelope(sequence: 2, page: "groups")), "Groups must hide the native chat.");
    AssertHidden(host);
    Assert(!host.Accept(Envelope(sequence: 1)), "Stale bounds must be rejected."); AssertHidden(host);
    Assert(host.Accept(Envelope(sequence: 3)), "Fresh chat route should be accepted."); AssertShown(host, a);
});
Check("account switch hides the previous view and rejects its late bounds", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync(); host.Accept(Envelope());
    var b = AddSession("b"); host.Sync(); AssertHidden(host);
    Assert(a.View.Opacity == 0 && !a.View.IsHitTestVisible, "Previous account remains faint or interactive.");
    Assert(!host.Accept(Envelope(sequence: 2)), "Late previous-account bounds must not reveal active account."); AssertHidden(host);
    Assert(host.Accept(Envelope("b", 3)), "Current account bounds should reveal B."); AssertShown(host, b);
    Assert(App.WsService.Stored.Count == 2, "Presentation changed the pool size.");
});
Check("collector presentation swaps actual controls and returning restores the foreground", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync(); host.Accept(Envelope());
    host.Collector("a"); host.Bounds(Envelope());
    Assert(a.View.Opacity == 0 && !a.View.IsHitTestVisible, "Foreground must not show through the collector login.");
    Assert(a.CollectorView!.Opacity == 1 && a.CollectorView.IsHitTestVisible, "Visible collector login must be opaque and clickable.");
    Assert(ReferenceEquals(a.CollectorView.Parent, host.OverlayHost), "Collector must move to visible overlay.");
    host.Collector(""); host.Bounds(Envelope()); AssertShown(host, a);
    Assert(!a.CollectorView.IsHitTestVisible && ReferenceEquals(a.CollectorView.Parent, host.CollectorHost), "Returning must retire collector input to its hidden host.");
});
Check("minimize and restore with unchanged bounds restores child input as well as the layer", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync(); host.Accept(Envelope());
    host.Renderable(false); host.Sync(); host.Bounds(Envelope()); AssertHidden(host);
    host.Renderable(true); host.Bounds(Envelope()); AssertShown(host, a);
});
Check("zero-size initial anchor stays hidden and later valid anchor restores opaque foreground", () =>
{
    var host = new PresentationHost(); var a = AddSession(); host.Sync();
    host.Accept(Envelope(hidden: true, width: 0, height: 0)); AssertHidden(host);
    host.Accept(Envelope(sequence: 2)); AssertShown(host, a);
});

var failed = cases.Count(row => !(bool)row.GetType().GetProperty("passed")!.GetValue(row)!);
Console.WriteLine(JsonSerializer.Serialize(new { suite = "actual native presentation methods", passed = cases.Count - failed, failed, cases }));
return failed == 0 ? 0 : 1;

partial class PresentationHost
{
    private WebView2? _wsView;
    private string _wsViewAccountId = "", _currentRoute = "home", _wsPresentationAccountId = "", _wsBoundsDocumentId = "", _wsCollectorVisibleAccountId = "";
    private long _wsGeneration, _routeGeneration, _lastWsBoundsSequence;
    private bool _wsChatPageActive, _wsOverlayGeometryApplied, _hostWindowRenderable = true;
    private double _lastWsOverlayX, _lastWsOverlayY, _lastWsOverlayWidth, _lastWsOverlayHeight;
    private readonly SendGuard _wsSendGuard = new();
    private readonly Canvas WsOverlayLayer = new() { Opacity = 0, Visibility = Visibility.Collapsed, IsHitTestVisible = false };
    private readonly Border WsOverlayBorder = new();
    private readonly Grid WsOverlayHost = new();
    private readonly Grid WsCollectorHost = new() { Opacity = 0, IsHitTestVisible = false };
    private readonly Grid WebViewHost = new() { ActualWidth = 1440, ActualHeight = 900 };
    public Canvas Layer => WsOverlayLayer;
    public Border Geometry => WsOverlayBorder;
    public Grid OverlayHost => WsOverlayHost;
    public Grid CollectorHost => WsCollectorHost;
    public void Sync() => SyncPooledWsPresentation();
    public void Hide() => HideWsOverlay();
    public void Bounds(JsonElement payload) => ApplyWsBounds(payload);
    public void Collector(string account) { _wsCollectorVisibleAccountId = account; SyncPooledWsPresentation(); }
    public void Renderable(bool renderable) => _hostWindowRenderable = renderable;
    public bool Accept(JsonElement payload)
    {
        var accepted = ApplyTrustedWsRouteVisibility(payload);
        if (accepted) ApplyWsBounds(payload);
        return accepted;
    }
}
