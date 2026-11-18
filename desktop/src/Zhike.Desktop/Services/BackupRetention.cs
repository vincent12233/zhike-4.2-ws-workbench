using System.Globalization;
using System.Text.RegularExpressions;

namespace Zhike.Desktop.Services;

internal static class BackupRetention
{
    private const string Prefix = "知客自动备份_";
    private static readonly Regex ManagedName = new(
        @"^知客自动备份_[0-9]{8}_[0-9]{9}\.json$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    internal static string FileName(DateTimeOffset createdAt)
        => $"{Prefix}{createdAt.ToLocalTime().ToString("yyyyMMdd_HHmmssfff", CultureInfo.InvariantCulture)}.json";

    internal static void Retain(string directory, int keep)
    {
        var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var managed = Directory.EnumerateFiles(directory, $"{Prefix}*.json", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFullPath)
            .Where(path => path.StartsWith(root, StringComparison.OrdinalIgnoreCase)
                && ManagedName.IsMatch(Path.GetFileName(path)))
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .ThenByDescending(Path.GetFileName, StringComparer.Ordinal)
            .ToArray();
        foreach (var path in managed.Skip(Math.Clamp(keep, 3, 100)))
            try { File.Delete(path); } catch { }
    }
}
