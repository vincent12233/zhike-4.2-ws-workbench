using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    const uint ProcessAccess = 0x00101000; // SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
    const uint WaitSignaled = 0;
    const uint WaitTimeout = 258;
    const uint WaitFailed = uint.MaxValue;
    const uint StillActive = 259;

    record Identity(int Pid, string StartedTicks, string Role);
    record WatchRequest(string Kind, int RootPid, long CloseAtUnixMs, long DeadlineUnixMs, Identity[] Identities);
    record InvocationRequest(string Kind, string Invocation, double RunnerSentElapsedMs, double DeadlineMs, Identity? Identity);
    record Owned(Identity Identity, SafeWaitHandle Handle) : IDisposable
    {
        public void Dispose() => Handle.Dispose();
    }
    readonly record struct WaitResult(uint Status, int? Error);
    readonly record struct ProcessObservation(
        WaitResult Before, WaitResult After, double QueryStartedMs, double QueryEndedMs,
        uint? HandlePid, int? HandlePidError, uint? RawExitCode, int? RawExitCodeError,
        long? ExitFileTimeUtcRaw, int? ProcessTimesError, long? KernelTicks, long? UserTicks)
    {
        public bool ExitStatusBeforeSignal =>
            Before.Status == WaitTimeout && After.Status == WaitTimeout &&
            RawExitCode is uint code && code != StillActive;

        public object Describe(Identity identity)
        {
            long? exitUnixMs = Before.Status == WaitSignaled && ExitFileTimeUtcRaw is long fileTime && fileTime > 0
                ? new DateTimeOffset(DateTime.FromFileTimeUtc(fileTime)).ToUnixTimeMilliseconds()
                : null;
            return new {
                pid = identity.Pid, role = identity.Role,
                state = Before.Status == WaitTimeout ? "running" : Before.Status == WaitSignaled ? "exited" : "unknown",
                waitStatusBeforeQuery = Before.Status, waitErrorBeforeQuery = Before.Error,
                waitStatusAfterQuery = After.Status, waitErrorAfterQuery = After.Error,
                queryStartedMs = QueryStartedMs, queryEndedMs = QueryEndedMs,
                handlePid = HandlePid, handlePidError = HandlePidError,
                rawExitCode = RawExitCode, rawExitCodeError = RawExitCodeError,
                exitFileTimeUtcRaw = ExitFileTimeUtcRaw, processTimesError = ProcessTimesError,
                exitUnixMs, exitCode = Before.Status == WaitSignaled ? RawExitCode : null,
                kernelTicks = KernelTicks, userTicks = UserTicks,
            };
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low, High;
        public long Value => (long)(((ulong)High << 32) | Low);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeWaitHandle OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeWaitHandle OpenThread(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll")]
    private static extern uint GetProcessIdOfThread(SafeWaitHandle handle);
    [DllImport("kernel32.dll")]
    private static extern int GetThreadDescription(SafeWaitHandle handle, out IntPtr description);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeWaitHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(SafeWaitHandle handle, out FileTime creation, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(SafeWaitHandle handle, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetProcessId(SafeWaitHandle handle);

    static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static double MonotonicMs() => Stopwatch.GetTimestamp() * (1000.0 / Stopwatch.Frequency);
    static void Write(string kind, object? body = null)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { kind, unixMs = Now(), body }));
        Console.Out.Flush();
    }

    static string ClassifyThread(string name)
    {
        if (name is "CrBrowserMain" or "Chrome_IOThread" or "Chrome_InProcGpuThread" or "BrokerEvent" or "CrShutdownWatchDog")
            return name;
        if (name.StartsWith("ThreadPoolForeground", StringComparison.Ordinal)) return "ThreadPoolForeground";
        if (name.StartsWith("ThreadPoolBackground", StringComparison.Ordinal)) return "ThreadPoolBackground";
        if (name.StartsWith("ThreadPoolService", StringComparison.Ordinal)) return "ThreadPoolService";
        if (name.StartsWith("Compositor", StringComparison.Ordinal)) return "Compositor";
        return name.Length == 0 ? "unnamed" : "other";
    }

    static string DescribeThread(ProcessThread thread, int expectedPid)
    {
        using var handle = OpenThread(0x0800, false, (uint)thread.Id); // THREAD_QUERY_LIMITED_INFORMATION
        if (handle.IsInvalid || GetProcessIdOfThread(handle) != (uint)expectedPid)
            return "unavailable";
        if (GetThreadDescription(handle, out var description) != 0 || description == IntPtr.Zero)
            return "unnamed";
        try { return ClassifyThread(Marshal.PtrToStringUni(description) ?? ""); }
        finally { LocalFree(description); }
    }

    static object RootThreadStates(Owned owner)
    {
        var initial = WaitOnProcess(owner.Handle, 0);
        if (initial.Status != WaitTimeout)
            return new { status = initial.Status == WaitSignaled ? "not-running" : "wait-unavailable",
                waitStatus = initial.Status, waitError = initial.Error };
        var stage = "get-process-by-id";
        try
        {
            using var target = Process.GetProcessById(owner.Identity.Pid);
            stage = "check-start-time";
            if (target.StartTime.ToUniversalTime().Ticks.ToString() != owner.Identity.StartedTicks)
                return new { status = "identity-mismatch" };
            var states = new SortedDictionary<string, int>();
            stage = "list-threads";
            var threads = target.Threads;
            stage = "read-thread-details";
            foreach (ProcessThread thread in threads)
            {
                using (thread)
                {
                    var description = DescribeThread(thread, owner.Identity.Pid);
                    string state;
                    try
                    {
                        var raw = thread.ThreadState;
                        state = raw.ToString();
                        if (raw == System.Diagnostics.ThreadState.Wait)
                        {
                            try { state += ":" + thread.WaitReason; }
                            catch(InvalidOperationException) { state += ":unavailable"; }
                        }
                    }
                    catch (InvalidOperationException) { state = "unavailable"; }
                    var key = description + "/" + state;
                    states[key] = states.GetValueOrDefault(key) + 1;
                }
            }
            return new { status = "observed", states };
        }
        catch (Exception error)
        {
            return new {
                status = "unavailable", stage, error = error.GetType().Name, hresult = error.HResult,
                win32Error = error is System.ComponentModel.Win32Exception win32 ? win32.NativeErrorCode : (int?)null,
                retainedHandle = ProcessState(owner), reopened = InspectIdentityByPid(owner.Identity),
            };
        }
    }

    static WaitResult WaitOnProcess(SafeWaitHandle handle, uint milliseconds)
    {
        var status = WaitForSingleObject(handle, milliseconds);
        return new WaitResult(status, status == WaitFailed ? Marshal.GetLastPInvokeError() : null);
    }

    static ProcessObservation ObserveProcess(SafeWaitHandle handle, uint milliseconds)
    {
        var before = WaitOnProcess(handle, milliseconds);
        var queryStartedMs = MonotonicMs();
        bool gotExitCode = GetExitCodeProcess(handle, out var exitCode);
        int? exitCodeError = gotExitCode ? null : Marshal.GetLastPInvokeError();
        bool gotTimes = GetProcessTimes(handle, out _, out var exited, out var kernel, out var user);
        int? timesError = gotTimes ? null : Marshal.GetLastPInvokeError();
        uint pid = GetProcessId(handle);
        int? pidError = pid != 0 ? null : Marshal.GetLastPInvokeError();
        var after = WaitOnProcess(handle, 0);
        return new ProcessObservation(before, after, queryStartedMs, MonotonicMs(),
            pid != 0 ? pid : null, pidError, gotExitCode ? exitCode : null, exitCodeError,
            gotTimes ? exited.Value : null, timesError, gotTimes ? kernel.Value : null, gotTimes ? user.Value : null);
    }

    static object ProcessState(Owned owner) => ObserveProcess(owner.Handle, 0).Describe(owner.Identity);

    static object InspectIdentityByPid(Identity identity)
    {
        using var handle = OpenProcess(ProcessAccess, false, (uint)identity.Pid);
        if (handle.IsInvalid) return new { status = "open-failed", win32Error = Marshal.GetLastPInvokeError() };
        if (!GetProcessTimes(handle, out var created, out _, out _, out _))
            return new { status = "times-failed", win32Error = Marshal.GetLastPInvokeError() };
        var startedTicks = DateTime.FromFileTimeUtc(created.Value).Ticks.ToString();
        if (startedTicks != identity.StartedTicks) return new { status = "identity-mismatch" };
        return new {
            status = "identity-matched", startedTicks, root = ObserveProcess(handle, 0).Describe(identity),
        };
    }

    static void Watch(WatchRequest request)
    {
        if (request.Kind is not ("control" or "edge") ||
            request.Identities.Length is < 1 or > 256 ||
            request.Identities.Select(row => row.Pid).Distinct().Count() != request.Identities.Length ||
            !request.Identities.Any(row => row.Pid == request.RootPid) ||
            request.DeadlineUnixMs - request.CloseAtUnixMs is < 0 or > 30000)
        {
            Write("watch-invalid");
            return;
        }
        var opened = new List<Owned>();
        var inaccessible = new List<int>();
        try
        {
            foreach (var row in request.Identities)
            {
                var handle = OpenProcess(ProcessAccess, false, (uint)row.Pid);
                if (handle.IsInvalid || !GetProcessTimes(handle, out var created, out _, out _, out _) ||
                    DateTime.FromFileTimeUtc(created.Value).Ticks.ToString() != row.StartedTicks)
                {
                    handle.Dispose();
                    inaccessible.Add(row.Pid);
                    continue;
                }
                opened.Add(new(row, handle));
            }
            var owner = opened.Find(row=>row.Identity.Pid == request.RootPid);
            Write("watch-armed", new { request.Kind, request.RootPid, handleCount = opened.Count, rootAvailable = owner is not null, inaccessible });
            if(owner is null)
            {
                Write("watch-ended", new { request.Kind, ending = "root-identity-unavailable" });
                return;
            }
            int[] sampleOffsets = [0, 250, 2000, 7000, 15000, 24000];
            int index = 0;
            while (Now() < request.DeadlineUnixMs)
            {
                var elapsed = Now() - request.CloseAtUnixMs;
                var status = WaitForSingleObject(owner.Handle, 0);
                if (status != 258)
                {
                    Write("watch-ended", new { request.Kind, ending = status == 0 ? "root-exited" : "wait-unavailable",
                        elapsed, root = ProcessState(owner), observed = opened.Select(ProcessState).ToArray() });
                    return;
                }
                if (index < sampleOffsets.Length && elapsed >= sampleOffsets[index])
                {
                    Write("sample", new { request.Kind, elapsed, sampleOffsets = sampleOffsets[index],
                        observed = opened.Select(ProcessState).ToArray(), threads = RootThreadStates(owner) });
                    index++;
                }
                Thread.Sleep((int)Math.Clamp(request.DeadlineUnixMs-Now(),1,75));
            }
            Write("watch-ended", new { request.Kind, ending = "original-deadline", root = ProcessState(owner),
                observed = opened.Select(ProcessState).ToArray() });
        }
        finally { foreach (var row in opened) row.Dispose(); }
    }
    static void WatchInvocation(InvocationRequest request)
    {
        var identity = request.Identity;
        var now = MonotonicMs();
        if (identity is null || identity.Pid <= 0 || !long.TryParse(identity.StartedTicks, out var startedTicks) ||
            !double.IsFinite(request.DeadlineMs) || request.DeadlineMs - now is < -30000 or > 30000)
        {
            Write("watch-invalid", new { request.Invocation });
            return;
        }
        using var handle = OpenProcess(ProcessAccess, false, (uint)identity.Pid);
        int? openError = handle.IsInvalid ? Marshal.GetLastPInvokeError() : null;
        uint handlePid = handle.IsInvalid ? 0 : GetProcessId(handle);
        int? handlePidError = !handle.IsInvalid && handlePid == 0 ? Marshal.GetLastPInvokeError() : null;
        FileTime created = default;
        bool gotTimes = !handle.IsInvalid && GetProcessTimes(handle, out created, out _, out _, out _);
        int? timesError = !handle.IsInvalid && !gotTimes ? Marshal.GetLastPInvokeError() : null;
        bool verified = handlePid == (uint)identity.Pid && gotTimes && DateTime.FromFileTimeUtc(created.Value).Ticks == startedTicks;
        Write("watch-armed", new {
            request.Invocation, identity.Pid, identity.StartedTicks, verified, monotonicMs = MonotonicMs(),
            handlePid, openError, handlePidError, timesError,
        });
        if (!verified) return;

        var owned = new Owned(identity, handle);
        double[] samplePoints = [request.DeadlineMs - 20000, request.DeadlineMs - 10000, request.DeadlineMs - 2500];
        int sample = Array.FindIndex(samplePoints, point => point > now);
        double? lastRunningMs = null;
        ProcessObservation observation;
        double observedMs;
        bool reportedEarlyExitStatus = false;
        void RecordEarlyExitStatus(ProcessObservation state)
        {
            if (!state.ExitStatusBeforeSignal || reportedEarlyExitStatus) return;
            reportedEarlyExitStatus = true;
            Write("watch-exit-status-before-signal", new { request.Invocation, root = state.Describe(identity) });
        }

        do
        {
            var beforeWaitMs = MonotonicMs();
            var remaining = request.DeadlineMs - beforeWaitMs;
            observation = ObserveProcess(handle, (uint)Math.Clamp(Math.Ceiling(remaining), 0, 25));
            observedMs = observation.QueryStartedMs;
            // A timeout proves the handle stayed unsignaled until at least
            // beforeWaitMs. The observer may be descheduled after the wait.
            if (observation.Before.Status == WaitTimeout) lastRunningMs = beforeWaitMs;
            RecordEarlyExitStatus(observation);
            if (observation.Before.Status == WaitTimeout && sample >= 0 && sample < samplePoints.Length && observedMs >= samplePoints[sample] && observedMs < request.DeadlineMs - 1000)
            {
                sample++;
                Write("watch-sample", new { request.Invocation, monotonicMs = observedMs, root = observation.Describe(identity), threads = RootThreadStates(owned) });
            }
        } while (observation.Before.Status == WaitTimeout && observedMs < request.DeadlineMs);
        if (observation.Before.Status == WaitTimeout)
        {
            var beforeWaitMs = MonotonicMs();
            observation = ObserveProcess(handle, 0);
            observedMs = observation.QueryStartedMs;
            if (observation.Before.Status == WaitTimeout) lastRunningMs = beforeWaitMs;
            RecordEarlyExitStatus(observation);
        }
        var condition = observation.Before.Status;
        Write("watch-ended", new {
            request.Invocation, ending = condition == WaitSignaled ? "root-exited" : condition == WaitTimeout ? "original-deadline" : "wait-unavailable",
            monotonicMs = observedMs, lastRunningMs, request.DeadlineMs, root = observation.Describe(identity), waitStatus = condition,
        });
    }

    static int Main(string[] args)
    {
        var json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        Write("ready",new { pid = Environment.ProcessId });
        try
        {
            while (Console.ReadLine() is string line)
            {
                if (args is ["--invocation"])
                {
                    var invocationRequest = JsonSerializer.Deserialize<InvocationRequest>(line, json);
                    if (invocationRequest?.Kind == "clock" && Guid.TryParse(invocationRequest.Invocation?.Split('-', 2).LastOrDefault(), out _))
                        Write("clock", new { invocation = invocationRequest.Invocation, runnerSentElapsedMs = invocationRequest.RunnerSentElapsedMs, monotonicMs = MonotonicMs() });
                    else if (invocationRequest?.Kind == "watch")
                    {
                        WatchInvocation(invocationRequest);
                        break;
                    }
                    else Write("watch-invalid");
                    continue;
                }
                var request = JsonSerializer.Deserialize<WatchRequest>(line,json);
                if(request is null) { Write("watch-invalid"); continue; }
                Watch(request);
            }
        }
        catch (Exception error) { Write("observer-error",new { error = error.GetType().Name }); return 1; }
        Write("stopped");
        return 0;
    }
}
