$ErrorActionPreference = 'Stop'

$version = '0.1.2'
$baseUrl = if ($env:SHRT_BASE_URL) { $env:SHRT_BASE_URL.TrimEnd('/') } else { 'https://antonveselskyi.com/shrt/downloads' }
$installRoot = if ($env:SHRT_INSTALL_DIR) { $env:SHRT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\shrt' }
$binDir = Join-Path $installRoot 'bin'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('shrt-install-' + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $archive = Join-Path $temporary "shrt-$version-windows-x64.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/shrt-$version-windows-x64.zip" -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $temporary

    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $temporary "shrt-$version-windows-x64\bin\shrt.exe") -Destination (Join-Path $binDir 'shrt.exe') -Force

    if ($env:SHRT_NO_PATH -ne '1') {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $parts = @($userPath -split ';' | Where-Object { $_ })
        if ($parts -notcontains $binDir) {
            [Environment]::SetEnvironmentVariable('Path', ((@($parts) + $binDir) -join ';'), 'User')
        }
    }

    Write-Host "Installed SHRT $version to $binDir"
    Write-Host 'Open a new terminal or restart your editor, then run: shrt --version'
}
finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
