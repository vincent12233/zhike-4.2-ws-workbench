using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Zhike.IsolatedWebViewHost;

// A real HWND and STA pump for CSS fixtures. Product WinUI acceptance is separate.
public sealed class App : Form
{
    private const int MaximumLineBytes = 32 * 1024 * 1024;
    private int _exitCode = 1;
    private sealed class CloseRequested : Exception { }
    private sealed record BrowserExit(uint Pid, CoreWebView2BrowserProcessExitKind Kind);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    [STAThread]
    private static int Main()
    {
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        using var window = new App();
        Application.Run(window);
        return window._exitCode;
    }

    protected override bool ShowWithoutActivation => true;
    public App()
    {
        Text = "Isolated WebView renderer test";
        ClientSize = new Size(640, 480);
        ShowInTaskbar = false;
        ControlBox = false;
        StartPosition = FormStartPosition.Manual;
    }

    protected override async void OnShown(EventArgs args)
    {
        base.OnShown(args);
        // The fixture renders without taking focus or covering the user's work.
        SetWindowPos(Handle, new IntPtr(1), 0, 0, 0, 0, 0x0010 | 0x0002 | 0x0001);
        CoreWebView2Controller? controller = null;
        var phase = "request";
        var clock = Stopwatch.StartNew();
        var uiThread = Environment.CurrentManagedThreadId;
        void ReportStage(string stage)
        {
            if (Environment.CurrentManagedThreadId == uiThread) phase = stage;
            Console.Error.WriteLine(JsonSerializer.Serialize(new { kind = "webview-stage", phase = stage, elapsedMs = clock.Elapsed.TotalMilliseconds,
                thread = Environment.CurrentManagedThreadId, uiThread = Environment.CurrentManagedThreadId == uiThread }));
        }
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            var request = HostRequest.Load();
            // The parent can request cleanup during any pending renderer operation.
            var closeCommand = Task.Run(() => { var result = ReadCloseCommand(); ReportStage("close-command-read"); return result; });
            ReportStage("environment");
            var environment = await CoreWebView2Environment.CreateAsync(null, request.Profile,
                new CoreWebView2EnvironmentOptions
                {
                    ExclusiveUserDataFolderAccess = true,
                    ReleaseChannels = CoreWebView2ReleaseChannels.Stable,
                    // Match the original renderer's 1x device scale independently of the host window DPI.
                    AdditionalBrowserArguments = "--disable-background-networking --force-device-scale-factor=1 --host-resolver-rules=\"MAP * ~NOTFOUND\"",
                });
            Require(HostRequest.Same(HostRequest.LocalPath(environment.UserDataFolder), request.Profile),
                "PROFILE_MISMATCH", "WebView2 did not use the isolated profile");

            var failure = Signal<HostFailure>();
            var browserExit = Signal<BrowserExit>();
            bool closing = false;
            EventHandler<CoreWebView2BrowserProcessExitedEventArgs> onBrowserExit = (_, info) =>
            {
                ReportStage("browser-exit-event");
                browserExit.TrySetResult(new BrowserExit(info.BrowserProcessId, info.BrowserProcessExitKind));
                if (!closing) failure.TrySetResult(new HostFailure("BROWSER_EARLY_EXIT", "WebView2 exited before the close request"));
            };
            environment.BrowserProcessExited += onBrowserExit;

            ReportStage("core");
            controller = await environment.CreateCoreWebView2ControllerAsync(Handle);
            controller.Bounds = ClientRectangle;
            controller.ZoomFactor = 1;
            var core = controller.CoreWebView2;
            var browserPid = core.BrowserProcessId;
            Require(browserPid > 0, "BROWSER_IDENTITY", "WebView2 did not report a browser PID");
            core.ProcessFailed += (_, _) => failure.TrySetResult(new HostFailure("WEBVIEW_PROCESS_FAILED", "A WebView2 process failed"));
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsWebMessageEnabled = false;
            core.NewWindowRequested += (_, info) => info.Handled = true;
            core.DownloadStarting += (_, info) => info.Cancel = true;
            core.FrameNavigationStarting += (_, info) => info.Cancel = !request.IsAllowedResource(info.Uri);
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += (_, info) =>
            {
                if (!request.IsAllowedResource(info.Request.Uri))
                    info.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Forbidden", "");
            };
            Emit(new { kind = "ready", hostBackend = "win32-controller", browserPid, processIds = ProcessIds(environment, browserPid),
                profile = request.Profile, runtimeVersion = environment.BrowserVersionString });

            var renderInterrupted = false;
            try
            {
                await RenderFixtureAsync(request, core, environment, browserPid, failure, closeCommand, ReportStage);
            }
            catch (CloseRequested)
            {
                renderInterrupted = true;
                ReportStage("render-interrupted");
            }

            ReportStage("close-command");
            await Checked(closeCommand, failure);
            ReportStage("browser-exit");
            Require(!browserExit.Task.IsCompleted, "BROWSER_EARLY_EXIT", "WebView2 exited before the close request");
            closing = true;
            ReportStage("controller-close-begin");
            var retiringController = controller;
            controller = null;
            retiringController.Close();
            ReportStage("controller-close-returned");
            var exited = await browserExit.Task;
            Require(exited.Pid == browserPid && exited.Kind == CoreWebView2BrowserProcessExitKind.Normal,
                "BROWSER_EXIT_UNVERIFIED", "WebView2 did not report a normal exit for its owned browser PID");
            environment.BrowserProcessExited -= onBrowserExit;
            Emit(new { kind = "closed", browserPid, normal = true });
            _exitCode = renderInterrupted ? 1 : 0;
            ReportStage("window-close");
            Close();
        }
        catch (Exception error)
        {
            _exitCode = 1;
            var known = error as HostFailure;
            Emit(new { kind = "error", phase, code = known?.Code ?? "WEBVIEW_HOST_ERROR",
                message = known?.Message ?? $"{phase}: {error.GetType().Name} (0x{error.HResult:X8})" });
            try { controller?.Close(); }
            finally { Close(); }
        }
    }

    private static async Task RenderFixtureAsync(HostRequest request, CoreWebView2 core, CoreWebView2Environment environment,
        uint browserPid, TaskCompletionSource<HostFailure> failure, Task<bool> closeCommand, Action<string> reportStage)
    {
        reportStage("navigation");
        var navigation = Signal<bool>();
        var lifecycle = Signal<bool>();
        ulong? navigationId = null;
        string? expectedLoader = null, expectedFrame = null;
        var observedLoads = new HashSet<(string? Loader, string? Frame)>();
        core.NavigationStarting += (_, info) =>
        {
            reportStage("navigation-starting");
            if (request.IsTarget(info.Uri)) navigationId = info.NavigationId;
            else if (info.Uri != "about:blank") info.Cancel = true;
        };
        core.NavigationCompleted += (_, info) =>
        {
            reportStage("navigation-completed");
            if (navigationId == info.NavigationId) navigation.TrySetResult(info.IsSuccess);
        };
        core.GetDevToolsProtocolEventReceiver("Page.lifecycleEvent").DevToolsProtocolEventReceived += (_, info) =>
        {
            using var document = JsonDocument.Parse(info.ParameterObjectAsJson);
            var value = document.RootElement;
            if (value.GetProperty("name").GetString() != "load") return;
            var identity = (value.GetProperty("loaderId").GetString(), value.GetProperty("frameId").GetString());
            if (observedLoads.Count < 32) observedLoads.Add(identity);
            if (identity == (expectedLoader, expectedFrame)) lifecycle.TrySetResult(true);
        };
        core.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown").DevToolsProtocolEventReceived += (_, _) =>
            failure.TrySetResult(new HostFailure("FIXTURE_SCRIPT_ERROR", "The fixture raised an unhandled JavaScript exception"));
        await Call(core, failure, closeCommand, "Page.enable", new { });
        await Call(core, failure, closeCommand, "Runtime.enable", new { });
        await Call(core, failure, closeCommand, "Page.setLifecycleEventsEnabled", new { enabled = true });
        var requested = request.Viewport;
        await Call(core, failure, closeCommand, "Emulation.setDeviceMetricsOverride",
            new { width = requested.Width, height = requested.Height, deviceScaleFactor = 1, mobile = false });
        // Render Blink's focus-dependent styles while leaving the Windows test window inactive.
        await Call(core, failure, closeCommand, "Emulation.setFocusEmulationEnabled", new { enabled = true });
        reportStage("navigation-call");
        var navigationResponse = await Call(core, failure, closeCommand, "Page.navigate", new { url = request.Target.AbsoluteUri });
        Require(!navigationResponse.TryGetProperty("errorText", out _), "NAVIGATION_REJECTED", "WebView2 rejected the fixture navigation");
        expectedLoader = navigationResponse.GetProperty("loaderId").GetString();
        expectedFrame = navigationResponse.GetProperty("frameId").GetString();
        reportStage("navigation-response");
        Require(!string.IsNullOrEmpty(expectedLoader) && !string.IsNullOrEmpty(expectedFrame),
            "NAVIGATION_IDENTITY", "CDP did not report a fixture loader and frame");
        if (observedLoads.Contains((expectedLoader, expectedFrame))) lifecycle.TrySetResult(true);
        Require(await Checked(navigation.Task, failure, closeCommand), "NAVIGATION_FAILED", "WebView2 fixture navigation did not complete successfully");
        reportStage("navigation-complete-verified");
        await Checked(lifecycle.Task, failure, closeCommand);

        reportStage("viewport-read");
        var measured = await Evaluate(core, failure, closeCommand, "({width:innerWidth,height:innerHeight})", false);
        int width = measured.GetProperty("width").GetInt32(), height = measured.GetProperty("height").GetInt32();
        Require(width == requested.Width && height == requested.Height, "VIEWPORT_MISMATCH",
            $"Expected viewport {requested.Width}x{requested.Height}, received {width}x{height}");
        reportStage("fixture-result");
        var value = (await Evaluate(core, failure, closeCommand, """
            (function waitForMatrix() {
                return new Promise(resolve => {
                  const complete = () => { const value = document.getElementById('result')?.textContent; if (value) { observer.disconnect(); resolve(value); } };
                  const observer = new MutationObserver(complete); observer.observe(document, { childList: true, subtree: true, characterData: true }); complete();
                });
            })()
            """, true)).GetString();
        Require(!string.IsNullOrWhiteSpace(value), "RESULT_MISSING", "The fixture did not return its JSON text");
        string? screenshotData = null;
        if (request.Capture)
        {
            reportStage("screenshot");
            var screenshot = await Call(core, failure, closeCommand, "Page.captureScreenshot",
                new { format = "png", fromSurface = true, captureBeyondViewport = false });
            screenshotData = screenshot.GetProperty("data").GetString();
            Require(!string.IsNullOrWhiteSpace(screenshotData), "SCREENSHOT_MISSING", "WebView2 did not return screenshot data");
        }
        reportStage("result-output");
        var processIds = ProcessIds(environment, browserPid);
        var viewport = new { width, height };
        var verifiedNavigation = new { id = navigationId!.Value, succeeded = true, url = request.Target.AbsoluteUri };
        if (screenshotData is null) Emit(new { kind = "result", value, viewport, processIds, navigation = verifiedNavigation });
        else Emit(new { kind = "result", value, viewport, processIds, navigation = verifiedNavigation, screenshotData });
        reportStage("result-transmitted");
    }

    private static bool ReadCloseCommand()
    {
        using var close = JsonDocument.Parse(Console.ReadLine() ?? "{}");
        Require(close.RootElement.ValueKind == JsonValueKind.Object &&
            close.RootElement.EnumerateObject().Count() == 1 &&
            close.RootElement.TryGetProperty("command", out var name) && name.ValueKind == JsonValueKind.String &&
            name.GetString() == "close", "CLOSE_COMMAND", "Expected the single explicit close command");
        return true;
    }

    private static TaskCompletionSource<T> Signal<T>() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static async Task<T> Checked<T>(Task<T> operation, TaskCompletionSource<HostFailure> failure, Task<bool>? closeCommand = null)
    {
        if (closeCommand is null) await Task.WhenAny(operation, failure.Task);
        else await Task.WhenAny(operation, failure.Task, closeCommand);
        if (failure.Task.IsCompleted) throw await failure.Task;
        if (closeCommand?.IsCompleted == true)
        {
            await closeCommand;
            throw new CloseRequested();
        }
        return await operation;
    }

    private static async Task<JsonElement> Call(CoreWebView2 core, TaskCompletionSource<HostFailure> failure,
        Task<bool> closeCommand, string method, object parameters)
    {
        var payload = await Checked(core.CallDevToolsProtocolMethodAsync(method, JsonSerializer.Serialize(parameters)), failure, closeCommand);
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> Evaluate(CoreWebView2 core, TaskCompletionSource<HostFailure> failure,
        Task<bool> closeCommand, string expression, bool awaitPromise)
    {
        var result = await Call(core, failure, closeCommand, "Runtime.evaluate", new { expression, awaitPromise, returnByValue = true });
        Require(!result.TryGetProperty("exceptionDetails", out _), "FIXTURE_SCRIPT_ERROR", "Runtime rejected the fixture expression");
        return result.GetProperty("result").GetProperty("value");
    }

    private static uint[] ProcessIds(CoreWebView2Environment environment, uint browserPid)
    {
        var ids = environment.GetProcessInfos().Select(info => checked((uint)info.ProcessId)).Distinct().Order().ToArray();
        Require(ids.Contains(browserPid) && ids.Length <= 256, "BROWSER_IDENTITY", "Owned WebView2 process identities are unavailable");
        return ids;
    }

    private static void Emit(object row)
    {
        var line = JsonSerializer.Serialize(row);
        Require(Encoding.UTF8.GetByteCount(line) <= MaximumLineBytes, "OUTPUT_LIMIT", "The host response exceeded its line limit");
        Console.WriteLine(line);
        Console.Out.Flush();
    }

    private static void Require(bool condition, string code, string message)
    {
        if (!condition) throw new HostFailure(code, message);
    }
}
