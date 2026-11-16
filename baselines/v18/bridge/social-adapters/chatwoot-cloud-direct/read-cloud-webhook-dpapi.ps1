$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$p=Join-Path $env:LOCALAPPDATA 'YENRA\secrets\chatwoot-cloud-account-webhook.dpapi'
if(!(Test-Path -LiteralPath $p)){throw 'CLOUD_WEBHOOK_SECRET_NOT_INSTALLED'}
$data=[IO.File]::ReadAllBytes($p)
$bytes=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))}finally{[Array]::Clear($bytes,0,$bytes.Length)}
