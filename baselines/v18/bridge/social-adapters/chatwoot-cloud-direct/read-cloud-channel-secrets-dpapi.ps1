$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$p=Join-Path $env:LOCALAPPDATA 'YENRA\secrets\chatwoot-cloud-api-channel-secrets.dpapi'
if(!(Test-Path $p)){throw 'CLOUD_CHANNEL_SECRET_MAP_NOT_INSTALLED'}
$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}
