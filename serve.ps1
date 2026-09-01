# Static preview of the front-end on http://localhost:8080/
# (the /api/* routes only run on Vercel or via `vercel dev`; here they 404 and the
#  app falls back to this-device-only storage)
$port = 8080
$root = $PSScriptRoot
$types = @{ ".html"="text/html; charset=utf-8"; ".json"="application/json; charset=utf-8";
           ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".svg"="image/svg+xml";
           ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".png"="image/png"; ".webp"="image/webp" }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
$l.Start()
Write-Host "Serving $root on http://localhost:$port/"
while ($l.IsListening) {
    $ctx = $l.GetContext()
    $p = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart("/"))
    if ($p -eq "") { $p = "index.html" }
    $f = Join-Path $root $p
    try {
        if (Test-Path $f -PathType Leaf) {
            $b = [System.IO.File]::ReadAllBytes($f)
            $e = [System.IO.Path]::GetExtension($f).ToLower()
            $ctx.Response.ContentType = if ($types.ContainsKey($e)) { $types[$e] } else { "application/octet-stream" }
            $ctx.Response.OutputStream.Write($b, 0, $b.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
    } catch { $ctx.Response.StatusCode = 500 }
    $ctx.Response.OutputStream.Close()
}
