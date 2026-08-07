[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..')).TrimEnd([IO.Path]::DirectorySeparatorChar)
$testRoot = [IO.Path]::Combine($repoRoot, '.tmp', 'host-stability-narrow-v1', 'test')
$receiptDirectory = [IO.Path]::Combine($repoRoot, '.tmp', 'host-command')
$receiptPath = [IO.Path]::Combine($receiptDirectory, 'current.json')
$pendingPath = "$receiptPath.pending"
$shim = [IO.Path]::Combine($PSScriptRoot, 'shuhai-command.cjs')
$sessionGuard = [IO.Path]::Combine($PSScriptRoot, 'assert-session.cjs')
$invokeScript = [IO.Path]::Combine($PSScriptRoot, 'Invoke-ShuHaiBoundedCommand.ps1')
$registryPath = [IO.Path]::Combine($PSScriptRoot, 'host-command-registry.json')
$node = (Get-Command -Name 'node.exe' -CommandType Application | Select-Object -First 1).Source
$utf8 = [Text.UTF8Encoding]::new($false)
$results = [Collections.Generic.List[object]]::new()
$ownedNames = [Collections.Generic.List[string]]::new()
$pendingSentinelIdentity = $null

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "assertion_failed:$Message" }
}

function Add-CaseResult {
    param([string]$Id, [string]$Command, [int]$ExitCode, [string]$Detail)
    $results.Add([pscustomobject]@{
        id = $Id
        command = $Command
        exitCode = $ExitCode
        result = 'PASS'
        detail = $Detail
    })
}

function Initialize-SafeTestRoot {
    $absoluteRepo = [IO.Path]::GetFullPath($repoRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $absoluteTest = [IO.Path]::GetFullPath($testRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $repoPrefix = $absoluteRepo + [IO.Path]::DirectorySeparatorChar
    if (-not $absoluteTest.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'test_root_escape'
    }
    $relative = [IO.Path]::GetRelativePath($absoluteRepo, $absoluteTest)
    $expected = [IO.Path]::Combine('.tmp', 'host-stability-narrow-v1', 'test')
    if ($relative -cne $expected) { throw 'test_root_identity_invalid' }

    $repoItem = Get-Item -LiteralPath $absoluteRepo -Force
    if (-not $repoItem.PSIsContainer -or
        ($repoItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'repo_root_reparse_forbidden'
    }
    $current = $absoluteRepo
    foreach ($part in $relative.Split([IO.Path]::DirectorySeparatorChar)) {
        if ([string]::IsNullOrEmpty($part)) { throw 'test_root_segment_invalid' }
        $current = [IO.Path]::Combine($current, $part)
        if ([IO.File]::Exists($current)) { throw 'test_root_segment_not_directory' }
        $item = if ([IO.Directory]::Exists($current)) {
            Get-Item -LiteralPath $current -Force
        }
        else {
            [IO.Directory]::CreateDirectory($current)
        }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'test_root_parent_reparse_forbidden'
        }
    }
}

function Assert-ContainedTestPath {
    param([string]$Path)
    $absolute = [IO.Path]::GetFullPath($Path)
    $prefix = $testRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'test_path_escape'
    }
    $relative = [IO.Path]::GetRelativePath($testRoot, $absolute)
    $current = $testRoot
    foreach ($part in $relative.Split([IO.Path]::DirectorySeparatorChar)) {
        if ([string]::IsNullOrEmpty($part)) { continue }
        $current = [IO.Path]::Combine($current, $part)
        if ([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'test_path_reparse_forbidden'
            }
        }
    }
    return $absolute
}

function Remove-OwnedFile {
    param([string]$Name)
    $path = Assert-ContainedTestPath ([IO.Path]::Combine($testRoot, $Name))
    if ([IO.File]::Exists($path)) { Remove-Item -LiteralPath $path -Force }
}

function Add-OwnedName {
    param([string]$Name)
    if (-not $ownedNames.Contains($Name)) { $ownedNames.Add($Name) }
    return (Assert-ContainedTestPath ([IO.Path]::Combine($testRoot, $Name)))
}

function Get-JsonLine {
    param([string[]]$Lines)
    for ($index = @($Lines).Count - 1; $index -ge 0; $index--) {
        $line = @($Lines)[$index]
        $text = [string]$line
        if ($text.TrimStart().StartsWith('{')) {
            try { return ($text | ConvertFrom-Json) } catch { }
        }
    }
    throw 'bounded_summary_missing'
}

function Invoke-Operation {
    param([string]$Operation, [string[]]$Arguments = @())
    $lines = @(& $node $shim $Operation @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    $code = $LASTEXITCODE
    return [pscustomobject]@{
        code = $code
        payload = Get-JsonLine $lines
        output = ($lines -join "`n")
    }
}

function Get-Receipt {
    Assert-True ([IO.File]::Exists($receiptPath)) 'receipt_missing'
    $bytes = [IO.File]::ReadAllBytes($receiptPath)
    Assert-True ($bytes.Length -le 32768) 'receipt_over_32kib'
    return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
}

function Get-FileIdentity {
    param([string]$Path)
    Assert-True ([IO.File]::Exists($Path)) "identity_file_missing_$Path"
    $bytes = [IO.File]::ReadAllBytes($Path)
    return [pscustomobject]@{
        length = $bytes.Length
        base64 = [Convert]::ToBase64String($bytes)
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }
}

function Assert-FileIdentity {
    param([string]$Path, $Expected, [string]$Message)
    $actual = Get-FileIdentity $Path
    Assert-True ($actual.length -eq $Expected.length) "${Message}_length"
    Assert-True ($actual.base64 -ceq $Expected.base64) "${Message}_bytes"
    Assert-True ($actual.sha256 -ceq $Expected.sha256) "${Message}_sha256"
}

function New-HarnessPendingSentinel {
    Assert-True (-not [IO.File]::Exists($pendingPath) -and -not [IO.Directory]::Exists($pendingPath)) 'pending_preexisting'
    $bytes = $utf8.GetBytes("goal048-case8-foreign-pending-v1`n")
    $stream = [IO.FileStream]::new($pendingPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
    $script:pendingSentinelIdentity = Get-FileIdentity $pendingPath
    return $script:pendingSentinelIdentity
}

function Remove-HarnessPendingSentinel {
    if ($null -eq $script:pendingSentinelIdentity) { return }
    $item = Get-Item -LiteralPath $pendingPath -Force
    Assert-True (-not $item.PSIsContainer -and
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'pending_sentinel_cleanup_type'
    Assert-FileIdentity $pendingPath $script:pendingSentinelIdentity 'pending_sentinel_cleanup_identity'
    [IO.File]::Delete($pendingPath)
    Assert-True (-not [IO.File]::Exists($pendingPath) -and -not [IO.Directory]::Exists($pendingPath)) 'pending_sentinel_cleanup_failed'
    $script:pendingSentinelIdentity = $null
}

function Assert-CleanupReceipt {
    param($Receipt, [bool]$ExactlyOnce = $false)
    Assert-True ($Receipt.JobEmpty -eq $true) 'job_not_empty'
    Assert-True ($Receipt.finalOwnedPIDCount -eq 0) 'owned_pid_nonzero'
    Assert-True ($Receipt.finalOwnedTCPPortCount -eq 0) 'owned_tcp_nonzero'
    Assert-True ($Receipt.finalOwnedUDPPortCount -eq 0) 'owned_udp_nonzero'
    Assert-True ($Receipt.readersJoined -eq $true) 'reader_join_unproven'
    Assert-True ($Receipt.handleObligationsProven -eq $true) 'handle_obligation_unproven'
    Assert-True ($Receipt.ledgerProven -eq $true) 'ledger_unproven'
    Assert-True ($Receipt.unprovenObligationCount -eq 0) 'unproven_obligation_nonzero'
    Assert-True ($Receipt.secondaryCleanupErrors -eq 0) 'secondary_cleanup_error_nonzero'
    if ($ExactlyOnce) { Assert-True ($Receipt.cleanupInvocations -eq 1) 'cleanup_not_exactly_once' }
}

function Assert-MarkerGone {
    param([string]$Name)
    $marker = Assert-ContainedTestPath ([IO.Path]::Combine($testRoot, $Name))
    Assert-True ([IO.File]::Exists($marker)) "marker_missing_$Name"
    $payload = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    Start-Sleep -Milliseconds 150
    foreach ($pidValue in @([int]$payload.pid, [int]$payload.parentPid)) {
        Assert-True ($null -eq (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) "pid_alive_$pidValue"
    }
    $properties = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
    $tcpPorts = @($properties.GetActiveTcpListeners() | ForEach-Object { $_.Port })
    $udpPorts = @($properties.GetActiveUdpListeners() | ForEach-Object { $_.Port })
    Assert-True ($tcpPorts -notcontains [int]$payload.tcpPort) "tcp_port_alive_$($payload.tcpPort)"
    Assert-True ($udpPorts -notcontains [int]$payload.udpPort) "udp_port_alive_$($payload.udpPort)"
}

function Write-RegistryVariant {
    param([string]$Name, [scriptblock]$Mutate)
    $path = Add-OwnedName $Name
    $value = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
    & $Mutate $value
    [IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Depth 30), $utf8)
    return $path
}

function Invoke-RegistryValidation {
    param([string]$Path)
    $lines = @(& $node $shim --validate-registry $Path 2>&1 | ForEach-Object { $_.ToString() })
    return [pscustomobject]@{ code = $LASTEXITCODE; payload = Get-JsonLine $lines }
}

function Invoke-DynamicPolicyValidation {
    param([string]$Policy, [string[]]$Arguments)
    $serialized = ConvertTo-Json -InputObject ([string[]]$Arguments) -Compress
    $probe = 'const router=require(process.argv[1]);try{router.validateDynamicArgs(process.argv[2],JSON.parse(process.argv[3]));process.exitCode=0}catch{process.exitCode=64}'
    & $node -e $probe $shim $Policy $serialized 2>$null
    return $LASTEXITCODE
}

function Invoke-SealedDynamicPolicyValidation {
    param([string]$Policy, [string[]]$Arguments)
    $serialized = ConvertTo-Json -InputObject ([string[]]$Arguments) -Compress
    $probe = 'const guard=require(process.argv[1]);try{guard.validateSealedDynamicArgs({dynamicArgPolicy:process.argv[2]},JSON.parse(process.argv[3]));process.exitCode=0}catch{process.exitCode=64}'
    & $node -e $probe $sessionGuard $Policy $serialized 2>$null
    return $LASTEXITCODE
}

function Invoke-PowerShellDynamicPolicyValidation {
    param([string]$Policy, [string[]]$Arguments)
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($invokeScript, [ref]$tokens, [ref]$errors)
    if (@($errors).Count -ne 0) { throw 'powershell_policy_source_parse_failed' }
    $functionAst = $ast.Find({
        param($nodeAst)
        $nodeAst -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $nodeAst.Name -ceq 'Assert-DynamicArguments'
    }, $true)
    if ($null -eq $functionAst) { throw 'powershell_policy_function_missing' }
    . ([scriptblock]::Create($functionAst.Extent.Text))
    try {
        Assert-DynamicArguments -Policy $Policy -Arguments $Arguments -Root $repoRoot
        return 0
    }
    catch {
        return 64
    }
}

function Assert-DynamicPolicyAcrossLayers {
    param(
        [string]$Policy,
        [string[]]$Arguments,
        [int]$Expected,
        [string]$Message
    )
    $codes = @(
        (Invoke-DynamicPolicyValidation $Policy $Arguments),
        (Invoke-PowerShellDynamicPolicyValidation $Policy $Arguments),
        (Invoke-SealedDynamicPolicyValidation $Policy $Arguments)
    )
    Assert-True ($codes.Count -eq 3) "${Message}_layer_count"
    foreach ($code in $codes) { Assert-True ($code -eq $Expected) $Message }
}

function Assert-StringArrayEquals {
    param($Actual, [string[]]$Expected, [string]$Message)
    $actualValues = @($Actual | ForEach-Object { [string]$_ })
    Assert-True ($actualValues.Count -eq $Expected.Count) "${Message}_count"
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        Assert-True ($actualValues[$index] -ceq $Expected[$index]) "${Message}_$index"
    }
}

function Assert-PropertyNamesExactly {
    param($Object, [string[]]$Expected, [string]$Message)
    $actualNames = @($Object.PSObject.Properties | ForEach-Object { [string]$_.Name } | Sort-Object -CaseSensitive)
    $expectedNames = @($Expected | Sort-Object -CaseSensitive)
    Assert-StringArrayEquals $actualNames $expectedNames $Message
}

function Get-SourceSlice {
    param([string]$Source, [string]$StartToken, [string]$EndToken, [string]$Message)
    $start = $Source.IndexOf($StartToken, [StringComparison]::Ordinal)
    Assert-True ($start -ge 0) "${Message}_start_missing"
    $end = $Source.IndexOf($EndToken, $start + $StartToken.Length, [StringComparison]::Ordinal)
    Assert-True ($end -gt $start) "${Message}_end_missing"
    return $Source.Substring($start, $end - $start)
}

function Assert-SourceOrder {
    param([string]$Source, [string[]]$Tokens, [string]$Message)
    $cursor = 0
    for ($index = 0; $index -lt $Tokens.Count; $index++) {
        $position = $Source.IndexOf($Tokens[$index], $cursor, [StringComparison]::Ordinal)
        Assert-True ($position -ge $cursor) "${Message}_$index"
        $cursor = $position + $Tokens[$index].Length
    }
}

function Assert-OperationDefinition {
    param(
        $Registry,
        [string]$Id,
        [string]$Profile,
        [string]$Raw,
        [string[]]$Allowed,
        [string]$Policy = ''
    )
    $operation = Get-NamedProperty $Registry.operations $Id
    $properties = @('profile', 'rawOperation', 'allowedRaw')
    if ($Policy -cne '') { $properties += 'dynamicArgPolicy' }
    Assert-PropertyNamesExactly $operation $properties "operation_properties_$Id"
    Assert-True ([string]$operation.profile -ceq $Profile) "operation_profile_$Id"
    Assert-True ([string]$operation.rawOperation -ceq $Raw) "operation_raw_$Id"
    Assert-StringArrayEquals $operation.allowedRaw $Allowed "operation_allowed_$Id"
    $actualPolicy = if ($null -eq $operation.PSObject.Properties['dynamicArgPolicy']) { '' } else { [string]$operation.dynamicArgPolicy }
    Assert-True ($actualPolicy -ceq $Policy) "operation_policy_$Id"
}

function Assert-RawPnpmDefinition {
    param(
        $Registry,
        [string]$Id,
        [string[]]$Arguments,
        [string]$Policy = '',
        [bool]$Append = $false,
        [bool]$CiLifecycle = $false
    )
    $raw = Get-NamedProperty $Registry.rawOperations $Id
    $properties = @('kind', 'args')
    if ($Policy -cne '') { $properties += 'dynamicArgPolicy' }
    if ($Append) { $properties += 'appendDynamicArgs' }
    if ($CiLifecycle) { $properties += 'ciLifecycle' }
    Assert-PropertyNamesExactly $raw $properties "raw_properties_$Id"
    Assert-True ([string]$raw.kind -ceq 'pnpm') "raw_kind_$Id"
    Assert-StringArrayEquals $raw.args $Arguments "raw_args_$Id"
    $actualPolicy = if ($null -eq $raw.PSObject.Properties['dynamicArgPolicy']) { '' } else { [string]$raw.dynamicArgPolicy }
    Assert-True ($actualPolicy -ceq $Policy) "raw_policy_$Id"
    Assert-True (($null -ne $raw.PSObject.Properties['appendDynamicArgs']) -eq $Append) "raw_append_$Id"
    Assert-True (($null -ne $raw.PSObject.Properties['ciLifecycle']) -eq $CiLifecycle) "raw_ci_lifecycle_$Id"
}

function Assert-RawSequenceDefinition {
    param($Registry, [string]$Id, [object[]]$Steps, [string]$Policy = '')
    $raw = Get-NamedProperty $Registry.rawOperations $Id
    $properties = @('kind', 'steps')
    if ($Policy -cne '') { $properties += 'dynamicArgPolicy' }
    Assert-PropertyNamesExactly $raw $properties "raw_properties_$Id"
    Assert-True ([string]$raw.kind -ceq 'sequence') "raw_kind_$Id"
    $actualPolicy = if ($null -eq $raw.PSObject.Properties['dynamicArgPolicy']) { '' } else { [string]$raw.dynamicArgPolicy }
    Assert-True ($actualPolicy -ceq $Policy) "raw_policy_$Id"
    $actualSteps = @($raw.steps)
    Assert-True ($actualSteps.Count -eq $Steps.Count) "raw_step_count_$Id"
    for ($index = 0; $index -lt $Steps.Count; $index++) {
        $expectedStep = $Steps[$index]
        $append = $expectedStep.append -eq $true
        $stepProperties = @('kind', 'args')
        if ($append) { $stepProperties += 'appendDynamicArgs' }
        Assert-PropertyNamesExactly $actualSteps[$index] $stepProperties "raw_step_properties_${Id}_$index"
        Assert-True ([string]$actualSteps[$index].kind -ceq 'pnpm') "raw_step_kind_${Id}_$index"
        Assert-StringArrayEquals $actualSteps[$index].args ([string[]]$expectedStep.args) "raw_step_args_${Id}_$index"
        Assert-True (($null -ne $actualSteps[$index].PSObject.Properties['appendDynamicArgs']) -eq $append) "raw_step_append_${Id}_$index"
    }
}

function Assert-RawNoopDefinition {
    param($Registry, [string]$Id, [bool]$CiLifecycle)
    $raw = Get-NamedProperty $Registry.rawOperations $Id
    $properties = @('kind')
    if ($CiLifecycle) { $properties += 'ciLifecycle' }
    Assert-PropertyNamesExactly $raw $properties "raw_properties_$Id"
    Assert-True ([string]$raw.kind -ceq 'noop') "raw_kind_$Id"
    Assert-True (($null -ne $raw.PSObject.Properties['ciLifecycle']) -eq $CiLifecycle) "raw_ci_lifecycle_$Id"
}

function Assert-StaticRoutes {
    $rootPackage = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, 'package.json')) -Raw | ConvertFrom-Json
    $rootRoutes = [ordered]@{
        dev = 'root-dev'
        build = 'root-build'
        lint = 'root-lint'
        typecheck = 'root-typecheck'
        test = 'root-test'
        'test:coverage' = 'root-test-coverage'
        'test:e2e' = 'root-test-e2e'
        'dogfood:create' = 'dogfood-create'
        'dogfood:verify' = 'dogfood-verify'
        'dogfood:verify-accepted' = 'dogfood-verify-accepted'
        'dogfood:accept' = 'dogfood-accept'
    }
    foreach ($entry in $rootRoutes.GetEnumerator()) {
        $script = [string](Get-NamedProperty $rootPackage.scripts $entry.Key)
        Assert-True ($script -ceq "node scripts/host-command/shuhai-command.cjs $($entry.Value)") "root_route_$($entry.Key)"
    }
    Assert-True ([string]$rootPackage.scripts.clean -ceq 'node scripts/host-command/shuhai-command.cjs blocked-clean') 'root_clean_not_blocked'
    Assert-True ([string]$rootPackage.scripts.preinstall -ceq 'node scripts/host-command/assert-session.cjs root-preinstall-raw') 'preinstall_not_sealed'
    Assert-True ([string]$rootPackage.scripts.prepare -ceq 'node scripts/host-command/assert-session.cjs root-prepare-raw') 'prepare_not_sealed'
    $lintStagedRoutes = [ordered]@{
        '*.{ts,tsx}' = 'lint-staged-ts-raw'
        '*.{json,md,yml,yaml}' = 'lint-staged-docs-raw'
    }
    Assert-True (@($rootPackage.'lint-staged'.PSObject.Properties).Count -eq $lintStagedRoutes.Count) 'lint_staged_route_count'
    foreach ($entry in $lintStagedRoutes.GetEnumerator()) {
        $commands = @((Get-NamedProperty $rootPackage.'lint-staged' $entry.Key))
        Assert-True ($commands.Count -eq 1) "lint_staged_route_count_$($entry.Key)"
        Assert-True ([string]$commands[0] -ceq "node scripts/host-command/assert-session.cjs $($entry.Value)") "lint_staged_route_$($entry.Key)"
    }

    $leafPackages = @(
        @{ path = 'packages/desktop/package.json'; prefix = 'desktop' },
        @{ path = 'packages/extension/package.json'; prefix = 'extension' },
        @{ path = 'packages/shared/package.json'; prefix = 'shared' }
    )
    foreach ($leaf in $leafPackages) {
        $relative = [string]$leaf.path
        $prefix = [string]$leaf.prefix
        $package = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, $relative)) -Raw | ConvertFrom-Json
        foreach ($name in @('dev', 'build', 'lint', 'typecheck', 'test')) {
            $script = [string](Get-NamedProperty $package.scripts $name)
            Assert-True ($script -ceq "node ../../scripts/host-command/shuhai-command.cjs $prefix-$name") "leaf_route_${prefix}_$name"
        }
        Assert-True ([string]$package.scripts.clean -ceq 'node ../../scripts/host-command/shuhai-command.cjs blocked-clean') "leaf_clean_$prefix"
        foreach ($name in @('dev', 'build', 'lint', 'typecheck', 'test')) {
            $script = [string](Get-NamedProperty $package.scripts "_shuhai:$name")
            Assert-True ($script -ceq "node ../../scripts/host-command/assert-session.cjs $prefix-$name-raw") "leaf_raw_${prefix}_$name"
        }
    }
    $husky = (Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, '.husky', 'pre-commit')) -Raw).Trim()
    Assert-True ($husky -eq 'node scripts/host-command/shuhai-command.cjs husky-lint-staged') 'husky_route_invalid'

    foreach ($relative in @(
        'scripts/host-command/shuhai-command.cjs',
        'scripts/host-command/assert-session.cjs',
        'scripts/host-command/Invoke-ShuHaiBoundedCommand.ps1',
        'scripts/host-command/BoundedHostCommandRunner.cs'
    )) {
        $source = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, $relative)) -Raw
        Assert-True ($source -notmatch '(?i)capture_output|ReadToEnd|communicate\s*\(|shell\s*[:=]\s*true|cmd(?:\.exe)?\s+/c|Invoke-Expression') "forbidden_sink_$relative"
    }
    foreach ($relative in @(
        'AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'docs/PROJECT_STATUS.md',
        'docs/goals/README.md',
        'docs/workflows/command-safety.md',
        'docs/workflows/dangerous-command-denylist.md',
        'docs/workflows/verification-and-acceptance.md',
        'docs/dogfood/release-guide.md',
        'docs/goals/goal-046e-versioned-dogfood-release.md'
    )) {
        $source = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, $relative)) -Raw
        $directCommandPattern = '(?i)^\s*(?:pnpm|npm|npx|yarn|prettier|eslint|tsc|vitest|vite|playwright)(?:\s|$)'
        if ($relative -eq 'docs/workflows/dangerous-command-denylist.md') {
            $normalAllowlist = [regex]::Match($source, '(?m)^## 9\. 正常命令白名单[ \t]*\r?$')
            Assert-True $normalAllowlist.Success 'dangerous_command_normal_allowlist_missing'
            $source = $source.Substring($normalAllowlist.Index)
        }
        foreach ($line in ($source -split '\r?\n')) {
            if ($line -match $directCommandPattern) {
                Assert-True ($line.Contains('Goal 048 前历史命令')) "direct_tool_doc_$relative"
            }
        }
    }

    $registry = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json
    $profileClasses = [ordered]@{
        quick = 'quick'
        standard = 'heavy'
        install = 'heavy'
        watch = 'heavy'
        e2e = 'heavy'
        'synthetic-green' = 'quick'
        'synthetic-stream' = 'quick'
        'synthetic-time' = 'quick'
        'synthetic-tree' = 'quick'
        'synthetic-heavy' = 'heavy'
    }
    Assert-True (@($registry.profiles.PSObject.Properties).Count -eq $profileClasses.Count) 'profile_count'
    foreach ($entry in $profileClasses.GetEnumerator()) {
        $profile = Get-NamedProperty $registry.profiles $entry.Key
        Assert-True ([string]$profile.classification -ceq [string]$entry.Value) "profile_class_$($entry.Key)"
    }

    $operationIds = @(
        'root-install', 'root-dev', 'root-build', 'root-lint', 'root-typecheck', 'root-test',
        'root-test-coverage', 'root-test-e2e',
        'desktop-dev', 'desktop-build', 'desktop-lint', 'desktop-typecheck', 'desktop-test',
        'extension-dev', 'extension-build', 'extension-lint', 'extension-typecheck', 'extension-test',
        'shared-dev', 'shared-build', 'shared-lint', 'shared-typecheck', 'shared-test',
        'husky-lint-staged', 'prettier-check', 'prettier-write',
        'dogfood-install-offline', 'dogfood-create', 'dogfood-verify', 'dogfood-verify-accepted',
        'dogfood-accept', 'blocked-clean',
        'synthetic-green', 'synthetic-stdout-overflow', 'synthetic-stderr-overflow',
        'synthetic-mixed-invalid', 'synthetic-idle', 'synthetic-wall', 'synthetic-tree-timeout',
        'synthetic-tree-overflow', 'synthetic-cancel', 'synthetic-parent-exception',
        'synthetic-lane-hold', 'synthetic-nested'
    )
    Assert-PropertyNamesExactly $registry.operations $operationIds 'operation_inventory'
    $rawIds = @(
        'root-preinstall-raw', 'root-prepare-raw', 'root-install-raw', 'root-dev-raw',
        'root-build-raw', 'root-lint-raw', 'root-typecheck-raw', 'root-test-raw',
        'root-test-coverage-raw', 'root-test-e2e-raw',
        'desktop-dev-raw', 'desktop-build-raw', 'desktop-test-raw', 'desktop-lint-raw',
        'desktop-typecheck-raw', 'extension-dev-raw', 'extension-build-raw', 'extension-test-raw',
        'extension-lint-raw', 'extension-typecheck-raw', 'shared-dev-raw', 'shared-build-raw',
        'shared-test-raw', 'shared-lint-raw', 'shared-typecheck-raw',
        'husky-lint-staged-raw', 'lint-staged-ts-raw', 'lint-staged-docs-raw',
        'prettier-check-raw', 'prettier-write-raw',
        'dogfood-install-offline-raw', 'dogfood-create-raw', 'dogfood-verify-raw',
        'dogfood-verify-accepted-raw', 'dogfood-accept-raw',
        'synthetic-green-raw', 'synthetic-stdout-overflow-raw', 'synthetic-stderr-overflow-raw',
        'synthetic-mixed-invalid-raw', 'synthetic-idle-raw', 'synthetic-wall-raw',
        'synthetic-tree-timeout-raw', 'synthetic-tree-overflow-raw', 'synthetic-cancel-raw',
        'synthetic-parent-exception-raw', 'synthetic-lane-hold-raw', 'synthetic-nested-raw',
        'synthetic-nested-target-raw'
    )
    Assert-PropertyNamesExactly $registry.rawOperations $rawIds 'raw_inventory'

    Assert-OperationDefinition $registry 'root-install' 'install' 'root-install-raw' @('root-install-raw', 'root-preinstall-raw', 'root-prepare-raw')
    Assert-OperationDefinition $registry 'root-dev' 'watch' 'root-dev-raw' @('root-dev-raw', 'desktop-dev-raw', 'extension-dev-raw', 'shared-dev-raw')
    Assert-OperationDefinition $registry 'root-build' 'standard' 'root-build-raw' @('root-build-raw', 'desktop-build-raw', 'extension-build-raw', 'shared-build-raw')
    Assert-OperationDefinition $registry 'root-lint' 'standard' 'root-lint-raw' @('root-lint-raw', 'desktop-lint-raw', 'extension-lint-raw', 'shared-lint-raw')
    Assert-OperationDefinition $registry 'root-typecheck' 'standard' 'root-typecheck-raw' @('root-typecheck-raw', 'desktop-typecheck-raw', 'extension-typecheck-raw', 'shared-typecheck-raw')
    Assert-OperationDefinition $registry 'root-test' 'standard' 'root-test-raw' @('root-test-raw', 'desktop-test-raw', 'extension-test-raw', 'shared-test-raw')
    Assert-OperationDefinition $registry 'root-test-coverage' 'standard' 'root-test-coverage-raw' @('root-test-coverage-raw')
    Assert-OperationDefinition $registry 'root-test-e2e' 'e2e' 'root-test-e2e-raw' @('root-test-e2e-raw')
    foreach ($prefix in @('desktop', 'extension', 'shared')) {
        Assert-OperationDefinition $registry "$prefix-dev" 'watch' "$prefix-dev-raw" @("$prefix-dev-raw")
        foreach ($name in @('build', 'lint', 'typecheck', 'test')) {
            Assert-OperationDefinition $registry "$prefix-$name" 'standard' "$prefix-$name-raw" @("$prefix-$name-raw")
        }
    }
    Assert-OperationDefinition $registry 'husky-lint-staged' 'standard' 'husky-lint-staged-raw' @('husky-lint-staged-raw', 'lint-staged-ts-raw', 'lint-staged-docs-raw')
    Assert-OperationDefinition $registry 'prettier-check' 'quick' 'prettier-check-raw' @('prettier-check-raw') 'prettier-paths'
    Assert-OperationDefinition $registry 'prettier-write' 'quick' 'prettier-write-raw' @('prettier-write-raw') 'prettier-paths'
    $blockedClean = Get-NamedProperty $registry.operations 'blocked-clean'
    Assert-PropertyNamesExactly $blockedClean @('blockedReason') 'blocked_clean_properties'
    Assert-True ([string]$blockedClean.blockedReason -ceq 'clean_policy_blocked') 'blocked_clean_reason'

    $dogfoodOperations = @(
        @{ id = 'dogfood-install-offline'; profile = 'install'; raw = 'dogfood-install-offline-raw'; policy = ''; allowed = @('dogfood-install-offline-raw') },
        @{ id = 'dogfood-create'; profile = 'standard'; raw = 'dogfood-create-raw'; policy = 'git-oid'; allowed = @('dogfood-create-raw', 'extension-build-raw') },
        @{ id = 'dogfood-verify'; profile = 'quick'; raw = 'dogfood-verify-raw'; policy = 'release-id'; allowed = @('dogfood-verify-raw') },
        @{ id = 'dogfood-verify-accepted'; profile = 'quick'; raw = 'dogfood-verify-accepted-raw'; policy = 'release-id'; allowed = @('dogfood-verify-accepted-raw') },
        @{ id = 'dogfood-accept'; profile = 'e2e'; raw = 'dogfood-accept-raw'; policy = 'release-id'; allowed = @('dogfood-accept-raw') }
    )
    foreach ($expected in $dogfoodOperations) {
        Assert-OperationDefinition $registry $expected.id $expected.profile $expected.raw $expected.allowed $expected.policy
    }
    Assert-StringArrayEquals (Get-NamedProperty $registry.operations 'root-test').allowedRaw @('root-test-raw', 'desktop-test-raw', 'extension-test-raw', 'shared-test-raw') 'root_test_closure'
    Assert-StringArrayEquals (Get-NamedProperty $registry.operations 'extension-test').allowedRaw @('extension-test-raw') 'extension_test_closure'
    Assert-StringArrayEquals (Get-NamedProperty $registry.operations 'root-test-coverage').allowedRaw @('root-test-coverage-raw') 'coverage_test_closure'

    Assert-RawNoopDefinition -Registry $registry -Id 'root-preinstall-raw' -CiLifecycle $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-prepare-raw' -Arguments @('exec', 'husky') -CiLifecycle $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-install-raw' -Arguments @('install')
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-dev-raw' -Arguments @('-r', '--parallel', 'run', '_shuhai:dev')
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-build-raw' -Arguments @('-r', '--workspace-concurrency=1', 'run', '_shuhai:build')
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-lint-raw' -Arguments @('-r', '--workspace-concurrency=1', 'run', '_shuhai:lint')
    Assert-RawSequenceDefinition -Registry $registry -Id 'root-typecheck-raw' -Steps @(
        @{ args = @('--filter', '@shuhai/shared', 'exec', 'tsc', '-b', '--force'); append = $false },
        @{ args = @('-r', '--workspace-concurrency=1', 'run', '_shuhai:typecheck'); append = $false }
    )
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-test-raw' -Arguments @('-r', '--workspace-concurrency=1', 'run', '_shuhai:test')
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-test-coverage-raw' -Arguments @('exec', 'vitest', 'run', '--coverage')
    Assert-RawPnpmDefinition -Registry $registry -Id 'root-test-e2e-raw' -Arguments @('exec', 'playwright', 'test')

    $leafRawArgs = [ordered]@{
        'desktop-dev-raw' = @('--dir', 'packages/desktop', 'exec', 'tsx', '--watch', 'src/main/index.ts')
        'desktop-build-raw' = @('--dir', 'packages/desktop', 'exec', 'tsc')
        'desktop-test-raw' = @('--dir', 'packages/desktop', 'exec', 'vitest', 'run')
        'desktop-lint-raw' = @('--dir', 'packages/desktop', 'exec', 'eslint', 'src/')
        'desktop-typecheck-raw' = @('--dir', 'packages/desktop', 'exec', 'tsc', '--noEmit')
        'extension-dev-raw' = @('--dir', 'packages/extension', 'exec', 'vite', 'build', '--watch')
        'extension-build-raw' = @('--dir', 'packages/extension', 'exec', 'vite', 'build')
        'extension-test-raw' = @('--dir', 'packages/extension', 'exec', 'vitest', 'run')
        'extension-lint-raw' = @('--dir', 'packages/extension', 'exec', 'eslint', 'src/', 'tests/', 'scripts/', 'vite.config.ts')
        'extension-typecheck-raw' = @('--dir', 'packages/extension', 'exec', 'tsc', '--noEmit')
        'shared-dev-raw' = @('--dir', 'packages/shared', 'exec', 'tsc', '--watch')
        'shared-build-raw' = @('--dir', 'packages/shared', 'exec', 'tsc')
        'shared-test-raw' = @('--dir', 'packages/shared', 'exec', 'vitest', 'run')
        'shared-lint-raw' = @('--dir', 'packages/shared', 'exec', 'eslint', 'src/')
        'shared-typecheck-raw' = @('--dir', 'packages/shared', 'exec', 'tsc', '--noEmit')
    }
    foreach ($entry in $leafRawArgs.GetEnumerator()) {
        Assert-RawPnpmDefinition -Registry $registry -Id ([string]$entry.Key) -Arguments ([string[]]$entry.Value)
    }

    Assert-RawPnpmDefinition -Registry $registry -Id 'husky-lint-staged-raw' -Arguments @('exec', 'lint-staged', '--relative')
    Assert-RawSequenceDefinition -Registry $registry -Id 'lint-staged-ts-raw' -Policy 'typescript-paths' -Steps @(
        @{ args = @('exec', 'eslint', '--fix'); append = $true },
        @{ args = @('exec', 'prettier', '--write'); append = $true }
    )
    Assert-RawPnpmDefinition -Registry $registry -Id 'lint-staged-docs-raw' -Arguments @('exec', 'prettier', '--write') -Policy 'document-paths' -Append $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'prettier-check-raw' -Arguments @('exec', 'prettier', '--check') -Policy 'prettier-paths' -Append $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'prettier-write-raw' -Arguments @('exec', 'prettier', '--write') -Policy 'prettier-paths' -Append $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'dogfood-install-offline-raw' -Arguments @('install', '--offline', '--frozen-lockfile', '--ignore-scripts')
    Assert-RawPnpmDefinition -Registry $registry -Id 'dogfood-create-raw' -Arguments @('exec', 'tsx', 'packages/extension/scripts/dogfood-release.ts', 'create') -Policy 'git-oid' -Append $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'dogfood-verify-raw' -Arguments @('exec', 'tsx', 'packages/extension/scripts/dogfood-release.ts', 'verify') -Policy 'release-id' -Append $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'dogfood-verify-accepted-raw' -Arguments @('exec', 'tsx', 'packages/extension/scripts/dogfood-release.ts', 'verify-accepted') -Policy 'release-id' -Append $true
    Assert-RawPnpmDefinition -Registry $registry -Id 'dogfood-accept-raw' -Arguments @('exec', 'tsx', 'packages/extension/scripts/dogfood-acceptance.ts') -Policy 'release-id' -Append $true

    $releaseSource = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, 'packages', 'extension', 'scripts', 'dogfood-release.ts')) -Raw
    Assert-True ($releaseSource.Contains("export const BUILD_COMMAND = 'node scripts/host-command/shuhai-command.cjs extension-build';")) 'dogfood_build_metadata_not_canonical'
    Assert-True ($releaseSource -notmatch '\bexecSync\s*\(') 'dogfood_execsync_capture_present'
    Assert-True ($releaseSource.Contains("spawnSync(process.execPath, [sessionGuard, 'extension-build-raw']")) 'dogfood_nested_build_missing'
    Assert-True ($releaseSource.Contains("stdio: 'inherit'") -and $releaseSource.Contains('shell: false')) 'dogfood_nested_build_spawn_unsealed'
    Assert-True ($releaseSource.Contains('npm_config_user_agent') -and $releaseSource.Contains('Buffer.byteLength')) 'dogfood_pnpm_provenance_unbounded'
    Assert-True ($releaseSource.Contains('/^shuhai-v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}-[0-9a-f]{12}$/u')) 'dogfood_release_id_schema_not_exact_three'
    Assert-True ($releaseSource.Contains('/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u')) 'dogfood_pnpm_version_schema_not_exact_three'
    Assert-True (-not $releaseSource.Contains('/^shuhai-v\d+(?:\.\d+){0,3}-[0-9a-f]{12}$/u')) 'dogfood_legacy_release_id_schema_present'
    Assert-True ($releaseSource.Contains('/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/u') -and
        $releaseSource.Contains('version: ManifestVersionSchema') -and
        $releaseSource.Contains('manifestVersion: ManifestVersionSchema')) 'dogfood_manifest_version_schema_not_shared'
    Assert-True ($releaseSource.Contains('/^[0-9]{1,5}(?:\.[0-9]{1,5}){0,3}$/u') -and
        $releaseSource.Contains('minimum_chrome_version: MinimumChromeVersionSchema') -and
        $releaseSource.Contains('minimumChromeVersion: MinimumChromeVersionSchema')) 'dogfood_chrome_version_schema_not_bounded'
    Assert-True ([regex]::Matches($releaseSource, [regex]::Escape("Number(part) <= 65_535")).Count -eq 2) 'dogfood_version_numeric_bound_count'
    Assert-True ($releaseSource.Contains('pnpmVersion: z.string().regex(PNPM_VERSION_PATTERN)')) 'dogfood_pnpm_schema_not_shared'
    Assert-True (-not $releaseSource.Contains('pnpmVersion: z.string().min(1)') -and
        -not $releaseSource.Contains('const ChromeVersionSchema = z') -and
        $releaseSource.Contains('PNPM_VERSION_PATTERN.test(version)') -and
        $releaseSource.Contains('ReleaseMetadataSchema.parse(metadata)') -and
        $releaseSource.Contains('ReleaseMetadataSchema.parse(readJson(metadataPath))')) 'dogfood_validator_authority_not_shared'

    $shimSource = Get-Content -LiteralPath $shim -Raw
    $invokeSource = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, 'scripts', 'host-command', 'Invoke-ShuHaiBoundedCommand.ps1')) -Raw
    $sessionSource = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, 'scripts', 'host-command', 'assert-session.cjs')) -Raw
    Assert-True ($shimSource.Contains("Buffer.byteLength(value, 'utf8')") -and $shimSource.Contains('operation_release_id_invalid')) 'dogfood_public_scalar_policy_missing'
    Assert-True ($invokeSource.Contains('[Text.Encoding]::UTF8.GetByteCount($value)') -and
        $invokeSource.Contains('operation_release_id_invalid') -and
        $invokeSource.Contains('Assert-DynamicArguments -Policy $dynamicPolicy -Arguments $normalizedOperationArgs -Root $repoRoot')) 'dogfood_powershell_scalar_policy_missing'
    Assert-True ($invokeSource.Contains('Initialize-SafeReceiptPath -Root $repoRoot') -and
        $invokeSource.Contains('receipt_directory_reparse_forbidden') -and
        $invokeSource.Contains('"$receiptPath.pending"')) 'receipt_path_guard_missing'
    Assert-True ($sessionSource.Contains('validateSealedDynamicArgs(raw, argv)') -and
        $sessionSource.Contains('sealed_session_dynamic_policy_mismatch') -and
        $sessionSource.Contains('module.exports = { validateSealedDynamicArgs };') -and
        $sessionSource.Contains('if (require.main === module) main();')) 'dogfood_sealed_scalar_policy_missing'

    $runnerSource = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, 'scripts', 'host-command', 'BoundedHostCommandRunner.cs')) -Raw
    $runSource = Get-SourceSlice $runnerSource 'public static RunnerResult Run(' 'private static RunnerResult NewResult(' 'runner_run_source'
    $finalizeSource = Get-SourceSlice $runnerSource 'private static RunnerResult FinalizeResult(' 'private static void ValidateRequest(' 'runner_finalize_source'
    $reserveSource = Get-SourceSlice $runnerSource 'private static ReceiptReservation ReserveReceipt(' 'private static void PublishReceipt(' 'receipt_reserve_source'
    $publishSource = Get-SourceSlice $runnerSource 'private static void PublishReceipt(' 'private static void CleanupUncommittedReceipt(' 'receipt_publish_source'
    $cleanupReceiptSource = Get-SourceSlice $runnerSource 'private static void CleanupUncommittedReceipt(' 'private static void ReleaseCommittedReceipt(' 'receipt_cleanup_source'
    $releaseReceiptSource = Get-SourceSlice $runnerSource 'private static void ReleaseCommittedReceipt(' 'private static Exception Win32(' 'receipt_release_source'
    Assert-True ([regex]::Matches($runnerSource, [regex]::Escape('FileMode.CreateNew')).Count -eq 1 -and
        [regex]::Matches($runnerSource, 'FileMode\.Create(?!New)').Count -eq 0) 'receipt_pending_not_exclusive_create'
    Assert-True ([regex]::Matches($runnerSource, [regex]::Escape('reservation.PendingOwned = true;')).Count -eq 1 -and
        [regex]::Matches($runnerSource, [regex]::Escape('reservation.Committed = true;')).Count -eq 1) 'receipt_ownership_commit_marker_count'
    Assert-SourceOrder $reserveSource @(
        'WaitOne(2000, false)',
        'reservation.MutexOwned = true;',
        'reservation.PendingStream = new FileStream(',
        'FileMode.CreateNew',
        'reservation.PendingOwned = true;',
        'return reservation;'
    ) 'receipt_reserve_order'
    Assert-True ($reserveSource.Contains('catch') -and
        $reserveSource.Contains('CleanupUncommittedReceipt(reservation);') -and
        $reserveSource.Contains('throw;')) 'receipt_reserve_failure_not_closed'
    Assert-SourceOrder $publishSource @(
        'result.ToJson()',
        'reservation.PendingStream.Write(',
        'reservation.PendingStream.Flush(true);',
        'reservation.PendingStream.Dispose();',
        'File.Replace(',
        'File.Move(',
        'reservation.PendingOwned = false;',
        'reservation.Committed = true;'
    ) 'receipt_publish_order'
    Assert-True ([regex]::Matches($cleanupReceiptSource, [regex]::Escape('File.Delete(')).Count -eq 1) 'receipt_delete_count'
    Assert-SourceOrder $cleanupReceiptSource @('if (reservation.PendingOwned)', 'File.Delete(reservation.PendingPath)') 'receipt_delete_ownership_guard'
    foreach ($source in @($reserveSource, $publishSource, $cleanupReceiptSource, $releaseReceiptSource)) {
        Assert-True (-not $source.Contains('ResourceLedger') -and
            -not $source.Contains('Obligation') -and
            -not $source.Contains('ledger.') -and
            -not $source.Contains('.Reserve(') -and
            -not $source.Contains('.Bind(') -and
            -not $source.Contains('.Prove(') -and
            -not $source.Contains('.Fail(')) 'receipt_transport_entered_resource_ledger'
    }
    foreach ($legacyReceiptObligation in @('receipt-directory', 'receipt-mutex', 'receipt-atomic-file', 'receipt_cleanup_unproven')) {
        Assert-True (-not $runnerSource.Contains($legacyReceiptObligation)) "legacy_receipt_obligation_$legacyReceiptObligation"
    }
    Assert-SourceOrder $runSource @(
        'if (request.Profile.Classification == "heavy")',
        'result.LaneAcquired = true;',
        'receiptReservation = ReserveReceipt(request);',
        'job = CreateJobObject(',
        'CreatePipe(out stdoutRead',
        'CreateProcessW('
    ) 'runner_heavy_reservation_before_target_setup'
    Assert-True ($runSource -match 'result\.LaneAcquired = true;\s*\r?\n\s*}\s*\r?\n\s*receiptReservation = ReserveReceipt\(request\);') 'runner_quick_reservation_not_unconditional'
    Assert-SourceOrder $runSource @(
        'result.Reason = "lane_abandoned";',
        'deferReceiptReservation = true;',
        'throw new InvalidOperationException("lane_abandoned_control")'
    ) 'runner_abandoned_deferred_order'
    Assert-SourceOrder $runSource @(
        'result.Reason = "lane_busy";',
        'deferReceiptReservation = true;',
        'throw new InvalidOperationException("lane_busy_control")'
    ) 'runner_busy_deferred_order'
    Assert-True ([regex]::Matches($runSource, [regex]::Escape('deferReceiptReservation = true;')).Count -eq 2) 'runner_deferred_gate_not_exact'
    Assert-True ($finalizeSource.Contains('if (receiptReservation == null && deferReceiptReservation)') -and
        $finalizeSource.Contains('receiptReservation = ReserveReceipt(request);')) 'runner_blocked_finalization_reservation_missing'
    Assert-SourceOrder $finalizeSource @(
        'result.ObligationCount = ledger.Count;',
        'result.UnprovenObligationCount = ledger.UnprovenCount;',
        'result.LedgerProven = ledger.AllProven;',
        'result.HandleObligationsProven = result.LedgerProven;',
        'PublishReceipt(request, result, receiptReservation);',
        'committed = receiptReservation.Committed;',
        'if (committed) ReleaseCommittedReceipt(receiptReservation);',
        'else CleanupUncommittedReceipt(receiptReservation);'
    ) 'receipt_proof_commit_teardown_order'
    Assert-True ([regex]::Matches($finalizeSource, [regex]::Escape('result.ObligationCount = ledger.Count;')).Count -eq 1 -and
        [regex]::Matches($finalizeSource, [regex]::Escape('result.LedgerProven = ledger.AllProven;')).Count -eq 1) 'receipt_proof_recomputed'
    Assert-True (-not $publishSource.Contains('result.Status =') -and
        -not $publishSource.Contains('result.Reason =') -and
        -not $publishSource.Contains('result.ExitCode =') -and
        -not $publishSource.Contains('ReleaseMutex') -and
        -not $releaseReceiptSource.Contains('RunnerResult') -and
        -not $releaseReceiptSource.Contains('File.Delete(') -and
        -not $releaseReceiptSource.Contains('PendingOwned')) 'receipt_postcommit_verdict_mutable'

    $ignoreLines = @(Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, '.gitignore')))
    Assert-True (@($ignoreLines | Where-Object { $_ -ceq '/.tmp/host-command/current.json' }).Count -eq 1) 'current_ignore_exact_missing'
    Assert-True (@($ignoreLines | Where-Object { $_ -ceq '/.tmp/host-command/current.json.pending' }).Count -eq 1) 'pending_ignore_exact_missing'
    Assert-True (@($ignoreLines | Where-Object { $_ -match '^/\.tmp/host-command/.*[\*\?].*pending' }).Count -eq 0) 'pending_ignore_wildcard_present'

    $playwright = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, 'playwright.config.ts')) -Raw
    foreach ($pattern in @('fullyParallel: false', 'workers: 1', 'globalTimeout:', 'maxFailures: 1', "headless: true", "trace: 'off'", "video: 'off'", "screenshot: 'only-on-failure'", '.tmp/host-stability-narrow-v1/test/playwright-output')) {
        Assert-True ($playwright.Contains($pattern)) "playwright_limit_$pattern"
    }
    foreach ($relative in @('vitest.config.ts', 'packages/extension/vitest.config.ts')) {
        $source = Get-Content -LiteralPath ([IO.Path]::Combine($repoRoot, $relative)) -Raw
        foreach ($pattern in @('fileParallelism: false', 'maxWorkers: 1', 'minWorkers: 1', 'testTimeout:', 'hookTimeout:')) {
            Assert-True ($source.Contains($pattern)) "vitest_limit_${relative}_$pattern"
        }
    }
}

function Get-NamedProperty {
    param($Object, [string]$Name)
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { throw "property_missing:$Name" }
    return $property.Value
}

function Assert-AllowlistDelta {
    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in @(
        '.gitignore', '.husky/pre-commit', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'README.md',
        'docs/PROJECT_STATUS.md', 'docs/dogfood/release-guide.md', 'docs/goals/README.md',
        'docs/goals/goal-046e-versioned-dogfood-release.md',
        'docs/goals/goal-048-host-command-incident-containment.md',
        'docs/workflows/command-safety.md', 'docs/workflows/dangerous-command-denylist.md',
        'docs/workflows/verification-and-acceptance.md',
        'package.json', 'packages/desktop/package.json', 'packages/extension/package.json',
        'packages/extension/scripts/dogfood-release.ts', 'packages/extension/vitest.config.ts',
        'packages/shared/package.json', 'playwright.config.ts', 'vitest.config.ts',
        'scripts/host-command/shuhai-command.cjs', 'scripts/host-command/assert-session.cjs',
        'scripts/host-command/host-command-registry.json',
        'scripts/host-command/Invoke-ShuHaiBoundedCommand.ps1',
        'scripts/host-command/BoundedHostCommandRunner.cs',
        'scripts/host-command/Test-ShuHaiBoundedCommand.ps1',
        'scripts/host-command/hostile-child.cjs',
        '.tmp/host-stability-narrow-v1/implementation-report.md'
    )) { $null = $allowed.Add($path) }
    $testPrefix = '.tmp/host-stability-narrow-v1/test/'
    $changed = @(
        git diff --name-only
        git ls-files --others --exclude-standard
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { ([string]$_).Replace('\', '/') } | Sort-Object -Unique
    foreach ($path in $changed) {
        Assert-True ($allowed.Contains($path) -or $path.StartsWith($testPrefix)) "allowlist_delta_$path"
    }
    $durableChanged = @($changed | Where-Object { -not $_.StartsWith($testPrefix) })
    Assert-True ($durableChanged.Count -eq $allowed.Count) 'candidate_delta_count_not_30'
    foreach ($path in $allowed) {
        Assert-True ($durableChanged -contains $path) "candidate_delta_missing_$path"
    }
    $staged = @(git diff --cached --name-only | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    Assert-True ($staged.Count -eq 0) 'staged_not_zero'
    Assert-True (@(Get-ChildItem -LiteralPath $testRoot -Force).Count -eq 0) 'test_temp_not_zero'
}

try {
    Initialize-SafeTestRoot
    foreach ($name in @(
        'valid-registry.json', 'invalid-schema.json', 'invalid-wall.json', 'invalid-bool.json',
        'invalid-policy.json',
        'tree-timeout.json', 'tree-overflow.json', 'cancel.json', 'parent-exception.json',
        'lane-starts.log', 'nested-starts.log',
        'lane-0.out', 'lane-0.err', 'lane-1.out', 'lane-1.err',
        'lane-2.out', 'lane-2.err', 'lane-3.out', 'lane-3.err'
    )) { $null = Add-OwnedName $name; Remove-OwnedFile $name }

    # 1. Registry/profile/schema and typed argument rejection before target spawn.
    $receiptBefore = if ([IO.File]::Exists($receiptPath)) { (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash } else { '<absent>' }
    $validPath = Add-OwnedName 'valid-registry.json'
    [IO.File]::WriteAllBytes($validPath, [IO.File]::ReadAllBytes($registryPath))
    $valid = Invoke-RegistryValidation $validPath
    Assert-True ($valid.code -eq 0 -and $valid.payload.reason -eq 'registry_valid') 'valid_registry_rejected'
    $schemaPath = Write-RegistryVariant 'invalid-schema.json' { param($value) $value.schemaVersion = 2 }
    $wallPath = Write-RegistryVariant 'invalid-wall.json' { param($value) $value.profiles.quick.wallMilliseconds = 0 }
    $boolPath = Write-RegistryVariant 'invalid-bool.json' { param($value) $value.profiles.quick.wallMilliseconds = $true }
    $policyPath = Write-RegistryVariant 'invalid-policy.json' { param($value) $value.operations.'dogfood-create'.dynamicArgPolicy = 'arbitrary-value' }
    foreach ($path in @($schemaPath, $wallPath, $boolPath, $policyPath)) {
        $validation = Invoke-RegistryValidation $path
        Assert-True ($validation.code -eq 64) "invalid_registry_accepted_$path"
    }
    Assert-DynamicPolicyAcrossLayers -Policy 'git-oid' -Arguments @('0123456789abcdef0123456789abcdef01234567') -Expected 0 -Message 'valid_git_oid_rejected'
    Assert-DynamicPolicyAcrossLayers -Policy 'release-id' -Arguments @('shuhai-v0.1.0-0123456789ab') -Expected 0 -Message 'valid_release_id_rejected'
    foreach ($probe in @(
        @{ policy = 'git-oid'; args = @() },
        @{ policy = 'git-oid'; args = @('0123456789abcdef0123456789abcdef0123456A') },
        @{ policy = 'git-oid'; args = @('0123456789abcdef0123456789abcdef0123456G') },
        @{ policy = 'git-oid'; args = @('0123456789abcdef0123456789abcdef0123456;') },
        @{ policy = 'git-oid'; args = @('0123456789abcdef0123456789abcdef01234567', 'extra') },
        @{ policy = 'release-id'; args = @('shuhai-v0.1-0123456789ab') },
        @{ policy = 'release-id'; args = @('shuhai-v0.1.0.0-0123456789ab') },
        @{ policy = 'release-id'; args = @('shuhai-v000001.1.1-0123456789ab') },
        @{ policy = 'release-id'; args = @('shuhai-v0.1.0-0123456789aA') },
        @{ policy = 'release-id'; args = @('shuhai-v0.1.0-0123456789aé') },
        @{ policy = 'release-id'; args = @('C:\shuhai-v0.1.0-0123456789ab') },
        @{ policy = 'release-id'; args = @('../shuhai-v0.1.0-0123456789ab') },
        @{ policy = 'release-id'; args = @('--release-id') },
        @{ policy = 'release-id'; args = @('SHUHAI_OUTPUT=shuhai-v0.1.0-0123456789ab') },
        @{ policy = 'release-id'; args = @('shuhai-v0.1.0-0123456789ab', 'extra') },
        @{ policy = 'release-id'; args = @("shuhai-v0.1.0-0123456789ab`n") }
    )) {
        Assert-DynamicPolicyAcrossLayers -Policy $probe.policy -Arguments ([string[]]$probe.args) -Expected 64 -Message "invalid_dynamic_argument_accepted_$($probe.policy)"
    }
    $unknown = Invoke-Operation 'operation-does-not-exist'
    $escape = Invoke-Operation 'prettier-check' @('../package.json')
    $badOid = Invoke-Operation 'dogfood-create' @('--output=elsewhere')
    $badRelease = Invoke-Operation 'dogfood-verify' @('../release')
    Assert-True ($unknown.code -eq 64 -and $escape.code -eq 64 -and $badOid.code -eq 64 -and $badRelease.code -eq 64) 'typed_request_rejection_failed'
    $receiptAfter = if ([IO.File]::Exists($receiptPath)) { (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash } else { '<absent>' }
    Assert-True ($receiptBefore -eq $receiptAfter) 'invalid_request_reached_runner'
    Add-CaseResult '1' 'registry validator + three-layer OID/release policy + unknown/path rejection' 0 'public, PowerShell and sealed scalar validators agree; invalid public requests leave receipt unchanged'

    # 2. Green short child.
    $green = Invoke-Operation 'synthetic-green'
    Assert-True ([IO.File]::Exists($receiptPath)) "green_receipt_missing_$($green.output)"
    $greenReceipt = Get-Receipt
    Assert-True ($green.code -eq 0 -and $green.payload.reason -eq 'completed') 'green_failed'
    Assert-CleanupReceipt $greenReceipt
    Assert-True ($greenReceipt.ChildPID -gt 0 -and $greenReceipt.stdoutBytes -eq 6) 'green_receipt_invalid'
    Add-CaseResult '2' 'node shuhai-command.cjs synthetic-green' $green.code 'completed; bounded digest; JobEmpty and ledger proven'

    # 3. Stream caps, mixed raw bytes, and invalid UTF-8.
    $stdoutCase = Invoke-Operation 'synthetic-stdout-overflow'
    $stdoutReceipt = Get-Receipt
    Assert-True ($stdoutCase.code -eq 70 -and $stdoutReceipt.reason -eq 'stdout_overflow' -and $stdoutReceipt.stdoutBytes -eq 4097) 'stdout_cap_failed'
    Assert-CleanupReceipt $stdoutReceipt
    $stderrCase = Invoke-Operation 'synthetic-stderr-overflow'
    $stderrReceipt = Get-Receipt
    Assert-True ($stderrCase.code -eq 70 -and $stderrReceipt.reason -eq 'stderr_overflow' -and $stderrReceipt.stderrBytes -eq 4097) 'stderr_cap_failed'
    Assert-CleanupReceipt $stderrReceipt
    $mixedCase = Invoke-Operation 'synthetic-mixed-invalid'
    $mixedReceipt = Get-Receipt
    Assert-True ($mixedCase.code -eq 0 -and $mixedReceipt.stdoutBytes -eq 2048 -and $mixedReceipt.stderrBytes -eq 2048) 'mixed_invalid_failed'
    Assert-CleanupReceipt $mixedReceipt
    Assert-True ($mixedReceipt.stdoutSha256.Length -eq 64 -and $mixedReceipt.stderrSha256.Length -eq 64) 'mixed_digest_invalid'
    Add-CaseResult '3' 'synthetic stdout/stderr/mixed-invalid operations' 0 'cap+1 rejected at raw-byte accounting; invalid UTF-8 retained only as digest/count'

    # 4. Independent idle and wall deadlines.
    $idleCase = Invoke-Operation 'synthetic-idle'
    $idleReceipt = Get-Receipt
    Assert-True ($idleCase.code -eq 70 -and $idleReceipt.reason -eq 'idle_timeout') 'idle_timeout_failed'
    Assert-CleanupReceipt $idleReceipt $true
    $wallCase = Invoke-Operation 'synthetic-wall'
    $wallReceipt = Get-Receipt
    Assert-True ($wallCase.code -eq 70 -and $wallReceipt.reason -eq 'wall_timeout' -and $wallReceipt.stdoutBytes -gt 0) 'wall_timeout_failed'
    Assert-CleanupReceipt $wallReceipt $true
    Add-CaseResult '4' 'synthetic-idle + synthetic-wall' 0 'silent child hit idle; continuous output still hit wall'

    # 5. Child plus grandchild cleanup on timeout and overflow.
    $treeTimeout = Invoke-Operation 'synthetic-tree-timeout'
    $treeTimeoutReceipt = Get-Receipt
    Assert-True ($treeTimeout.code -eq 70 -and @('idle_timeout', 'wall_timeout') -contains $treeTimeoutReceipt.reason) 'tree_timeout_reason'
    Assert-CleanupReceipt $treeTimeoutReceipt $true
    Assert-MarkerGone 'tree-timeout.json'
    $treeOverflow = Invoke-Operation 'synthetic-tree-overflow'
    $treeOverflowReceipt = Get-Receipt
    Assert-True ($treeOverflow.code -eq 70 -and $treeOverflowReceipt.reason -eq 'stdout_overflow') 'tree_overflow_reason'
    Assert-CleanupReceipt $treeOverflowReceipt $true
    Assert-MarkerGone 'tree-overflow.json'
    Add-CaseResult '5' 'synthetic-tree-timeout + synthetic-tree-overflow' 0 'child/grandchild PIDs and loopback TCP/UDP gone; JobEmpty=true'

    # 6. Cancellation and parent-exception share exactly-once cleanup.
    $cancel = Invoke-Operation 'synthetic-cancel'
    $cancelReceipt = Get-Receipt
    Assert-True ($cancel.code -eq 70 -and $cancelReceipt.reason -eq 'cancelled') 'cancel_reason'
    Assert-CleanupReceipt $cancelReceipt $true
    Assert-MarkerGone 'cancel.json'
    $parentException = Invoke-Operation 'synthetic-parent-exception'
    $parentReceipt = Get-Receipt
    Assert-True ($parentException.code -eq 70 -and $parentReceipt.reason -eq 'parent_exception') 'parent_exception_reason'
    Assert-CleanupReceipt $parentReceipt $true
    Assert-MarkerGone 'parent-exception.json'
    Add-CaseResult '6' 'synthetic-cancel + synthetic-parent-exception' 0 'cleanupInvocations=1; readers, handles, ledger proven'

    # 7. Four independent heavy wrappers and nested sealed raw operation.
    $processes = @()
    for ($index = 0; $index -lt 4; $index++) {
        $out = Add-OwnedName "lane-$index.out"
        $err = Add-OwnedName "lane-$index.err"
        $processes += Start-Process -FilePath $node -ArgumentList @($shim, 'synthetic-lane-hold') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    }
    foreach ($process in $processes) {
        Assert-True ($process.WaitForExit(10000)) "lane_wrapper_timeout_$($process.Id)"
        $process.WaitForExit()
    }
    $lanePayloads = @()
    $laneCodes = @()
    for ($index = 0; $index -lt 4; $index++) {
        $lines = @((Get-Content -LiteralPath (Add-OwnedName "lane-$index.out")) + (Get-Content -LiteralPath (Add-OwnedName "lane-$index.err")))
        $lanePayloads += Get-JsonLine $lines
        $laneCodes += $processes[$index].ExitCode
    }
    Assert-True (@($laneCodes | Where-Object { $_ -eq 0 }).Count -eq 1) 'heavy_winner_count'
    Assert-True (@($laneCodes | Where-Object { $_ -eq 75 }).Count -eq 3) 'heavy_busy_count'
    foreach ($payload in @($lanePayloads | Where-Object { $_.reason -eq 'lane_busy' })) {
        Assert-True ($payload.ChildPID -eq 0 -and $payload.targetStarted -eq $false) 'lane_busy_spawned_child'
    }
    $laneLines = @(Get-Content -LiteralPath (Add-OwnedName 'lane-starts.log'))
    Assert-True ($laneLines.Count -eq 1) 'heavy_target_start_count'
    $nested = Invoke-Operation 'synthetic-nested'
    $nestedReceipt = Get-Receipt
    Assert-True ($nested.code -eq 0 -and $nestedReceipt.laneAcquired -eq $true) 'nested_operation_failed'
    Assert-CleanupReceipt $nestedReceipt
    Assert-True (@(Get-Content -LiteralPath (Add-OwnedName 'nested-starts.log')).Count -eq 1) 'nested_target_count'
    Add-CaseResult '7' 'four synthetic-lane-hold wrappers + synthetic-nested' 0 'one target start, three lane_busy ChildPID=0; nested raw used one heavy lease'

    # 8. Foreign pending fail-closed, owned pending replace failure, and recovery publication.
    $baselineCurrentIdentity = Get-FileIdentity $receiptPath
    $laneMarker = Add-OwnedName 'lane-starts.log'
    $laneMarkerCount = @(Get-Content -LiteralPath $laneMarker).Count
    $sentinelIdentity = New-HarnessPendingSentinel

    $foreignQuick = Invoke-Operation 'synthetic-green'
    Assert-True ($foreignQuick.code -eq 70 -and
        $foreignQuick.payload.status -eq 'failed' -and
        $foreignQuick.payload.operation -eq 'synthetic-green' -and
        $foreignQuick.payload.targetStarted -eq $false -and
        $foreignQuick.payload.ChildPID -eq 0) 'foreign_pending_quick_not_closed'
    Assert-CleanupReceipt $foreignQuick.payload
    Assert-FileIdentity $pendingPath $sentinelIdentity 'foreign_pending_quick_sentinel'
    Assert-FileIdentity $receiptPath $baselineCurrentIdentity 'foreign_pending_quick_current'

    $foreignHeavy = Invoke-Operation 'synthetic-lane-hold'
    Assert-True ($foreignHeavy.code -eq 70 -and
        $foreignHeavy.payload.status -eq 'failed' -and
        $foreignHeavy.payload.operation -eq 'synthetic-lane-hold' -and
        $foreignHeavy.payload.laneAcquired -eq $true -and
        $foreignHeavy.payload.targetStarted -eq $false -and
        $foreignHeavy.payload.ChildPID -eq 0) 'foreign_pending_heavy_not_closed'
    Assert-CleanupReceipt $foreignHeavy.payload
    Assert-True (@(Get-Content -LiteralPath $laneMarker).Count -eq $laneMarkerCount) 'foreign_pending_heavy_started_target'
    Assert-FileIdentity $pendingPath $sentinelIdentity 'foreign_pending_heavy_sentinel'
    Assert-FileIdentity $receiptPath $baselineCurrentIdentity 'foreign_pending_heavy_current'
    Remove-HarnessPendingSentinel

    $replaceBaselineIdentity = Get-FileIdentity $receiptPath
    $currentLock = [IO.FileStream]::new($receiptPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
        $replaceFailure = Invoke-Operation 'synthetic-green'
    }
    finally {
        $currentLock.Dispose()
    }
    Assert-True ($replaceFailure.code -eq 70 -and
        $replaceFailure.payload.status -eq 'failed' -and
        $replaceFailure.payload.reason -eq 'receipt_write_failed' -and
        $replaceFailure.payload.targetStarted -eq $true -and
        $replaceFailure.payload.ChildPID -gt 0 -and
        $replaceFailure.payload.targetExitCode -eq 0) 'owned_pending_replace_failure_not_closed'
    Assert-CleanupReceipt $replaceFailure.payload
    Assert-FileIdentity $receiptPath $replaceBaselineIdentity 'owned_pending_replace_failure_current'
    Assert-True (-not [IO.File]::Exists($pendingPath) -and -not [IO.Directory]::Exists($pendingPath)) 'owned_pending_replace_failure_leaked'

    $recovery = Invoke-Operation 'synthetic-green'
    $recoveryReceipt = Get-Receipt
    Assert-True ($recovery.code -eq 0 -and
        $recoveryReceipt.operation -eq 'synthetic-green' -and
        $recoveryReceipt.reason -eq 'completed') 'receipt_recovery_green_failed'
    Assert-CleanupReceipt $recoveryReceipt
    $recoveryIdentity = Get-FileIdentity $receiptPath
    Assert-True ($recoveryIdentity.sha256 -cne $replaceBaselineIdentity.sha256) 'receipt_recovery_not_new_publication'
    Assert-True (-not [IO.File]::Exists($pendingPath) -and -not [IO.Directory]::Exists($pendingPath)) 'receipt_recovery_pending_present'

    $receiptEntries = @(Get-ChildItem -LiteralPath $receiptDirectory -Force)
    Assert-True ($receiptEntries.Count -eq 1 -and
        -not $receiptEntries[0].PSIsContainer -and
        ($receiptEntries[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
        $receiptEntries[0].Name -ceq 'current.json') 'receipt_file_count'
    Add-CaseResult '8' 'foreign pending quick/heavy + locked current replace failure + recovery green' 0 'foreign bytes/current preserved; no pre-target start; owned pending removed; mutex and publication recovered'

    # 9. Static source/package/Husky/docs gate.
    Assert-StaticRoutes
    Add-CaseResult '9' 'static parsed route/config/source gate' 0 'all declared entries, eleven current command docs and five dogfood routes sealed; exact receipt/publish order; validator authority shared'

    # 10. Exact marker, Git, receipt, and allowlist hygiene.
    foreach ($name in @('tree-timeout.json', 'tree-overflow.json', 'cancel.json', 'parent-exception.json')) {
        Assert-MarkerGone $name
    }
    foreach ($name in $ownedNames) { Remove-OwnedFile $name }
    Assert-AllowlistDelta
    $finalReceipt = Get-Receipt
    Assert-CleanupReceipt $finalReceipt
    Assert-True ($finalReceipt.operation -eq 'synthetic-green' -and $finalReceipt.reason -eq 'completed') 'final_receipt_identity'
    Assert-FileIdentity $receiptPath $recoveryIdentity 'final_receipt_not_case8_recovery'
    Assert-True (-not [IO.File]::Exists($pendingPath) -and -not [IO.Directory]::Exists($pendingPath)) 'final_pending_present'
    $finalReceiptEntries = @(Get-ChildItem -LiteralPath $receiptDirectory -Force)
    Assert-True ($finalReceiptEntries.Count -eq 1 -and
        -not $finalReceiptEntries[0].PSIsContainer -and
        ($finalReceiptEntries[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and
        $finalReceiptEntries[0].Name -ceq 'current.json') 'final_receipt_file_count'
    Add-CaseResult '10' 'marker PID/TCP/UDP + git diff/staged/test-temp + receipt hygiene' 0 'owned PID/TCP/UDP=0; pending absent; Case 8 recovery current retained; exact 30-file candidate'

    [Console]::Out.WriteLine((@{ status = 'PASS'; cases = $results } | ConvertTo-Json -Depth 8 -Compress))
}
catch {
    [Console]::Error.WriteLine((@{ status = 'FAIL'; reason = $_.Exception.Message; cases = $results } | ConvertTo-Json -Depth 8 -Compress))
    exit 1
}
finally {
    if ($null -ne $pendingSentinelIdentity) {
        try { Remove-HarnessPendingSentinel } catch { [Console]::Error.WriteLine('cleanup_failed:pending-sentinel-identity') }
    }
    foreach ($name in $ownedNames) {
        try { Remove-OwnedFile $name } catch { [Console]::Error.WriteLine("cleanup_failed:$name") }
    }
}
