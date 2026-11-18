using Zhike.Desktop.Services;
using System.Text.Json;
using System.Text.Json.Nodes;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var root = Path.Combine(Path.GetTempPath(), $"zhike-backup-retention-{Guid.NewGuid():N}");
Directory.CreateDirectory(root);
try
{
    var generated = BackupRetention.FileName(new DateTimeOffset(2026, 11, 14, 10, 30, 20, TimeSpan.Zero));
    Check(generated.StartsWith("知客自动备份_", StringComparison.Ordinal) && generated.EndsWith(".json", StringComparison.Ordinal),
        "generated backup name must use the managed format");

    var managed = Enumerable.Range(1, 5)
        .Select(index => Path.Combine(root, $"知客自动备份_20261114_00000000{index}.json"))
        .ToArray();
    for (var index = 0; index < managed.Length; index++)
    {
        File.WriteAllText(managed[index], $"backup {index}");
        File.SetLastWriteTimeUtc(managed[index], new DateTime(2026, 11, 14, 0, index, 0, DateTimeKind.Utc));
    }
    var unrelated = new[]
    {
        Path.Combine(root, "知客自动备份_重要客户.json"),
        Path.Combine(root, "知客自动备份_20261114_000000001-人工留存.json"),
        Path.Combine(root, "客户资料.json"),
    };
    foreach (var path in unrelated) File.WriteAllText(path, "do not delete");
    var child = Path.Combine(root, "manual-subfolder");
    Directory.CreateDirectory(child);
    var nested = Path.Combine(child, "知客自动备份_20261114_000000001.json");
    File.WriteAllText(nested, "do not delete");

    BackupRetention.Retain(root, 3);
    Check(!File.Exists(managed[0]) && !File.Exists(managed[1]), "only the two oldest generated backups should be pruned");
    Check(managed.Skip(2).All(File.Exists), "three newest generated backups must remain");
    Check(unrelated.All(File.Exists) && File.Exists(nested), "unrelated or nested files must remain untouched");

    var accountStore = new WsAccountStore(Path.Combine(root, "isolated-ws-account-index"));
    await accountStore.SaveAsync([new StoredWsAccount("default", "Default", "未连接"), new StoredWsAccount("test-account", "Isolated second account", "未连接")]);
    var visibleAccounts = await accountStore.LoadAsync();
    Check(visibleAccounts.Count == 2 && visibleAccounts.Any(account => account.Id == "test-account"), "restored account registry must show the second account");

    BackupRetention.Retain(root, 0);
    Check(managed.Skip(2).All(File.Exists), "invalid keep value must clamp to three backups");
    Console.WriteLine("native backup retention: exact generated names, unrelated files, nested files and keep floor pass");

    var wsAccount = new JsonObject
    {
        ["settings"] = new JsonArray(), ["conversations"] = new JsonArray(), ["messages"] = new JsonArray(),
        ["analyses"] = new JsonArray(), ["replies"] = new JsonArray(), ["batches"] = new JsonArray(),
        ["collectionRuns"] = new JsonArray(), ["collectionItems"] = new JsonArray(), ["followupAlerts"] = new JsonArray(),
    };
    NativeBackupEnvelope.ValidateWsAccount(wsAccount);
    NativeBackupEnvelope.ValidateAccountIds(["default", "test-account"]);
    string?[][] invalidAccountLists = [[], ["test-account"], ["default", "DEFAULT"], ["default", null]];
    foreach (var invalidIds in invalidAccountLists)
    {
        try { NativeBackupEnvelope.ValidateAccountIds(invalidIds); throw new InvalidOperationException("invalid WS account list was accepted"); }
        catch (InvalidDataException) { }
    }
    try { NativeBackupEnvelope.ValidateAccountIds(null); throw new InvalidOperationException("unavailable WS account list was accepted"); }
    catch (InvalidDataException) { }
    var missingList = wsAccount.DeepClone().AsObject();
    missingList.Remove("messages");
    try { NativeBackupEnvelope.ValidateWsAccount(missingList); throw new InvalidOperationException("missing WS list was accepted"); }
    catch (InvalidDataException) { }
    var oversizedList = wsAccount.DeepClone().AsObject();
    var rows = oversizedList["conversations"]!.AsArray();
    for (var index = 0; index < 5_001; index++) rows.Add(new JsonObject());
    try { NativeBackupEnvelope.ValidateWsAccount(oversizedList); throw new InvalidOperationException("over-limit WS list was accepted"); }
    catch (InvalidDataException) { }

    var defaultWs = wsAccount.DeepClone().AsObject();
    defaultWs["schemaVersion"] = 6;
    defaultWs["conversations"] = new JsonArray(new JsonObject
    {
        ["id"] = "WS-DEFAULT-C1", ["externalId"] = "wa-default-c1", ["title"] = "Default test chat", ["customerId"] = "C123",
    });
    defaultWs["messages"] = new JsonArray(new JsonObject
    {
        ["id"] = "MSG-DEFAULT-1", ["conversationId"] = "WS-DEFAULT-C1", ["externalId"] = "wa-default-message-1",
        ["direction"] = "receive", ["originalText"] = "Hello from isolated default account", ["order"] = 1,
    });
    var secondWs = wsAccount.DeepClone().AsObject();
    secondWs["schemaVersion"] = 6;
    secondWs["conversations"] = new JsonArray(new JsonObject
    {
        ["id"] = "WS-SECOND-C1", ["externalId"] = "wa-second-c1", ["title"] = "Second test chat", ["customerId"] = "C123",
    });
    secondWs["messages"] = new JsonArray(new JsonObject
    {
        ["id"] = "MSG-SECOND-1", ["conversationId"] = "WS-SECOND-C1", ["externalId"] = "wa-second-message-1",
        ["direction"] = "send", ["originalText"] = "Reply from isolated second account", ["order"] = 1,
    });
    NativeBackupEnvelope.ValidateWsAccount(defaultWs);
    NativeBackupEnvelope.ValidateWsAccount(secondWs);

    var state = new JsonObject
    {
        ["backupFormat"] = "zhike-6-workspace", ["version"] = 6, ["schemaVersion"] = 5, ["productVersion"] = "6.0.3",
        ["createdAt"] = "2026-11-14T10:30:20Z",
        ["customers"] = new JsonArray(new JsonObject { ["id"] = "C123", ["name"] = "Isolated test customer", ["phone"] = "1234567890" }),
        ["wsAccounts"] = new JsonObject { ["default"] = defaultWs.DeepClone(), ["test-account"] = secondWs.DeepClone() },
        ["wsAccountMetadata"] = new JsonArray(new JsonObject { ["id"] = "test-account", ["displayName"] = "Isolated second account" }),
        ["ws"] = defaultWs.DeepClone(),
    };
    NativeBackupEnvelope.ValidateWorkspace(state);
    var envelopeBytes = NativeBackupEnvelope.Create(state, new JsonSerializerOptions { WriteIndented = true });
    Check(envelopeBytes.Length > 0, "native envelope was empty");
    Console.WriteLine("native backup envelope: workspace, WS shape and row limits pass");
    if (args.Contains("--emit-envelope", StringComparer.Ordinal))
        Console.WriteLine("ENVELOPE:" + Convert.ToBase64String(envelopeBytes));
}
finally
{
    var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (root.StartsWith(temp, StringComparison.OrdinalIgnoreCase)
        && Path.GetFileName(root).StartsWith("zhike-backup-retention-", StringComparison.Ordinal)
        && Directory.Exists(root))
        Directory.Delete(root, recursive: true);
}
