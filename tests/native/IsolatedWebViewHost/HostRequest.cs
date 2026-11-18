using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Zhike.IsolatedWebViewHost;

sealed class HostFailure(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

sealed record Viewport(int Width, int Height);

sealed record HostRequest(string Root, string Profile, string AssetRoot, Uri Target, Viewport Viewport, bool Capture)
{
    private sealed record Input(string? Root, string? Profile, string? AssetRoot, string? TargetUrl,
        Viewport? Viewport, string? ScreenshotPath);

    private static readonly string[] OverrideSettings =
        ["BrowserExecutableFolder", "UserDataFolder", "AdditionalBrowserArguments", "ReleaseChannelPreference", "ChannelSearchKind", "ReleaseChannels"];

    private static readonly string[] OverrideVariables =
        ["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
         "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE", "WEBVIEW2_CHANNEL_SEARCH_KIND", "WEBVIEW2_RELEASE_CHANNELS",
         "WEBVIEW2_WAIT_FOR_SCRIPT_DEBUGGER", "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER"];

    [DllImport("shell32.dll")]
    private static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr appId);

    public static HostRequest Load()
    {
        var args = Environment.GetCommandLineArgs();
        Require(args is [_, "--request", _], "Expected a single --request file");
        var requestPath = LocalPath(args[2]);
        var root = Path.GetDirectoryName(requestPath)!;
        Require(Same(Path.GetDirectoryName(root), LocalPath(Path.GetTempPath())) &&
            Regex.IsMatch(Path.GetFileName(root), @"\Azhike-[a-z0-9-]+\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) &&
            Regex.IsMatch(Path.GetFileName(requestPath), @"\Awebview-request(?:-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?\.json\z",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant), "Request must be in an owned temporary directory");
        Require(PlainExistingDirectory(root), "Temporary request directory must be a plain directory");
        Require(PlainFile(requestPath), "Request must be a plain file");
        using var stream = File.OpenRead(requestPath);
        Require(stream.Length <= 16384, "Request exceeds its size bound");
        var input = JsonSerializer.Deserialize<Input>(stream, JsonSerializerOptions.Web);
        Require(input is not null && Same(LocalPath(input.Root), root), "Request root does not match its parent directory");
        var profile = LocalPath(input!.Profile);
        Require(Same(Path.GetDirectoryName(profile), root), "Expected a fresh profile directory under the request root");
        Require(FreshProfile(profile), "Profile must be fresh, empty, and free of reparse points");
        var assets = LocalPath(input.AssetRoot);
        Require(Same(assets, RepoAssetRoot()) && PlainExistingDirectory(assets), "Asset root is outside the repository application assets");
        Require(Uri.TryCreate(input.TargetUrl, UriKind.Absolute, out var target) && TryFilePath(target, out var fixture) &&
            Same(Path.GetDirectoryName(fixture), root) && Path.GetExtension(fixture).Equals(".html", StringComparison.OrdinalIgnoreCase) &&
            PlainFile(fixture), "Target must be a local HTML fixture in the request root");
        var viewport = input.Viewport ?? new Viewport(1280, 720);
        Require(viewport.Width is >= 1 and <= 8192 && viewport.Height is >= 1 and <= 8192, "Viewport exceeds its size bound");
        RejectOverrides();
        return new HostRequest(root, profile, assets, target!, viewport, !string.IsNullOrEmpty(input.ScreenshotPath));
    }

    public bool IsTarget(string uri)
    {
        return Uri.TryCreate(uri, UriKind.Absolute, out var parsed) && TryFilePath(parsed, out var path) &&
            Same(path, LocalPath(Target.LocalPath)) && parsed.Query == Target.Query && parsed.Fragment == Target.Fragment;
    }

    public bool IsAllowedResource(string uri)
    {
        if (uri == "about:blank" || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return true;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) || !TryFilePath(parsed, out var file)) return false;
        bool fixture = Same(Path.GetDirectoryName(file), Root) &&
            Path.GetExtension(file).Equals(".html", StringComparison.OrdinalIgnoreCase);
        return (fixture || file.StartsWith(AssetRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) &&
            PlainFile(file) && PlainExistingDirectory(Path.GetDirectoryName(file)!);
    }

    public static bool Same(string? left, string? right) => string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    public static string LocalPath(string? value)
    {
        Require(!string.IsNullOrEmpty(value) && Path.IsPathFullyQualified(value) && !value.StartsWith(@"\\"),
            "Expected an absolute local path");
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(value!));
        Require(full.Length >= 3 && full[1] == ':' && !full.AsSpan(2).Contains(':'), "Expected a local drive path");
        return full;
    }

    private static bool TryFilePath(Uri uri, out string path)
    {
        path = "";
        if (!uri.IsFile || uri.IsUnc || !string.IsNullOrEmpty(uri.Host)) return false;
        try { path = LocalPath(uri.LocalPath); return true; }
        catch (Exception error) when (error is HostFailure or IOException or ArgumentException or NotSupportedException) { return false; }
    }

    private static string RepoAssetRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "tests", "native", "IsolatedWebViewHost", "IsolatedWebViewHost.csproj")) &&
                File.Exists(Path.Combine(dir.FullName, "resources", "app", "index.html")))
                return Path.Combine(dir.FullName, "resources", "app");
        }
        throw new HostFailure("INVALID_REQUEST", "Test executable must be built under the repository");
    }

    private static bool PlainExistingDirectory(string path)
    {
        for (var dir = new DirectoryInfo(path); dir is not null; dir = dir.Parent)
            if (!dir.Exists || (dir.Attributes & FileAttributes.ReparsePoint) != 0) return false;
        return true;
    }

    private static bool PlainFile(string path) => File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0;

    private static bool FreshProfile(string path)
    {
        FileAttributes attributes;
        try { attributes = File.GetAttributes(path); }
        catch (FileNotFoundException) { return true; }
        catch (DirectoryNotFoundException) { return true; }
        return (attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == FileAttributes.Directory &&
            !Directory.EnumerateFileSystemEntries(path).Any();
    }

    private static void RejectOverrides()
    {
        if (OverrideVariables.Any(name => Environment.GetEnvironmentVariable(name) is not null))
            throw new HostFailure("WEBVIEW_OVERRIDE", "WebView2 environment overrides are present");
        var executable = Path.GetFileName(Environment.ProcessPath);
        var appIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "*", executable!, Path.GetFileNameWithoutExtension(executable)! };
        if (GetCurrentProcessExplicitAppUserModelID(out var appId) == 0 && appId != IntPtr.Zero)
        {
            try
            {
                if (Marshal.PtrToStringUni(appId) is { Length: > 0 } name) appIds.Add(name);
            }
            finally { Marshal.FreeCoTaskMem(appId); }
        }
        foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var registry = RegistryKey.OpenBaseKey(hive, view);
            foreach (var setting in OverrideSettings)
            {
                using var policy = registry.OpenSubKey(@"SOFTWARE\Policies\Microsoft\Edge\WebView2\" + setting);
                if (policy?.GetValueNames().Any(appIds.Contains) == true)
                    throw new HostFailure("WEBVIEW_OVERRIDE", "A policy overrides the isolated WebView2 environment");
            }
        }
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new HostFailure("INVALID_REQUEST", message);
    }
}
