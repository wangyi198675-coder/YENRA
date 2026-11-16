param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$StageRoot,
  [Parameter(Mandatory=$true)][string]$FreezeDirectory
)
$ErrorActionPreference = 'Stop'
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$StageRoot = (Resolve-Path -LiteralPath $StageRoot).Path
$FreezeDirectory = (Resolve-Path -LiteralPath $FreezeDirectory).Path
$roots = @(
 'ui/chatwoot-embed/src',
 'ui/chatwoot-embed/desktop-integration-candidate/src',
 'ui/desktop-candidate/src',
 'social-adapters/chatwoot-bridge/src',
 'social-adapters/chatwoot-bridge/test',
 'social-adapters/chatwoot-cloud-direct',
 'social-adapters/kt-dedupe-native',
 'ui/personal-chrome',
 'ui/private-themes',
 'ui/typography-fix'
)
$manifests = @(
 'ui/chatwoot-embed/package.json','ui/chatwoot-embed/pnpm-lock.yaml',
 'ui/chatwoot-embed/tsconfig.json','ui/chatwoot-embed/tsdown.config.ts',
 'ui/chatwoot-embed/cordis.patch.yml','ui/chatwoot-embed/tools/yenra-native-sso.rb',
 'ui/chatwoot-embed/desktop-integration-candidate/tsdown.config.ts',
 'ui/chatwoot-embed/desktop-integration-candidate/src/legacy-persona/yeonhee-persona.ccv3.json',
 'ui/desktop-candidate/tsdown.config.ts','ui/desktop-candidate/pnpm-lock.yaml',
 'ui/desktop-candidate/stage-messaging-inbox-assets.mjs',
 'ui/chatwoot-embed/desktop-integration-candidate/package.json',
 'ui/chatwoot-embed/desktop-integration-candidate/pnpm-lock.yaml',
 'ui/chatwoot-embed/desktop-integration-candidate/cordis.patch.yml',
 'ui/desktop-candidate/package.json','ui/desktop-candidate/cordis.patch.yml',
 'social-adapters/chatwoot-bridge/package.json',
 'social-adapters/kt-dedupe-native/package.json',
 'social-adapters/kt-dedupe-native/package-lock.json',
 'ui/personal-chrome/package.json','ui/private-themes/package.json',
 'ui/typography-fix/package.json'
)
$denyNames = @(
 'owner-verified-page-avatar.test.mjs',
 'cloud-native-rightclick-dsh-translation-20261114.test.mjs',
 'contract.test.mjs',
 'webhook-identifier.test.mjs',
 'sendpulse-native-webhook.ts',
 'meta-ads-panel.tsx'
)
$allowedExtensions = @('.ts','.tsx','.js','.cjs','.mjs','.css','.scss','.less','.ps1')
$excludedSegments = '(?i)[\\/](node_modules|dist|build|coverage|lib|fixtures|screenshots|evidence|backup|backups|yenra-ui-backups|visual-theme-candidate|profiles?|artifacts|runtime|upstream)[\\/]'
$copy = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($rel in $roots) {
 $base = Join-Path $SourceRoot ($rel -replace '/','\')
 if(!(Test-Path -LiteralPath $base)){continue}
 foreach($f in (Get-ChildItem -LiteralPath $base -File -Recurse)) {
  $r = $f.FullName.Substring($SourceRoot.Length+1).Replace('\','/')
  if($r -match '(?i)^social-adapters/(kt-dedupe-native|chatwoot-bridge)/' -and $f.Name -match '(?i)^qa-'){continue}
  if($f.FullName -match $excludedSegments -or $denyNames -contains $f.Name){continue}
  if($allowedExtensions -notcontains $f.Extension -or $f.Length -gt 400000){continue}
  if($f.Name -match '(?i)(\.test\.mjs$|^qa-)') {
    $fixture = [IO.File]::ReadAllText($f.FullName)
    if($fixture -match '(?i)(\b(?:janko|ralf|schmeling|franco|vincenzo|marie|anna|lukas|tommaso)\b|(?<!\d)\+[1-9]\d{9,14}(?!\d)|\b(?:password|secret|accessToken|apiKey)\s*[:=]\s*[\x22\x27][A-Za-z0-9_.\-]{20,}[\x22\x27])'){continue}
  }
  [void]$copy.Add($r)
 }
}
foreach($rel in $manifests){if(Test-Path -LiteralPath (Join-Path $SourceRoot $rel)){[void]$copy.Add($rel)}}
$bm = Get-Content -Raw -LiteralPath (Join-Path $FreezeDirectory 'bridge/bridge-manifest.json') | ConvertFrom-Json
$freeze = Get-Content -Raw -LiteralPath (Join-Path $FreezeDirectory 'release-v18-freeze.json') | ConvertFrom-Json
foreach($entry in $bm.files){[void]$copy.Add($entry.file)}
foreach($prop in $freeze.latestFormalSourceSHA256.PSObject.Properties){[void]$copy.Add($prop.Name)}
$expected = [ordered]@{
 version = [string]$freeze.version
 status = 'source-import-not-reproducible-build'
 bridgeFiles = @()
 latestFormalSources = @()
}
foreach($entry in $bm.files){
 $expected.bridgeFiles += @{file=$entry.file;sha256=$entry.sha256;bytes=$entry.bytes}
}
foreach($prop in $freeze.latestFormalSourceSHA256.PSObject.Properties){
 $expected.latestFormalSources += @{file=$prop.Name;sha256=$prop.Value}
}
$counter = 0
foreach($rel in ($copy | Sort-Object)) {
 $file = Join-Path $SourceRoot ($rel -replace '/','\')
 if(!(Test-Path -LiteralPath $file)){throw "Missing frozen source: $rel"}
 if((Get-Item -LiteralPath $file).Length -gt 400000){throw "Oversized frozen source: $rel"}
 $dest = Join-Path $StageRoot ($rel -replace '/','\')
 $parent = Split-Path -Parent $dest
 if(!(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force | Out-Null}
 Copy-Item -LiteralPath $file -Destination $dest -Force
 $a = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($file)))
 $b = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($dest)))
 if($a -ne $b){throw "Copy mismatch: $rel"}
 $counter++
}
$docs = Join-Path $StageRoot 'docs'
if(!(Test-Path $docs)){New-Item -ItemType Directory -Path $docs -Force | Out-Null}
$expected | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $docs 'v18-source-hashes.json') -Encoding UTF8
Write-Output "COPIED_SOURCE_FILES=$counter"
Write-Output "V18_BRIDGE_FILE_COUNT=$($bm.files.Count)"
Write-Output "V18_FROZEN_LATEST_SOURCE_COUNT=$($freeze.latestFormalSourceSHA256.PSObject.Properties.Count)"
Write-Output "STAGING_ONLY=$StageRoot"
