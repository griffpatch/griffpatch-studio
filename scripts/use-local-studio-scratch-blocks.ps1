[CmdletBinding()]
param(
    [string]$ScratchBlocksPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ScratchBlocksPath)) {
    $ScratchBlocksPath = Join-Path $PSScriptRoot '..\..\scratch-blocks'
}

$guiRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = (Resolve-Path -LiteralPath $ScratchBlocksPath).Path
$dependencyRoot = (Resolve-Path -LiteralPath (Join-Path $guiRoot 'node_modules\scratch-blocks')).Path
$bundles = @(
    'blockly_compressed_horizontal.js',
    'blockly_compressed_vertical.js'
)

function Get-StudioBundleHash([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

foreach ($bundle in $bundles) {
    $source = Join-Path $sourceRoot $bundle
    $destination = Join-Path $dependencyRoot $bundle
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Scratch Blocks bundle is missing: $source"
    }
    if (-not (Select-String -LiteralPath $source -SimpleMatch 'snapDraggedBlockToConnection' -Quiet)) {
        throw "Scratch Blocks bundle does not contain the Studio alignment patch: $source"
    }
    foreach ($capability in @('setConnectionPreviewTarget', 'getConnectionPreview', 'whenBlockOperationsComplete', 'addBlockDragListener', 'createTransitionWorkspace', 'previewConnection', 'setDragOrigin', 'rollbackOutsideDrag', 'suspendUndoRecording', 'setBlockSpacingHandler', 'applyBlockSpacing')) {
        if (-not (Select-String -LiteralPath $source -SimpleMatch $capability -Quiet)) {
            throw "Scratch Blocks bundle lacks the Studio integration capability ${capability}: $source"
        }
    }
    if ($bundle -eq 'blockly_compressed_vertical.js' -and
        -not (Select-String -LiteralPath $source -SimpleMatch 'setStatementInputPreview' -Quiet)) {
        throw "Scratch Blocks bundle lacks read-only statement shape presentation: $source"
    }
    if ($bundle -eq 'blockly_compressed_vertical.js' -and
        -not (Select-String -LiteralPath $source -SimpleMatch 'setStatementSpacerSize' -Quiet)) {
        throw "Scratch Blocks bundle lacks read-only keyboard spacer sizing: $source"
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $sourceHash = Get-StudioBundleHash $source
    $destinationHash = Get-StudioBundleHash $destination
    if ($sourceHash -ne $destinationHash) {
        throw "Scratch Blocks bundle copy did not verify: $bundle"
    }
}

Write-Output "Installed the patched local Scratch Blocks bundles from $sourceRoot"
Write-Output 'Restart npm start after running this command; webpack does not watch dependency files.'
