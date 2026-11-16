# YENRA native DSH Host child process ONLY; secrets never enter renderer.
# Reuses Windows current-user DPAPI; does not write a second credential DB.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$p=Join-Path $env:LOCALAPPDATA 'YENRA\secrets\sendpulse-client.oauth.dpapi'
if(!(Test-Path $p)){throw 'SENDPULSE_DPAPI_NOT_CONFIGURED'}
$payload=[IO.File]::ReadAllBytes($p)
$clear=[Security.Cryptography.ProtectedData]::Unprotect(
  $payload,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$data=[Text.Encoding]::UTF8.GetString($clear)|ConvertFrom-Json
if([string]$data.clientId -notmatch '^sp_id_[a-z0-9]{24,60}$' -or
  [string]$data.clientSecret -notmatch '^sp_sk_[a-z0-9]{24,60}$' -or
  [string]$data.botId -notmatch '^[0-9a-f-]{18,64}$' -or
  [string]$data.pageId -notmatch '^\d{5,40}$'){
 throw 'SENDPULSE_PROTECTED_CREDENTIAL_STRUCTURE_INVALID'
}
# stdout is exclusively captured privately by the original Host reader;
# never invoke this script in an interactive visible console.
[Console]::Out.Write(($data|Select-Object clientId,clientSecret,botId,pageId|ConvertTo-Json -Compress))
