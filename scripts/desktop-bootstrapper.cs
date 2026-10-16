using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class DesktopBootstrapper
{
    private const string ReleaseApi = "https://api.github.com/repos/nox122342-blip/Supremacy-War-Room/releases/latest";
    private const string AssetName = "Supremacy War Room Full Setup.exe";
    private const string DownloadPrefix = "https://github.com/nox122342-blip/Supremacy-War-Room/releases/download/";

    private sealed class ReleaseAsset
    {
        public long Size;
        public string Digest;
        public Uri DownloadUrl;
    }

    private static void Main()
    {
        try
        {
            Run();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine();
            Console.Error.WriteLine("Setup failed: " + error.Message);
            Console.Error.WriteLine();
            Console.Error.WriteLine("Press Enter to close this window.");
            Console.ReadLine();
            Environment.ExitCode = 1;
        }
    }

    private static void Run()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Console.WriteLine("Supremacy War Room setup");
        Console.WriteLine("Checking the latest GitHub release...");

        Dictionary<string, object> release = GetJson(ReleaseApi);
        string tag = GetString(release, "tag_name");
        ReleaseAsset asset = FindInstaller(release);
        string temporaryDirectory = Path.Combine(Path.GetTempPath(), "supremacy-war-room-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporaryDirectory);
        string installerPath = Path.Combine(temporaryDirectory, AssetName);

        try
        {
            Console.WriteLine("Latest release: " + tag);
            DownloadInstaller(asset, installerPath);
            Console.WriteLine("Download verified. Starting the Windows installer...");
            Process installer = Process.Start(new ProcessStartInfo
            {
                FileName = installerPath,
                UseShellExecute = true
            });
            if (installer == null)
                throw new InvalidOperationException("Windows did not start the downloaded installer.");
            installer.WaitForExit();
            if (installer.ExitCode != 0)
                throw new InvalidOperationException("The Windows installer exited with code " + installer.ExitCode + ".");
        }
        finally
        {
            try
            {
                if (Directory.Exists(temporaryDirectory))
                    Directory.Delete(temporaryDirectory, true);
            }
            catch (IOException error)
            {
                Console.Error.WriteLine("Could not remove the temporary download: " + error.Message);
            }
            catch (UnauthorizedAccessException error)
            {
                Console.Error.WriteLine("Could not remove the temporary download: " + error.Message);
            }
        }
    }

    private static Dictionary<string, object> GetJson(string url)
    {
        HttpWebRequest request = CreateRequest(new Uri(url));
        request.Accept = "application/vnd.github+json";
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        using (HttpWebResponse response = GetResponse(request, "Could not contact GitHub"))
        {
            if (response.StatusCode != HttpStatusCode.OK)
                throw new InvalidOperationException("GitHub returned HTTP " + (int)response.StatusCode + " while checking for the latest release.");
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = 4 * 1024 * 1024;
                object parsed = serializer.DeserializeObject(reader.ReadToEnd());
                Dictionary<string, object> result = parsed as Dictionary<string, object>;
                if (result == null)
                    throw new InvalidDataException("GitHub returned invalid release details.");
                return result;
            }
        }
    }

    private static ReleaseAsset FindInstaller(Dictionary<string, object> release)
    {
        object rawAssets;
        if (!release.TryGetValue("assets", out rawAssets))
            throw new InvalidDataException("The latest GitHub release has no assets.");
        IEnumerable assets = rawAssets as IEnumerable;
        if (assets == null || rawAssets is string)
            throw new InvalidDataException("GitHub returned an invalid release asset list.");

        foreach (object rawAsset in assets)
        {
            Dictionary<string, object> asset = rawAsset as Dictionary<string, object>;
            if (asset == null || GetString(asset, "name") != AssetName)
                continue;

            string digest = GetString(asset, "digest");
            long size;
            object rawSize;
            if (!asset.TryGetValue("size", out rawSize) || !long.TryParse(Convert.ToString(rawSize, CultureInfo.InvariantCulture), out size) || size <= 0)
                throw new InvalidDataException("GitHub did not provide the installer size.");
            if (digest == null || !digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase) || digest.Length != 7 + 64)
                throw new InvalidDataException("GitHub did not provide a valid SHA-256 digest for the installer.");

            Uri downloadUrl;
            if (!Uri.TryCreate(GetString(asset, "browser_download_url"), UriKind.Absolute, out downloadUrl) ||
                downloadUrl.Scheme != Uri.UriSchemeHttps ||
                !downloadUrl.AbsoluteUri.StartsWith(DownloadPrefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("GitHub provided an unexpected installer download URL.");

            return new ReleaseAsset { Size = size, Digest = digest.Substring(7), DownloadUrl = downloadUrl };
        }
        throw new FileNotFoundException("The latest GitHub release does not contain the full Windows installer yet.");
    }

    private static void DownloadInstaller(ReleaseAsset asset, string destination)
    {
        Uri downloadUrl = asset.DownloadUrl;
        HttpWebResponse response = null;
        for (int redirects = 0; redirects <= 10; redirects++)
        {
            HttpWebRequest request = CreateRequest(downloadUrl);
            request.AllowAutoRedirect = false;
            response = GetResponse(request, "Could not download the Windows installer");
            if ((int)response.StatusCode < 300 || (int)response.StatusCode >= 400)
                break;

            string location = response.Headers[HttpResponseHeader.Location];
            response.Close();
            response = null;
            Uri redirect;
            if (redirects == 10 || !Uri.TryCreate(downloadUrl, location, out redirect) || !IsAllowedDownloadHost(redirect))
                throw new InvalidOperationException("GitHub returned an unexpected download redirect.");
            downloadUrl = redirect;
        }

        if (response == null)
            throw new InvalidOperationException("GitHub did not provide a downloadable installer.");
        using (response)
        {
            if (response.StatusCode != HttpStatusCode.OK)
                throw new InvalidOperationException("GitHub returned HTTP " + (int)response.StatusCode + " while downloading the installer.");
            if (response.ContentLength >= 0 && response.ContentLength != asset.Size)
                throw new InvalidDataException("The installer size does not match GitHub's release metadata.");

            using (Stream input = response.GetResponseStream())
            using (FileStream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                byte[] buffer = new byte[64 * 1024];
                long received = 0;
                int count;
                while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    output.Write(buffer, 0, count);
                    received += count;
                    Console.Write("\rDownloading latest release: {0,3}% ({1} / {2} MB)",
                        Math.Min(100, (int)(received * 100 / asset.Size)),
                        received / (1024 * 1024),
                        asset.Size / (1024 * 1024));
                }
                output.Flush(true);
                if (received != asset.Size)
                    throw new EndOfStreamException("The installer download was incomplete.");
            }
        }

        string actualDigest;
        using (SHA256 sha = SHA256.Create())
        using (FileStream installer = File.OpenRead(destination))
        {
            actualDigest = BitConverter.ToString(sha.ComputeHash(installer)).Replace("-", "").ToLowerInvariant();
        }
        if (!String.Equals(actualDigest, asset.Digest, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The installer SHA-256 check failed; the downloaded file was not run.");
        Console.WriteLine();
    }

    private static bool IsAllowedDownloadHost(Uri url)
    {
        if (url.Scheme != Uri.UriSchemeHttps)
            return false;
        string host = url.Host.ToLowerInvariant();
        return host == "github.com" ||
            host == "release-assets.githubusercontent.com" ||
            host == "objects.githubusercontent.com" ||
            host == "github-releases.githubusercontent.com";
    }

    private static HttpWebRequest CreateRequest(Uri url)
    {
        if (!IsAllowedDownloadHost(url) && url.AbsoluteUri != ReleaseApi)
            throw new InvalidOperationException("Refusing a non-GitHub HTTPS request.");
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.UserAgent = "Supremacy-War-Room-Installer";
        request.Timeout = 1200000;
        request.ReadWriteTimeout = 120000;
        return request;
    }

    private static HttpWebResponse GetResponse(HttpWebRequest request, string errorPrefix)
    {
        try
        {
            return (HttpWebResponse)request.GetResponse();
        }
        catch (WebException error)
        {
            HttpWebResponse response = error.Response as HttpWebResponse;
            if (response != null)
            {
                HttpStatusCode status = response.StatusCode;
                response.Close();
                if (status == HttpStatusCode.NotFound)
                    throw new InvalidOperationException("No published GitHub Release was found yet. Publish a release before running this setup.", error);
                throw new InvalidOperationException(errorPrefix + ": GitHub returned HTTP " + (int)status + ".", error);
            }
            throw new InvalidOperationException(errorPrefix + ": " + error.Message, error);
        }
    }

    private static string GetString(Dictionary<string, object> values, string key)
    {
        object value;
        return values.TryGetValue(key, out value) ? value as string : null;
    }
}
