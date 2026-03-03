# ─────────────────────────────────────────────────────────────────────────────
#  Snake game test runner — drives the GitWeaver orchestrator
#
#  Toggle:
#    $HD = $false   → simple snake game prompt
#    $HD = $true    → fully-featured HD snake game prompt
# ─────────────────────────────────────────────────────────────────────────────

$HD = $false

# ─── Prompts ──────────────────────────────────────────────────────────────────

$SimplePrompt = @"
Create a simple snake game as a single self-contained HTML file called snake-game.html in the project root.
Requirements:
- Canvas-based rendering
- 20x20 grid, green snake on black background, red food
- Arrow keys and WASD controls
- Score display
- Game over on wall or self collision, R to restart
No dependencies, no build step — just a single HTML file that opens in a browser.
"@

$HdPrompt = @"
Create a highly polished, visually impressive snake game as a single self-contained HTML file called snake-game.html in the project root.
Requirements:
- Canvas-based with a neon/cyberpunk aesthetic
- Animated background (scrolling grid or starfield)
- Gradient snake body (bright cyan head fading to deep blue/purple tail), rounded segments, visible eyes on the head
- Pulsing glowing food with inner highlight; occasional spinning bonus star food item that expires after a few seconds
- Particle burst and floating score text (+N) on every food eaten
- Screen shake on death
- Combo multiplier system (up to x8), displayed in HUD
- Level progression — speed increases every 5 food, level shown in HUD
- High score persisted to localStorage
- Web Audio API sound effects for eat, bonus pickup, and death
- Pause with Space, restart with R
- Animated title screen and game-over overlay with final score and high score
- HUD shows: score, high score, level badge, combo, snake length
No dependencies, no build step — just a single HTML file that opens in a browser.
"@

# ─── Run ──────────────────────────────────────────────────────────────────────

$Prompt = if ($HD) { $HdPrompt } else { $SimplePrompt }
$Mode   = if ($HD) { "HD (neon/cyberpunk)" } else { "Simple" }

Write-Host ""
Write-Host "  [snake] mode   : $Mode" -ForegroundColor Cyan
Write-Host "  [snake] working: $PSScriptRoot\.." -ForegroundColor DarkGray
Write-Host ""

Set-Location (Join-Path $PSScriptRoot "..")
pnpm dev run $Prompt --dev-mode
