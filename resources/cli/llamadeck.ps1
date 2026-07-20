[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'
$ProtocolVersion = 1
$EndpointFileName = 'cli-endpoint.json'
$StartupTimeoutMilliseconds = 15000

function Write-CliHelp {
  @'
LlamaDeck command line

Usage:
  llamadeck capabilities
  llamadeck template get [<id-or-name>]
  llamadeck template list
  llamadeck template create <--file <path>|--json <json>>
  llamadeck template update <id-or-name> <--file <path>|--json <json>>
  llamadeck template delete <id-or-name> --yes
  llamadeck template validate <id-or-name>
  llamadeck template validate <--file <path>|--json <json>>
  llamadeck template start <id-or-name>
  llamadeck template stop <id-or-name>
  llamadeck template logs <id-or-name> [--tail <count>] [--follow]
  llamadeck template wait <id-or-name> --ready [--timeout <seconds>]
  llamadeck backend list
  llamadeck backend use <name-or-display-name>
  llamadeck status
  llamadeck app show
  llamadeck --version

Commands return JSON so they compose with ConvertFrom-Json:
  llamadeck template get | ConvertFrom-Json
  llamadeck template get "My Model" | ConvertFrom-Json

Use IDs instead of names in automation. Pass --file - to read a template
document from stdin. `template logs --follow` emits newline-delimited JSON.
Run `llamadeck --help --json` for machine-readable command metadata.
'@ | Write-Output
}

function Stop-WithError([string]$Message, [int]$ExitCode = 1) {
  [Console]::Error.WriteLine($Message)
  exit $ExitCode
}

function Get-EndpointCandidates {
  if ($env:LLAMADECK_CLI_ENDPOINT) {
    return @($env:LLAMADECK_CLI_ENDPOINT)
  }

  return @(
    (Join-Path $env:APPDATA "llamadeck\$EndpointFileName"),
    (Join-Path $env:APPDATA "hexllama\$EndpointFileName"),
    (Join-Path $env:APPDATA "Hexllama\$EndpointFileName")
  )
}

function Get-EndpointDescriptor {
  foreach ($candidate in Get-EndpointCandidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      continue
    }

    try {
      $descriptor = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json
      if (
        $descriptor.protocol -eq $ProtocolVersion -and
        $descriptor.pipeId -is [string] -and
        $descriptor.token -is [string]
      ) {
        return [pscustomobject]@{
          Path = $candidate
          Value = $descriptor
        }
      }
    } catch {
      continue
    }
  }

  return $null
}

function Start-LlamaDeck {
  $appExecutable = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\LlamaDeck.exe"))
  if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
    throw "LlamaDeck is not running. Start the app first, or run this command from an installed LlamaDeck package."
  }

  Start-Process -FilePath $appExecutable | Out-Null
}

function Wait-ForEndpoint([string]$PreviousToken = '') {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while ($timer.ElapsedMilliseconds -lt $StartupTimeoutMilliseconds) {
    $endpoint = Get-EndpointDescriptor
    if ($null -ne $endpoint -and (!$PreviousToken -or $endpoint.Value.token -ne $PreviousToken)) {
      return $endpoint
    }
    Start-Sleep -Milliseconds 100
  }

  throw "Timed out waiting for LlamaDeck to start."
}

function Invoke-LlamaDeckRequest($Endpoint, [string]$Command, [string[]]$Arguments) {
  $pipe = [IO.Pipes.NamedPipeClientStream]::new(
    '.',
    [string]$Endpoint.Value.pipeId,
    [IO.Pipes.PipeDirection]::InOut,
    [IO.Pipes.PipeOptions]::Asynchronous
  )

  try {
    $pipe.Connect(5000)
    $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false), 4096, $true)
    $reader = [IO.StreamReader]::new($pipe, [Text.UTF8Encoding]::new($false), $false, 4096, $true)
    try {
      $request = @{
        protocol = $ProtocolVersion
        token = [string]$Endpoint.Value.token
        command = $Command
        args = @($Arguments)
      } | ConvertTo-Json -Compress

      $writer.WriteLine($request)
      $writer.Flush()
      $responseLine = $reader.ReadLine()
      if (-not $responseLine) {
        throw "LlamaDeck closed the CLI connection without a response."
      }
      return $responseLine | ConvertFrom-Json
    } finally {
      $writer.Dispose()
      $reader.Dispose()
    }
  } finally {
    $pipe.Dispose()
  }
}

function Get-TemplateDocument([string]$InputKind, [string]$InputValue) {
  switch ($InputKind.ToLowerInvariant()) {
    '--json' {
      return $InputValue
    }
    '--file' {
      if ($InputValue -eq '-') {
        return [Console]::In.ReadToEnd()
      }
      try {
        return Get-Content -LiteralPath $InputValue -Raw
      } catch {
        Stop-WithError "Could not read template document '$InputValue': $($_.Exception.Message)" 2
      }
    }
    default {
      Stop-WithError "Expected --file <path> or --json <json>." 64
    }
  }
}

if ($CliArgs.Count -eq 0) {
  Write-CliHelp
  exit 0
}

$command = $null
$commandArgs = @()
$followLogs = $false
$logSelector = ''
$logLimit = 200

if ($CliArgs[0] -in @('help', '--help', '-h')) {
  if ($CliArgs.Count -eq 2 -and $CliArgs[1].ToLowerInvariant() -eq '--json') {
    $command = 'capabilities'
  } elseif ($CliArgs.Count -eq 1) {
    Write-CliHelp
    exit 0
  } else {
    Stop-WithError "Usage: llamadeck --help [--json]" 64
  }
}

if ($null -eq $command) {
switch ($CliArgs[0].ToLowerInvariant()) {
  'capabilities' {
    if ($CliArgs.Count -ne 1) { Stop-WithError "'capabilities' does not accept arguments." 64 }
    $command = 'capabilities'
  }
  '--version' {
    if ($CliArgs.Count -ne 1) { Stop-WithError "'--version' does not accept arguments." 64 }
    $command = 'version'
  }
  'version' {
    if ($CliArgs.Count -ne 1) { Stop-WithError "'version' does not accept arguments." 64 }
    $command = 'version'
  }
  'status' {
    if ($CliArgs.Count -ne 1) { Stop-WithError "'status' does not accept arguments." 64 }
    $command = 'status'
  }
  'app' {
    if ($CliArgs.Count -ne 2 -or $CliArgs[1].ToLowerInvariant() -ne 'show') {
      Stop-WithError "Usage: llamadeck app show" 64
    }
    $command = 'app.show'
  }
  'backend' {
    if ($CliArgs.Count -lt 2) {
      Stop-WithError "Usage: llamadeck backend <list|use> [<name-or-display-name>]" 64
    }
    switch ($CliArgs[1].ToLowerInvariant()) {
      { $_ -in @('list', 'ls') } {
        if ($CliArgs.Count -ne 2) { Stop-WithError "'backend list' does not accept arguments." 64 }
        $command = 'backend.list'
      }
      'use' {
        if ($CliArgs.Count -ne 3) { Stop-WithError "Usage: llamadeck backend use <name-or-display-name>" 64 }
        $command = 'backend.use'
        $commandArgs = @($CliArgs[2])
      }
      default {
        Stop-WithError "Unknown backend command: $($CliArgs[1])" 64
      }
    }
  }
  'template' {
    if ($CliArgs.Count -lt 2) {
      Stop-WithError "Usage: llamadeck template <get|list|create|update|delete|validate|start|stop|logs|wait>" 64
    }

    $templateCommand = $CliArgs[1].ToLowerInvariant()
    switch ($templateCommand) {
      { $_ -in @('list', 'ls') } {
        if ($CliArgs.Count -ne 2) { Stop-WithError "'template list' does not accept a selector." 64 }
        $command = 'template.list'
      }
      'get' {
        if ($CliArgs.Count -eq 2) {
          $command = 'template.list'
        } elseif ($CliArgs.Count -eq 3) {
          $command = 'template.get'
          $commandArgs = @($CliArgs[2])
        } else {
          Stop-WithError 'Quote template names that contain spaces.' 64
        }
      }
      'create' {
        if ($CliArgs.Count -ne 4) {
          Stop-WithError "Usage: llamadeck template create <--file <path>|--json <json>>" 64
        }
        $command = 'template.create'
        $commandArgs = @(Get-TemplateDocument $CliArgs[2] $CliArgs[3])
      }
      'update' {
        if ($CliArgs.Count -ne 5) {
          Stop-WithError "Usage: llamadeck template update <id-or-name> <--file <path>|--json <json>>" 64
        }
        $command = 'template.update'
        $commandArgs = @($CliArgs[2], (Get-TemplateDocument $CliArgs[3] $CliArgs[4]))
      }
      'delete' {
        if ($CliArgs.Count -ne 4 -or $CliArgs[3].ToLowerInvariant() -ne '--yes') {
          Stop-WithError "Usage: llamadeck template delete <id-or-name> --yes" 64
        }
        $command = 'template.delete'
        $commandArgs = @($CliArgs[2], 'yes')
      }
      'validate' {
        $command = 'template.validate'
        if ($CliArgs.Count -eq 3 -and $CliArgs[2] -notin @('--file', '--json')) {
          $commandArgs = @($CliArgs[2])
        } elseif ($CliArgs.Count -eq 4) {
          $commandArgs = @('document', (Get-TemplateDocument $CliArgs[2] $CliArgs[3]))
        } else {
          Stop-WithError "Usage: llamadeck template validate <id-or-name>|<--file <path>|--json <json>>" 64
        }
      }
      'start' {
        if ($CliArgs.Count -ne 3) { Stop-WithError "Usage: llamadeck template start <id-or-name>" 64 }
        $command = 'template.start'
        $commandArgs = @($CliArgs[2])
      }
      'stop' {
        if ($CliArgs.Count -ne 3) { Stop-WithError "Usage: llamadeck template stop <id-or-name>" 64 }
        $command = 'template.stop'
        $commandArgs = @($CliArgs[2])
      }
      'logs' {
        if ($CliArgs.Count -lt 3) {
          Stop-WithError "Usage: llamadeck template logs <id-or-name> [--tail <count>] [--follow]" 64
        }
        $logSelector = $CliArgs[2]
        $index = 3
        while ($index -lt $CliArgs.Count) {
          switch ($CliArgs[$index].ToLowerInvariant()) {
            '--follow' {
              $followLogs = $true
              $index += 1
            }
            '--tail' {
              if ($index + 1 -ge $CliArgs.Count -or -not [int]::TryParse($CliArgs[$index + 1], [ref]$logLimit)) {
                Stop-WithError "--tail requires an integer from 1 through 2000." 64
              }
              if ($logLimit -lt 1 -or $logLimit -gt 2000) {
                Stop-WithError "--tail requires an integer from 1 through 2000." 64
              }
              $index += 2
            }
            default {
              Stop-WithError "Unknown template logs option: $($CliArgs[$index])" 64
            }
          }
        }
        $command = 'template.logs'
        $commandArgs = @($logSelector, '0', [string]$logLimit)
      }
      'wait' {
        if ($CliArgs.Count -lt 4 -or $CliArgs[3].ToLowerInvariant() -ne '--ready') {
          Stop-WithError "Usage: llamadeck template wait <id-or-name> --ready [--timeout <seconds>]" 64
        }
        $timeoutSeconds = 120
        if ($CliArgs.Count -eq 6 -and $CliArgs[4].ToLowerInvariant() -eq '--timeout') {
          if (-not [int]::TryParse($CliArgs[5], [ref]$timeoutSeconds) -or $timeoutSeconds -lt 1 -or $timeoutSeconds -gt 3600) {
            Stop-WithError "--timeout requires an integer from 1 through 3600 seconds." 64
          }
        } elseif ($CliArgs.Count -ne 4) {
          Stop-WithError "Usage: llamadeck template wait <id-or-name> --ready [--timeout <seconds>]" 64
        }
        $command = 'template.waitReady'
        $commandArgs = @($CliArgs[2], [string]($timeoutSeconds * 1000))
      }
      default {
        Stop-WithError "Unknown template command: $templateCommand" 64
      }
    }
  }
  default {
    Stop-WithError "Unknown command: $($CliArgs[0]). Run 'llamadeck --help' for usage." 64
  }
}
}

$endpoint = Get-EndpointDescriptor
if ($null -eq $endpoint) {
  try {
    Start-LlamaDeck
    $endpoint = Wait-ForEndpoint
  } catch {
    Stop-WithError $_.Exception.Message
  }
}

try {
  $response = Invoke-LlamaDeckRequest $endpoint $command $commandArgs
} catch {
  try {
    $previousToken = [string]$endpoint.Value.token
    Start-LlamaDeck
    $endpoint = Wait-ForEndpoint $previousToken
    $response = Invoke-LlamaDeckRequest $endpoint $command $commandArgs
  } catch {
    Stop-WithError $_.Exception.Message
  }
}

if (-not $response.ok) {
  $exitCode = if ($response.exitCode -is [int] -or $response.exitCode -is [long]) {
    [int]$response.exitCode
  } else {
    1
  }
  Stop-WithError ([string]$response.error) $exitCode
}

if ($followLogs) {
  while ($true) {
    if ($null -ne $response.result.events) {
      foreach ($event in $response.result.events) {
        ConvertTo-Json -InputObject $event -Depth 100 -Compress | Write-Output
      }
    }
    if (-not [bool]$response.result.running -and -not [bool]$response.result.hasMore) {
      exit 0
    }

    $cursor = [string]$response.result.nextCursor
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-LlamaDeckRequest $endpoint 'template.logs' @($logSelector, $cursor, [string]$logLimit)
    } catch {
      Stop-WithError $_.Exception.Message
    }
    if (-not $response.ok) {
      $exitCode = if ($response.exitCode -is [int] -or $response.exitCode -is [long]) {
        [int]$response.exitCode
      } else {
        1
      }
      Stop-WithError ([string]$response.error) $exitCode
    }
  }
}

if ($null -eq $response.result) {
  'null' | Write-Output
} else {
  ConvertTo-Json -InputObject $response.result -Depth 100 -Compress | Write-Output
}

if ($command -eq 'template.validate' -and -not [bool]$response.result.valid) {
  exit 2
}
