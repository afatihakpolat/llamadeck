[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('add', 'remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$CliDirectory
)

$normalizedCliDirectory = [IO.Path]::GetFullPath($CliDirectory).TrimEnd('\')
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($currentPath -split ';' | Where-Object { $_.Trim() })
$filteredEntries = @(
  $entries | Where-Object {
    try {
      -not [string]::Equals(
        [IO.Path]::GetFullPath($_.Trim()).TrimEnd('\'),
        $normalizedCliDirectory,
        [StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      $true
    }
  }
)

if ($Action -eq 'add') {
  $filteredEntries += $normalizedCliDirectory
}

[Environment]::SetEnvironmentVariable('Path', ($filteredEntries -join ';'), 'User')
