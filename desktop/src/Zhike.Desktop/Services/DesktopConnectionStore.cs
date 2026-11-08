using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record DesktopConnection(string BaseUrl, string Token, string PairingApprovalCode = "");

public static class DesktopConnectionStore
{
    private static readonly string PathValue = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike", "desktop-connection.json");

    public static DesktopConnection? Load()
    {
        try
        {
            if (!File.Exists(PathValue)) return null;
            var row = JsonSerializer.Deserialize<Stored>(File.ReadAllText(PathValue));
            if (row is null || string.IsNullOrWhiteSpace(row.BaseUrl) || string.IsNullOrWhiteSpace(row.Token)) return null;
            return new DesktopConnection(row.BaseUrl, Unprotect(row.Token), string.IsNullOrWhiteSpace(row.PairingApprovalCode) ? "" : Unprotect(row.PairingApprovalCode));
        }
        catch { return null; }
    }

    public static void Save(DesktopConnection connection)
    {
        if (!Uri.TryCreate(connection.BaseUrl, UriKind.Absolute, out _)) throw new ArgumentException("BaseUrl must be an absolute URI", nameof(connection));
        if (string.IsNullOrWhiteSpace(connection.Token)) throw new ArgumentException("Token is required", nameof(connection));
        var directory = System.IO.Path.GetDirectoryName(PathValue)!;
        Directory.CreateDirectory(directory);
        var temporary = string.Concat(PathValue, ".", Guid.NewGuid().ToString("N"), ".tmp");
        var row = new Stored(connection.BaseUrl.TrimEnd('/'), Protect(connection.Token), string.IsNullOrWhiteSpace(connection.PairingApprovalCode) ? "" : Protect(connection.PairingApprovalCode));
        File.WriteAllText(temporary, JsonSerializer.Serialize(row));
        File.Move(temporary, PathValue, true);
    }

    public static void Clear()
    {
        try { if (File.Exists(PathValue)) File.Delete(PathValue); } catch { }
    }

    private static string Protect(string value) => Convert.ToBase64String(Dpapi.Transform(Encoding.UTF8.GetBytes(value), true));
    private static string Unprotect(string value) => Encoding.UTF8.GetString(Dpapi.Transform(Convert.FromBase64String(value), false));

    private sealed record Stored(string BaseUrl, string Token, string PairingApprovalCode);

    private static class Dpapi
    {
        [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public IntPtr Data; }
        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptProtectData(ref Blob dataIn, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob dataOut);
        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptUnprotectData(ref Blob dataIn, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob dataOut);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr handle);

        public static byte[] Transform(byte[] value, bool encrypt)
        {
            var handle = GCHandle.Alloc(value, GCHandleType.Pinned);
            try
            {
                var input = new Blob { Length = value.Length, Data = handle.AddrOfPinnedObject() };
                var output = new Blob();
                var ok = encrypt
                    ? CryptProtectData(ref input, "Zhike desktop connection", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref output)
                    : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref output);
                if (!ok) throw new CryptographicException(Marshal.GetLastWin32Error());
                try
                {
                    var result = new byte[output.Length];
                    Marshal.Copy(output.Data, result, 0, output.Length);
                    return result;
                }
                finally { if (output.Data != IntPtr.Zero) LocalFree(output.Data); }
            }
            finally { handle.Free(); }
        }
    }
}
