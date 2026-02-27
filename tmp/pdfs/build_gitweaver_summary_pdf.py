from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

ROOT = Path(r"c:/Users/dmedl/Projects/GitWeaver")
OUTPUT_PDF = ROOT / "output" / "pdf" / "gitweaver_app_summary.pdf"
OUTPUT_PNG = ROOT / "tmp" / "pdfs" / "gitweaver_app_summary_page1.png"

TITLE = "GitWeaver Orchestrator - One-Page App Summary"

WHAT_IT_IS = (
    "GitWeaver Orchestrator is a local Node.js + TypeScript CLI runtime that coordinates "
    "Codex, Claude, and Gemini for repository tasks. It plans work as a task DAG, executes "
    "tasks in isolated git worktrees, and integrates only verified commits."
)

WHO_ITS_FOR = (
    "Primary persona: Not found in repo. Inferred from README and CLI commands: engineers "
    "maintaining Git repositories who want governed multi-provider AI coding workflows from "
    "the terminal."
)

WHAT_IT_DOES = [
    "Runs objective prompts via `orchestrator run` with progress updates and optional JSON output.",
    "Performs two-stage provider preflight for install, version, and auth readiness across Codex, Claude, and Gemini.",
    "Builds schema-validated DAG plans with Codex, then audits and freezes immutable task contracts.",
    "Routes tasks by type and provider health, and schedules dispatch with provider token buckets.",
    "Executes tasks in temporary git worktrees with write leases, fencing tokens, and sandboxed environment variables.",
    "Applies verification gates: write-scope policy, expected outputs/exports/tests, and post-merge gate commands.",
    "Persists run state in SQLite plus NDJSON event logs; supports `resume`, `status`, `inspect`, and `locks` commands."
]

HOW_IT_WORKS = [
    "Components: CLI (`src/cli/*`) -> Orchestrator core (`src/core/orchestrator.ts`) -> Planning (`src/planning/*`) -> Routing/Execution (`src/providers/*`, `src/scheduler/*`, `src/execution/*`) -> Verification (`src/verification/*`) -> Persistence (`src/persistence/*`).",
    "Services: provider adapters, lock manager + lease heartbeat, merge queue, worktree manager, and sandbox environment builder.",
    "Data stores: `.orchestrator/state.sqlite`, per-run plan/manifest JSON files, and append-only `.orchestrator/runs/<run-id>/events.ndjson`.",
    "Flow: prompt -> preflight A -> baseline gate -> DAG plan/audit/freeze -> preflight B -> dispatch and execute -> scope/output/gate checks -> cherry-pick integration -> persisted outcomes."
]

HOW_TO_RUN = [
    "Prereq: Node.js >= 24 (from `package.json` engines).",
    "Install and build: `pnpm install` then `pnpm build`.",
    "Check provider readiness: `orchestrator providers check` (and if needed `orchestrator providers install --yes` and `orchestrator providers auth --fix`).",
    "Run in dev mode: `pnpm dev run \"your objective\"` (or built binary: `orchestrator run \"your objective\"`)."
]


def wrap_text(text: str, font_name: str, font_size: float, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if stringWidth(trial, font_name, font_size) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, font_name: str, font_size: float, leading: float, draw: bool) -> float:
    lines = wrap_text(text, font_name, font_size, width)
    for line in lines:
        if draw:
            c.setFont(font_name, font_size)
            c.drawString(x, y, line)
        y -= leading
    return y


def draw_bullets(c: canvas.Canvas, items: list[str], x: float, y: float, width: float, font_name: str, font_size: float, leading: float, draw: bool) -> float:
    bullet = "-"
    bullet_w = stringWidth(f"{bullet} ", font_name, font_size)
    for item in items:
        lines = wrap_text(item, font_name, font_size, width - bullet_w)
        for i, line in enumerate(lines):
            if draw:
                c.setFont(font_name, font_size)
                if i == 0:
                    c.drawString(x, y, f"{bullet} {line}")
                else:
                    c.drawString(x + bullet_w, y, line)
            y -= leading
        y -= leading * 0.15
    return y


def render_layout(c: canvas.Canvas, body_size: float, heading_size: float, title_size: float, draw: bool) -> float:
    page_w, page_h = letter
    margin = 38
    content_w = page_w - (margin * 2)
    y = page_h - margin

    title_leading = title_size * 1.18
    heading_leading = heading_size * 1.25
    body_leading = body_size * 1.22

    if draw:
        c.setTitle("GitWeaver App Summary")
        c.setAuthor("Codex")

    if draw:
        c.setFont("Helvetica-Bold", title_size)
        c.drawString(margin, y, TITLE)
    y -= title_leading

    subtitle = "Evidence basis: README.md, package.json, src/cli/*, src/core/*, src/planning/*, src/providers/*, src/scheduler/*, src/execution/*, src/verification/*, src/persistence/*"
    y = draw_wrapped(c, subtitle, margin, y, content_w, "Helvetica-Oblique", body_size - 0.3, body_leading, draw)
    y -= body_leading * 0.2

    def heading(text: str, yy: float) -> float:
        if draw:
            c.setFont("Helvetica-Bold", heading_size)
            c.drawString(margin, yy, text)
        return yy - heading_leading

    y = heading("What it is", y)
    y = draw_wrapped(c, WHAT_IT_IS, margin, y, content_w, "Helvetica", body_size, body_leading, draw)
    y -= body_leading * 0.2

    y = heading("Who it is for", y)
    y = draw_wrapped(c, WHO_ITS_FOR, margin, y, content_w, "Helvetica", body_size, body_leading, draw)
    y -= body_leading * 0.2

    y = heading("What it does", y)
    y = draw_bullets(c, WHAT_IT_DOES, margin, y, content_w, "Helvetica", body_size, body_leading, draw)
    y -= body_leading * 0.15

    y = heading("How it works", y)
    y = draw_bullets(c, HOW_IT_WORKS, margin, y, content_w, "Helvetica", body_size, body_leading, draw)
    y -= body_leading * 0.1

    y = heading("How to run", y)
    y = draw_bullets(c, HOW_TO_RUN, margin, y, content_w, "Helvetica", body_size, body_leading, draw)

    return y


def create_pdf() -> None:
    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)

    choices = [
        (9.2, 11.0, 16.0),
        (8.9, 10.8, 15.5),
        (8.6, 10.5, 15.0),
        (8.3, 10.2, 14.6),
    ]

    selected = None
    for body_size, heading_size, title_size in choices:
        probe = canvas.Canvas(str(OUTPUT_PDF), pagesize=letter)
        final_y = render_layout(probe, body_size, heading_size, title_size, draw=False)
        probe._code = []
        if final_y > 24:
            selected = (body_size, heading_size, title_size)
            break

    if selected is None:
        raise RuntimeError("Unable to fit content on one page with available font sizes")

    body_size, heading_size, title_size = selected
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=letter)
    final_y = render_layout(c, body_size, heading_size, title_size, draw=True)
    if final_y <= 24:
        raise RuntimeError("Layout overflow detected")
    c.showPage()
    c.save()


def render_preview_png() -> None:
    import pypdfium2 as pdfium

    OUTPUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(OUTPUT_PDF))
    try:
        page = doc[0]
        try:
            bitmap = page.render(scale=2.0)
            pil_image = bitmap.to_pil()
            pil_image.save(OUTPUT_PNG)
        finally:
            page.close()
    finally:
        doc.close()


if __name__ == "__main__":
    create_pdf()
    render_preview_png()
    print(str(OUTPUT_PDF))
    print(str(OUTPUT_PNG))
