using System.Net;
using System.Text;
using System.Text.Json;
using Zhike.Desktop.Services;

internal static class RestoreTransferChecks
{
    private sealed class RestoreHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => respond(request);
    }

    internal static async Task RunAsync(string root)
    {
        var directory = Directory.CreateDirectory(Path.Combine(root, "restore-transfers")).FullName;
        var transfer = new WorkspaceRestoreTransfer(directory);
        const string version = "58";
        var id = Guid.NewGuid().ToString();
        var json = "{\"name\":\"测试工作区🙂\"}";
        var bytes = Encoding.UTF8.GetBytes(json);
        var submissions = 0;
        using var handler = new RestoreHandler(async request =>
        {
            if (request.RequestUri?.AbsolutePath != "/api/workspace/restore" || request.Headers.GetValues("X-State-Version").Single() != version) throw new Exception("wrong restore route or state version");
            if (!(await request.Content!.ReadAsByteArrayAsync()).SequenceEqual(bytes)) throw new Exception("partial or altered UTF-8 restore");
            submissions++;
            return new HttpResponseMessage(HttpStatusCode.Conflict) { Content = new StringContent("""{"code":"WORKSPACE_RESTORE_REJECTED","error":"版本冲突"}""") };
        });
        using var client = new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1/") };
        Task<JsonElement> Post(Stream stream, string v, CancellationToken token) => WorkspaceRestoreTransfer.PostAsync(client, stream, v, token);
        Task<JsonElement> Part(string chunk, int offset, bool last = false) =>
            transfer.ReceiveAsync(JsonSerializer.SerializeToElement(new { transferId = id, offset, chunk, last, version }), Post, default);
        void AssertClean()
        {
            if (Directory.EnumerateFileSystemEntries(directory).Any()) throw new Exception("a plaintext restore file survived cleanup");
        }
        var split = json.IndexOf("🙂", StringComparison.Ordinal);
        await Part(json[..split], 0);
        try { await Part(json[split..], 0, true); throw new Exception("out-of-order part accepted"); }
        catch (InvalidDataException) { }
        try { await Part(json[split..], split, true); throw new Exception("restore rejection lost"); }
        catch (WorkspaceRestoreRejectedException e) when (e.Message == "版本冲突") { }
        if (submissions != 1) throw new Exception("restore was not dispatched exactly once");
        AssertClean();

        id = Guid.NewGuid().ToString();
        await Part("中", 0);
        var other = JsonSerializer.SerializeToElement(new { transferId = Guid.NewGuid(), discard = true });
        await transfer.ReceiveAsync(other, Post, default);
        await Part("文", 1);
        await transfer.ReceiveAsync(JsonSerializer.SerializeToElement(new { transferId = id, discard = true }), Post, default);
        AssertClean();
        try { await Part("🙂", 2, true); throw new Exception("discarded transfer was revived"); } catch (InvalidDataException) { }

        // 83 Mi UTF-16 Chinese characters encode to 249 MiB; ASCII fills the last MiB.
        var wide = new string('界', WorkspaceRestoreTransfer.ChunkChars);
        var offset = 0;
        for (int i = 0; i < 83; i++) { await Part(wide, offset); offset += wide.Length; }
        var ascii = new string('a', WorkspaceRestoreTransfer.ChunkChars);
        await Part(ascii, offset);
        try { await Part("🙂", offset + ascii.Length, true); throw new Exception("UTF-8 restore limit exceeded"); } catch (InvalidDataException) { }
        AssertClean();
        if (submissions != 1) throw new Exception("partial or oversized restore reached the sidecar");
        Console.WriteLine("native restore transfer: ordered UTF-8, 250 MiB ceiling, discard, rejection and temporary-file cleanup pass");
    }
}
