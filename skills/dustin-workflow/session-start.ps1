[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SKILL.md') -Raw -Encoding utf8 | Write-Output
