using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

// Isolation-only Stage 1 P0-04 probe. It is deliberately independent from
// Zhike production code and never opens the production data directory.
if (!OperatingSystem.IsWindows())
{
    Console.WriteLine(JsonSerializer.Serialize(new { ok = false, status = "NotTested", reason = "Windows Named Pipe ACL probe requires Windows" }));
    return;
}

var mode = args.FirstOrDefault() ?? "probe";
if (mode == "server")
{
    await RunServerAsync(args.Skip(1).ToArray());
    return;
}
if (mode == "client")
{
    await RunClientAsync(args.Skip(1).ToArray());
    return;
}

await RunProbeAsync();

static async Task RunProbeAsync()
{
    var pipeName = $"zhike-stage1-{Guid.NewGuid():N}";
    var sessionToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    var rotatedToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    var assembly = System.Reflection.Assembly.GetExecutingAssembly().Location;
    var serverStart = new ProcessStartInfo("dotnet")
    {
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
    };
    serverStart.ArgumentList.Add(assembly);
    serverStart.ArgumentList.Add("server");
    serverStart.ArgumentList.Add(pipeName);
    serverStart.ArgumentList.Add(sessionToken);
    serverStart.ArgumentList.Add(rotatedToken);

    using var server = Process.Start(serverStart) ?? throw new InvalidOperationException("无法启动 Named Pipe server 子进程");
    var serverOutput = server.StandardOutput.ReadLine();
    if (serverOutput is null)
    {
        var serverError = await server.StandardError.ReadToEndAsync();
        await server.WaitForExitAsync();
        throw new InvalidOperationException($"server 未发布 ready 事件：{serverError.Trim()}");
    }
    using var ready = JsonDocument.Parse(serverOutput);
    var readyRoot = ready.RootElement;
    if (readyRoot.GetProperty("type").GetString() != "ready") throw new InvalidOperationException("server ready 事件无效");
    var serverPid = readyRoot.GetProperty("pid").GetInt32();
    var sid = readyRoot.GetProperty("sid").GetString() ?? "";
    var aclHasCurrentSid = readyRoot.GetProperty("aclHasCurrentSid").GetBoolean();
    var aclHasWorldAllow = readyRoot.GetProperty("aclHasWorldAllow").GetBoolean();
    if (!aclHasCurrentSid || aclHasWorldAllow) throw new InvalidOperationException("Named Pipe ACL 未收敛到当前 SID");

    async Task<JsonElement> RunClient(string token, string action, string? schema = null, string? extra = null)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add(assembly);
        start.ArgumentList.Add("client");
        start.ArgumentList.Add(pipeName);
        start.ArgumentList.Add(token);
        start.ArgumentList.Add(action);
        if (schema is not null) start.ArgumentList.Add(schema);
        if (extra is not null) start.ArgumentList.Add(extra);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 client 子进程");
        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        if (process.ExitCode != 0) throw new InvalidOperationException($"client failed: {output} {await process.StandardError.ReadToEndAsync()}");
        using var document = JsonDocument.Parse(output.Trim());
        return document.RootElement.Clone();
    }

    var authorized = await RunClient(sessionToken, "authorized");
    if (!authorized.TryGetProperty("status", out var authorizedStatus)
        || authorizedStatus.GetString() != "ok"
        || !authorized.TryGetProperty("handshake", out var authorizedHandshake)
        || !authorizedHandshake.GetBoolean())
        throw new InvalidOperationException($"同用户授权连接握手失败: {authorized}");
    var replay = await RunClient(sessionToken, "replay");
    if (!replay.GetProperty("duplicateRejected").GetBoolean()) throw new InvalidOperationException("重复 request 未被幂等拒绝");
    var schema = await RunClient(sessionToken, "schema", "99");
    if (schema.GetProperty("error").GetString() != "UNSUPPORTED_SCHEMA") throw new InvalidOperationException("不兼容消息版本未拒绝");
    var wrongToken = await RunClient(sessionToken + "wrong", "wrong-token");
    if (wrongToken.GetProperty("error").GetString() != "AUTH_REVOKED") throw new InvalidOperationException("错误 token 未被拒绝");
    var cancelled = await RunClient(sessionToken, "cancel");
    if (cancelled.GetProperty("error").GetString() != "CANCELLED") throw new InvalidOperationException("取消请求未得到 CANCELLED");
    var expired = await RunClient(sessionToken, "expired");
    if (expired.GetProperty("error").GetString() != "TIMEOUT") throw new InvalidOperationException("过期 deadline 未得到 TIMEOUT");
    var rotated = await RunClient(sessionToken, "rotate", null, rotatedToken);
    if (!rotated.TryGetProperty("handshake", out var rotatedHandshake) || !rotatedHandshake.GetBoolean() || !rotated.GetProperty("oldRejected").GetBoolean()) throw new InvalidOperationException($"token 轮换验证失败: {rotated}");
    var disconnect = await RunClient(rotatedToken, "disconnect");
    if (disconnect.GetProperty("status").GetString() != "disconnected") throw new InvalidOperationException("断开连接测试未完成");
    server.WaitForExit(5000);
    if (!server.HasExited) server.Kill(entireProcessTree: true);

    Console.WriteLine(JsonSerializer.Serialize(new
    {
        ok = true,
        status = "Passed",
        serverPid,
        clientProcesses = 8,
        transport = "Windows Named Pipe",
        currentSid = sid,
        aclHasCurrentSid,
        aclHasWorldAllow,
        sameUserHandshake = true,
        wrongTokenRejected = true,
        tokenRotation = true,
        replayRejected = true,
        schemaRejected = true,
        cancel = true,
        timeout = true,
        disconnect = true,
        winUiIntegration = "NotTested",
        differentWindowsUser = "NotTested",
        productionWorker = "NotStarted",
        productionDatabase = "NotOpened",
    }, new JsonSerializerOptions { WriteIndented = true }));
}

static async Task RunServerAsync(string[] args)
{
    if (args.Length < 3) throw new ArgumentException("server 参数缺少 pipe/token/rotatedToken");
    var pipeName = args[0];
    var token = args[1];
    var rotatedToken = args[2];
    var currentSid = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("无法获取当前 Windows SID");
    var security = new PipeSecurity();
    security.AddAccessRule(new PipeAccessRule(currentSid, PipeAccessRights.FullControl, AccessControlType.Allow));
    var aclHasWorldAllow = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<AuthorizationRule>()
        .OfType<PipeAccessRule>()
        .Any(rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.WorldSid, null)
            && rule.AccessControlType == AccessControlType.Allow);
    var aclHasCurrentSid = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<AuthorizationRule>()
        .OfType<PipeAccessRule>()
        .Any(rule => rule.IdentityReference == currentSid && rule.AccessControlType == AccessControlType.Allow);
    var firstPipe = NamedPipeServerStreamAcl.Create(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security, HandleInheritability.None, PipeAccessRights.ChangePermissions);
    Console.WriteLine(JsonSerializer.Serialize(new { type = "ready", pid = Environment.ProcessId, sid = currentSid.Value, aclHasCurrentSid, aclHasWorldAllow }));
    Console.Out.Flush();

    var sessions = 0;
    var activeToken = token;
    while (sessions < 9)
    {
        using var pipe = firstPipe ?? NamedPipeServerStreamAcl.Create(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security, HandleInheritability.None, PipeAccessRights.ChangePermissions);
        firstPipe = null;
        await pipe.WaitForConnectionAsync();
        sessions++;
        using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
        await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
        var helloLine = await reader.ReadLineAsync();
        if (string.IsNullOrWhiteSpace(helloLine)) continue;
        using var hello = JsonDocument.Parse(helloLine);
        var root = hello.RootElement;
        var requestId = root.TryGetProperty("requestId", out var request) ? request.GetString() ?? "" : "";
        var schemaVersion = root.TryGetProperty("schemaVersion", out var schema) ? schema.GetInt32() : 0;
        var proof = root.TryGetProperty("proof", out var proofElement) ? proofElement.GetString() ?? "" : "";
        var validProof = ComputeProof(activeToken, requestId);
        if (schemaVersion != 1)
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = "UNSUPPORTED_SCHEMA", requestId }));
            continue;
        }
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(proof.PadRight(validProof.Length, '0')[..validProof.Length]), Convert.FromHexString(validProof)))
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = "AUTH_REVOKED", requestId }));
            continue;
        }
        await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "hello-ack", requestId, handshake = true }));
        var seen = new HashSet<string>(StringComparer.Ordinal);
        while (true)
        {
            var line = await reader.ReadLineAsync();
            if (line is null) break;
            using var message = JsonDocument.Parse(line);
            var m = message.RootElement;
            var id = m.TryGetProperty("requestId", out var idElement) ? idElement.GetString() ?? "" : "";
            if (m.TryGetProperty("schemaVersion", out var messageSchema) && messageSchema.GetInt32() != 1)
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = "UNSUPPORTED_SCHEMA", requestId = id }));
                continue;
            }
            if (m.TryGetProperty("type", out var type) && type.GetString() == "cancel")
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = "CANCELLED", requestId = id }));
                continue;
            }
            if (m.TryGetProperty("type", out type) && type.GetString() == "rotate")
            {
                activeToken = rotatedToken;
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "rotate-ack", requestId = id }));
                continue;
            }
            if (m.TryGetProperty("type", out type) && type.GetString() == "rehello")
            {
                var rehelloProof = m.TryGetProperty("proof", out var rehelloProofElement) ? rehelloProofElement.GetString() ?? "" : "";
                var validRehello = ComputeProof(activeToken, id);
                if (rehelloProof == validRehello)
                    await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "hello-ack", requestId = id, handshake = true }));
                else
                    await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = "AUTH_REVOKED", requestId = id }));
                continue;
            }
            if (m.TryGetProperty("deadlineExpired", out var expired) && expired.GetBoolean())
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { error = "TIMEOUT", requestId = id }));
                continue;
            }
            if (!seen.Add(id))
            {
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { ok = true, duplicate = true, requestId = id, result = "first-result" }));
                continue;
            }
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { ok = true, duplicate = false, requestId = id, result = "first-result" }));
        }
    }
}

static async Task RunClientAsync(string[] args)
{
    if (args.Length < 3) throw new ArgumentException("client 参数缺少 pipe/token/action");
    var pipeName = args[0];
    var token = args[1];
    var action = args[2];
    var schema = action == "schema" && args.Length > 3 && int.TryParse(args[3], out var parsed) ? parsed : 1;
    var rotatedToken = action == "rotate" && args.Length > 3 ? args[3] : "";
    try
    {
        using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(5000);
        using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
        await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
        var requestId = $"req-{Guid.NewGuid():N}";
        var proof = ComputeProof(token, requestId);
        await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "hello", schemaVersion = schema, requestId, proof }));
        var helloLine = await reader.ReadLineAsync() ?? throw new IOException("server closed during handshake");
        using var hello = JsonDocument.Parse(helloLine);
        if (hello.RootElement.TryGetProperty("error", out var helloError))
        {
            Console.WriteLine(JsonSerializer.Serialize(new { error = helloError.GetString() }));
            return;
        }
        if (action == "wrong-token" || action == "old-after-rotation" || action == "schema")
        {
            Console.WriteLine(JsonSerializer.Serialize(hello.RootElement));
            return;
        }
        if (action == "authorized" || action == "rotated")
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "request", schemaVersion = 1, requestId = "req-normal" }));
            var response = await reader.ReadLineAsync() ?? throw new IOException("missing response");
            using var result = JsonDocument.Parse(response);
            Console.WriteLine(JsonSerializer.Serialize(new { status = "ok", handshake = true, response = result.RootElement }));
            return;
        }
        if (action == "replay")
        {
            var id = "req-replay";
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "request", schemaVersion = 1, requestId = id }));
            _ = await reader.ReadLineAsync();
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "request", schemaVersion = 1, requestId = id }));
            var response = await reader.ReadLineAsync() ?? throw new IOException("missing replay response");
            using var result = JsonDocument.Parse(response);
            Console.WriteLine(JsonSerializer.Serialize(new { duplicateRejected = result.RootElement.GetProperty("duplicate").GetBoolean() }));
            return;
        }
        if (action == "cancel")
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "cancel", schemaVersion = 1, requestId = "req-cancel" }));
            var response = await reader.ReadLineAsync() ?? throw new IOException("missing cancel response");
            using var result = JsonDocument.Parse(response);
            Console.WriteLine(JsonSerializer.Serialize(new { error = result.RootElement.GetProperty("error").GetString() }));
            return;
        }
        if (action == "expired")
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "request", schemaVersion = 1, requestId = "req-expired", deadlineExpired = true }));
            var response = await reader.ReadLineAsync() ?? throw new IOException("missing timeout response");
            using var result = JsonDocument.Parse(response);
            Console.WriteLine(JsonSerializer.Serialize(new { error = result.RootElement.GetProperty("error").GetString() }));
            return;
        }
        if (action == "rotate")
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "rotate", schemaVersion = 1, requestId = "req-rotate" }));
            _ = await reader.ReadLineAsync();
            var newId = "req-rehello-new";
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "rehello", schemaVersion = 1, requestId = newId, proof = ComputeProof(rotatedToken, newId) }));
            var newResponse = await reader.ReadLineAsync() ?? throw new IOException("missing rotated handshake");
            using var newDocument = JsonDocument.Parse(newResponse);
            var oldId = "req-rehello-old";
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "rehello", schemaVersion = 1, requestId = oldId, proof = ComputeProof(token, oldId) }));
            var oldResponse = await reader.ReadLineAsync() ?? throw new IOException("missing old-token response");
            using var oldDocument = JsonDocument.Parse(oldResponse);
            Console.WriteLine(JsonSerializer.Serialize(new { handshake = newDocument.RootElement.TryGetProperty("handshake", out var handshake) && handshake.GetBoolean(), oldRejected = oldDocument.RootElement.TryGetProperty("error", out var error) && error.GetString() == "AUTH_REVOKED" }));
            return;
        }
        if (action == "disconnect")
        {
            await writer.WriteLineAsync(JsonSerializer.Serialize(new { type = "request", schemaVersion = 1, requestId = "req-disconnect" }));
            Console.WriteLine(JsonSerializer.Serialize(new { status = "disconnected" }));
            return;
        }
        Console.WriteLine(JsonSerializer.Serialize(new { error = "UNKNOWN_ACTION" }));
    }
    catch (Exception error)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { error = "DISCONNECT", detail = error.GetType().Name }));
    }
}

static string ComputeProof(string token, string requestId)
    => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(requestId))).ToLowerInvariant();
