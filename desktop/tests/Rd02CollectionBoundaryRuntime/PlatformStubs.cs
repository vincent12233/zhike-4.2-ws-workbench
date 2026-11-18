// Only the platform adapters are synthetic. Tests link the real production
// profile, scheduler, coordinator and pool. No WebView browser is started.
namespace Microsoft.Web.WebView2.Core
{
    public sealed class CoreWebView2EnvironmentOptions { }
    public sealed class CoreWebView2Environment
    {
        public static int Created { get; private set; }
        public static Task<CoreWebView2Environment> CreateWithOptionsAsync(string? executable, string profile, CoreWebView2EnvironmentOptions options)
        { Created++; return Task.FromResult(new CoreWebView2Environment()); }
    }
    public sealed class CoreWebView2 { }
}
namespace Microsoft.UI.Xaml.Controls
{
    public sealed class WebView2
    {
        public Microsoft.Web.WebView2.Core.CoreWebView2? CoreWebView2 { get; set; } = new();
        public Uri? Source { get; set; }
        public bool Closed { get; private set; }
        public void Close() => Closed = true;
    }
}
namespace Microsoft.UI.Dispatching
{
    public sealed class DispatcherQueue
    {
        public DispatcherQueueTimer CreateTimer() => new();
    }
    public sealed class DispatcherQueueTimer
    {
        public TimeSpan Interval { get; set; }
        public event EventHandler? Tick;
        public void Start() { }
        public void Stop() { }
        public void Fire() => Tick?.Invoke(this, EventArgs.Empty);
    }
}
