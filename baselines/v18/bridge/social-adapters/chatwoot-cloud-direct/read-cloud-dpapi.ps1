$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$p=Join-Path $env:LOCALAPPDATA 'YENRA\secrets\chatwoot-cloud-personal-access-token.dpapi'
if(!(Test-Path $p)){throw 'CLOUD_TOKEN_NOT_PROVISIONED'}
$raw=[IO.File]::ReadAllBytes($p)
$plain=[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))}finally{[Array]::Clear($plain,0,$plain.Length)}
