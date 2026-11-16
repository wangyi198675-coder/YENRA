$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$p=Join-Path $env:LOCALAPPDATA 'YENRA\secrets\chatwoot-cloud-four-account-map.dpapi'
if(!(Test-Path -LiteralPath $p)){throw 'CLOUD_SCOPE_BINDING_NOT_INSTALLED'}
$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}
