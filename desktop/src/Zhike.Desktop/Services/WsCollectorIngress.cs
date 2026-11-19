using Microsoft.UI.Xaml.Controls;

namespace Zhike.Desktop.Services;

/// <summary>Capture authority comes from the host-owned control, never the page's role claim.</summary>
public static class WsCollectorIngress
{
    public static bool TryAuthorize(WsWebViewSession session, long generation, WebView2 sourceView,
        string claimedAccountId, string claimedRole, out bool fromCollector)
    {
        fromCollector = false;
        if (session.Generation != generation
            || (!string.IsNullOrWhiteSpace(claimedAccountId)
                && !string.Equals(session.AccountId, claimedAccountId, StringComparison.Ordinal))) return false;
        if (ReferenceEquals(sourceView, session.CollectorView))
        {
            fromCollector = true;
            return session.IsCollectorReady && session.CollectorState == "running"
                && string.Equals(session.AccountId, claimedAccountId, StringComparison.Ordinal)
                && string.Equals(claimedRole, "background", StringComparison.Ordinal);
        }
        return ReferenceEquals(sourceView, session.View)
            && !string.Equals(claimedRole, "background", StringComparison.Ordinal);
    }
}
