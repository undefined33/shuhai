[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')]
    [string]$OperationId,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$ParentPid,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$OperationArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-BoundedFailure {
    param([string]$Reason, [int]$Code = 64)

    $safe = ([string]$Reason -replace '[^a-zA-Z0-9_.:-]', '_')
    if ($safe.Length -gt 160) { $safe = $safe.Substring(0, 160) }
    [Console]::Error.WriteLine((@{ status = 'blocked'; reason = $safe } | ConvertTo-Json -Compress))
    exit $Code
}

function Assert-PositiveInteger {
    param($Value, [long]$Maximum, [string]$Name)

    if ($Value -is [bool] -or $Value -isnot [ValueType]) {
        throw "profile_${Name}_invalid"
    }
    $number = [long]$Value
    if ($number -le 0 -or $number -gt $Maximum -or [double]$number -ne [double]$Value) {
        throw "profile_${Name}_invalid"
    }
}

function Get-NamedPropertyValue {
    param($Object, [string]$Name, [string]$ErrorName)

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { throw $ErrorName }
    return $property.Value
}

function Assert-NoReparsePath {
    param([string]$Root, [string]$Absolute)

    $rootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $Absolute.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'operation_path_escape'
    }
    $relative = $Absolute.Substring($rootPrefix.Length)
    $current = $Root
    foreach ($part in $relative.Split([IO.Path]::DirectorySeparatorChar)) {
        if ([string]::IsNullOrEmpty($part)) { continue }
        $current = [IO.Path]::Combine($current, $part)
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'operation_path_reparse_forbidden'
        }
    }
}

function Initialize-SafeReceiptPath {
    param([string]$Root)

    $absoluteRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $rootItem = Get-Item -LiteralPath $absoluteRoot -Force
    if (-not $rootItem.PSIsContainer -or
        ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'receipt_root_reparse_forbidden'
    }
    $current = $absoluteRoot
    foreach ($part in @('.tmp', 'host-command')) {
        $current = [IO.Path]::Combine($current, $part)
        if ([IO.File]::Exists($current)) { throw 'receipt_directory_not_directory' }
        $item = if ([IO.Directory]::Exists($current)) {
            Get-Item -LiteralPath $current -Force
        }
        else {
            [IO.Directory]::CreateDirectory($current)
        }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'receipt_directory_reparse_forbidden'
        }
    }
    $receiptPath = [IO.Path]::Combine($current, 'current.json')
    foreach ($candidate in @($receiptPath, "$receiptPath.pending")) {
        $item = Get-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
        if ($null -ne $item -and
            ($item.PSIsContainer -or
             ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'receipt_file_reparse_forbidden'
        }
    }
    return $receiptPath
}

function Assert-DynamicArguments {
    param([string]$Policy, [string[]]$Arguments, [string]$Root)

    $values = [Collections.Generic.List[string]]::new()
    if ($null -ne $Arguments) {
        foreach ($argument in $Arguments) { $values.Add($argument) }
    }
    if ([string]::IsNullOrEmpty($Policy)) {
        if ($values.Count -ne 0) { throw 'operation_arguments_forbidden' }
        return
    }
    if (@('git-oid', 'release-id') -ccontains $Policy) {
        if ($values.Count -ne 1) { throw 'operation_scalar_argument_count_invalid' }
        $value = [string]$values[0]
        $byteLength = [Text.Encoding]::UTF8.GetByteCount($value)
        if ($value -match '[^\x20-\x7e]') { throw "operation_${Policy}_ascii_invalid" }
        if ($Policy -eq 'git-oid' -and
            ($byteLength -ne 40 -or $value -cnotmatch '^[0-9a-f]{40}$')) {
            throw 'operation_git_oid_invalid'
        }
        if ($Policy -eq 'release-id' -and
            ($byteLength -gt 38 -or
             $value -cnotmatch '^shuhai-v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}-[0-9a-f]{12}$')) {
            throw 'operation_release_id_invalid'
        }
        return
    }
    if ($values.Count -lt 1 -or $values.Count -gt 32) { throw 'operation_path_count_invalid' }
    $extensions = switch -CaseSensitive ($Policy) {
        'prettier-paths' { @('.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.md', '.yml', '.yaml', '.css', '.html') }
        'typescript-paths' { @('.ts', '.tsx') }
        'document-paths' { @('.json', '.md', '.yml', '.yaml') }
        default { throw 'operation_path_policy_invalid' }
    }
    $rootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($value in $values) {
        if ([string]::IsNullOrEmpty($value) -or $value.Length -gt 260 -or
            $value.Contains('\') -or [IO.Path]::IsPathRooted($value) -or
            $value -match '[;&|<>`$\r\n]' -or $value -eq '.' -or
            $value.StartsWith('../') -or $value.Contains('/../')) {
            throw 'operation_path_invalid'
        }
        $extension = [IO.Path]::GetExtension($value).ToLowerInvariant()
        if ($extensions -notcontains $extension) { throw 'operation_path_extension_invalid' }
        $absolute = [IO.Path]::GetFullPath([IO.Path]::Combine($Root, $value.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        if (-not $absolute.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'operation_path_escape'
        }
        $item = Get-Item -LiteralPath $absolute -Force
        if ($item.PSIsContainer) { throw 'operation_path_not_file' }
        Assert-NoReparsePath -Root $Root -Absolute $absolute
    }
}

try {
    $normalizedOperationArgs = if ($null -eq $OperationArgs) { @() } else { [string[]]$OperationArgs }
    $repoRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..')).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $registryPath = [IO.Path]::Combine($PSScriptRoot, 'host-command-registry.json')
    $registryBytes = [IO.File]::ReadAllBytes($registryPath)
    if ($registryBytes.Length -le 0 -or $registryBytes.Length -gt 262144) { throw 'registry_size_invalid' }
    $registry = [Text.Encoding]::UTF8.GetString($registryBytes) | ConvertFrom-Json
    if ($registry.schemaVersion -ne 1 -or $registry.mutexName -ne 'Local\CodexHostHeavyLane-v1' -or
        $registry.receipt.path -ne '.tmp/host-command/current.json' -or $registry.receipt.maxBytes -ne 32768) {
        throw 'registry_header_invalid'
    }
    $operation = Get-NamedPropertyValue -Object $registry.operations -Name $OperationId -ErrorName 'operation_unknown'
    if ($null -ne $operation.PSObject.Properties['blockedReason']) { throw ([string]$operation.blockedReason) }
    $profile = Get-NamedPropertyValue -Object $registry.profiles -Name ([string]$operation.profile) -ErrorName 'profile_unknown'
    if (@('quick', 'heavy') -notcontains [string]$profile.classification) { throw 'profile_classification_invalid' }

    $profileLimits = @{
        wallMilliseconds = 1800000; idleMilliseconds = 300000; stdoutBytes = 1048576
        stderrBytes = 1048576; aggregateBytes = 1572864; processMemoryBytes = 2147483648
        jobMemoryBytes = 4294967296; processCount = 32; mutexWaitMilliseconds = 5000
        cleanupMilliseconds = 30000; chunkBytes = 65536; ringBytes = 8192
    }
    foreach ($entry in $profileLimits.GetEnumerator()) {
        $value = Get-NamedPropertyValue -Object $profile -Name $entry.Key -ErrorName "profile_$($entry.Key)_missing"
        Assert-PositiveInteger -Value $value -Maximum $entry.Value -Name $entry.Key
    }
    if ([uint64]$profile.processMemoryBytes -gt [uint64]$profile.jobMemoryBytes -or
        [int64]$profile.aggregateBytes -gt ([int64]$profile.stdoutBytes + [int64]$profile.stderrBytes) -or
        [int64]$profile.ringBytes -gt [int64]$profile.aggregateBytes -or
        [int64]$profile.chunkBytes -gt [int64]$profile.aggregateBytes) {
        throw 'profile_relationship_invalid'
    }

    $dynamicPolicy = ''
    if ($null -ne $operation.PSObject.Properties['dynamicArgPolicy']) {
        $dynamicPolicy = [string]$operation.dynamicArgPolicy
    }
    Assert-DynamicArguments -Policy $dynamicPolicy -Arguments $normalizedOperationArgs -Root $repoRoot

    $rawId = [string]$operation.rawOperation
    if ($rawId -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' -or
        $null -eq $registry.rawOperations.PSObject.Properties[$rawId]) {
        throw 'raw_operation_invalid'
    }
    $allowed = @($operation.allowedRaw)
    if ($allowed.Count -eq 0 -or $allowed -notcontains $rawId) { throw 'raw_allowlist_invalid' }

    $nodeCommand = Get-Command -Name 'node.exe' -CommandType Application | Select-Object -First 1
    if ($null -eq $nodeCommand -or -not [IO.File]::Exists($nodeCommand.Source)) { throw 'node_executable_not_found' }
    $nodePath = [IO.Path]::GetFullPath($nodeCommand.Source)
    $assertScript = [IO.Path]::Combine($PSScriptRoot, 'assert-session.cjs')
    $sourcePath = [IO.Path]::Combine($PSScriptRoot, 'BoundedHostCommandRunner.cs')
    Assert-NoReparsePath -Root $repoRoot -Absolute $assertScript
    Assert-NoReparsePath -Root $repoRoot -Absolute $sourcePath
    $receiptPath = Initialize-SafeReceiptPath -Root $repoRoot

    $parent = Get-Process -Id $ParentPid
    $parentStart = $parent.StartTime.ToUniversalTime().ToFileTimeUtc()
    Add-Type -Path $sourcePath

    $runnerProfile = [ShuHai.HostCommand.RunnerProfile]::new()
    $runnerProfile.Classification = [string]$profile.classification
    $runnerProfile.WallMilliseconds = [int]$profile.wallMilliseconds
    $runnerProfile.IdleMilliseconds = [int]$profile.idleMilliseconds
    $runnerProfile.StdoutBytes = [int64]$profile.stdoutBytes
    $runnerProfile.StderrBytes = [int64]$profile.stderrBytes
    $runnerProfile.AggregateBytes = [int64]$profile.aggregateBytes
    $runnerProfile.ProcessMemoryBytes = [uint64]$profile.processMemoryBytes
    $runnerProfile.JobMemoryBytes = [uint64]$profile.jobMemoryBytes
    $runnerProfile.ProcessCount = [uint32]$profile.processCount
    $runnerProfile.MutexWaitMilliseconds = [int]$profile.mutexWaitMilliseconds
    $runnerProfile.CleanupMilliseconds = [int]$profile.cleanupMilliseconds
    $runnerProfile.ChunkBytes = [int]$profile.chunkBytes
    $runnerProfile.RingBytes = [int]$profile.ringBytes

    $request = [ShuHai.HostCommand.RunnerRequest]::new()
    $request.OperationId = $OperationId
    $request.ExecutablePath = $nodePath
    $request.Arguments = [string[]]@($assertScript, $rawId) + $normalizedOperationArgs
    $request.WorkingDirectory = $repoRoot
    $request.ParentPid = $ParentPid
    $request.ParentStartFileTime = $parentStart
    $request.MutexName = [string]$registry.mutexName
    $request.ReceiptPath = $receiptPath
    $request.ReceiptMaxBytes = [int]$registry.receipt.maxBytes
    $request.Profile = $runnerProfile
    if ($null -ne $operation.PSObject.Properties['cancelAfterMilliseconds']) {
        $request.CancelAfterMilliseconds = [int]$operation.cancelAfterMilliseconds
    }
    if ($null -ne $operation.PSObject.Properties['parentExceptionAfterMilliseconds']) {
        $request.ParentExceptionAfterMilliseconds = [int]$operation.parentExceptionAfterMilliseconds
    }

    $result = [ShuHai.HostCommand.BoundedHostCommandRunner]::Run($request)
    [Console]::Out.WriteLine($result.ToJson())
    exit $result.ExitCode
}
catch {
    Write-BoundedFailure -Reason "$($_.Exception.Message):line_$($_.InvocationInfo.ScriptLineNumber)" -Code 64
}
