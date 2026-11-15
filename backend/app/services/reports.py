"""Report generation: CSV (streaming) and PDF (reportlab) documents."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Iterable

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..models import HeatRecord
from . import energy

NAVY = colors.HexColor("#0B1220")
ACCENT = colors.HexColor("#1D4ED8")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#D8DFEA")


def _styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="FO",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.HexColor("#1F2937"),
            leading=13,
        )
    )
    styles.add(
        ParagraphStyle(
            name="FOH1",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            textColor=NAVY,
            spaceAfter=2,
        )
    )
    styles.add(
        ParagraphStyle(
            name="FOH2",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11.5,
            textColor=ACCENT,
            spaceBefore=10,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(name="FOSmall", parent=styles["FO"], fontSize=7.5, textColor=MUTED)
    )
    return styles


def _table(rows: list[list[Any]], widths: list[float] | None = None, header: bool = False) -> Table:
    table = Table(rows, colWidths=widths, hAlign="LEFT")
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.2),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1F2937")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2FF")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT),
        ]
    table.setStyle(TableStyle(style))
    return table


def _doc(buffer: io.BytesIO, title: str) -> SimpleDocTemplate:
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title,
        author="ForgeOptima AI",
    )
    return doc


def _header(styles, title: str, subtitle: str) -> list:
    stamp = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    return [
        Paragraph("FORGEOPTIMA AI", styles["FOSmall"]),
        Paragraph(title, styles["FOH1"]),
        Paragraph(subtitle, styles["FO"]),
        Paragraph(f"Generated {stamp} · Decision-support document · Synthetic/simulated data is labelled", styles["FOSmall"]),
        Spacer(1, 8),
    ]


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(16 * mm, 10 * mm, "ForgeOptima AI · Predict Smarter. Optimize Energy. Melt Efficiently.")
    canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def heat_report_pdf(heat: HeatRecord, predictions: list[dict[str, Any]], similar: list[dict[str, Any]], reference_epk: float | None) -> bytes:
    buffer = io.BytesIO()
    styles = _styles()
    doc = _doc(buffer, f"Heat Report {heat.heat_id}")
    story = _header(styles, f"Heat Report — {heat.heat_id}", f"{heat.metal_grade} · {heat.charge_weight_kg:,.0f} kg charge · {heat.source}")

    stage_rows = [
        ["Parameter", "Value", "Parameter", "Value"],
        ["Metal grade", heat.metal_grade, "Charge weight", f"{heat.charge_weight_kg:,.0f} kg"],
        ["Initial temperature", f"{heat.initial_temp_c:.0f} °C", "Target temperature", f"{heat.target_temp_c:.0f} °C"],
        ["Average power", f"{heat.power_kw:,.0f} kW", "Average current", f"{heat.current_a:,.0f} A"],
        ["Melting time", f"{heat.melting_time_min:.0f} min", "Energy consumed", f"{heat.energy_kwh:,.1f} kWh"],
        ["Energy per kg", f"{energy.energy_per_kg(heat):.3f} kWh/kg", "Heat status", heat.heat_status],
        ["Started", heat.heat_started_at.strftime("%Y-%m-%d %H:%M"), "Data source", "Synthetic" if heat.is_synthetic else heat.source],
    ]
    story.append(_table(stage_rows, header=True))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Model predictions vs actual", styles["FOH2"]))
    if predictions:
        rows = [["Model", "Predicted", "Actual", "Error", "Model version"]]
        for p in predictions:
            rows.append(
                [
                    p["model_name"].replace("_", " ").title(),
                    f"{p['predicted_value']:.1f} {p['unit']}",
                    f"{p['actual_value']:.1f} {p['unit']}" if p.get("actual_value") is not None else "n/a",
                    f"{p['abs_error']:.1f}" if p.get("abs_error") is not None else "n/a",
                    p["model_version"],
                ]
            )
        story.append(_table(rows, header=True))
    else:
        story.append(Paragraph("No stored predictions for this heat.", styles["FO"]))

    story.append(Paragraph("Benchmark comparison", styles["FOH2"]))
    if reference_epk:
        actual = energy.energy_per_kg(heat)
        score = energy.efficiency_score(actual, reference_epk)
        delta = (actual - reference_epk) / reference_epk * 100
        story.append(
            Paragraph(
                f"Grade benchmark (10th percentile of comparable heats): {reference_epk:.3f} kWh/kg. "
                f"This heat: {actual:.3f} kWh/kg ({delta:+.1f}% vs benchmark). "
                f"Efficiency score: {score:.1f}/100.",
                styles["FO"],
            )
        )
    else:
        story.append(Paragraph("No benchmark available for this grade.", styles["FO"]))

    story.append(Paragraph("Comparable historical heats", styles["FOH2"]))
    if similar:
        rows = [["Heat ID", "Grade", "Charge (kg)", "Power (kW)", "Time (min)", "Energy (kWh)", "kWh/kg"]]
        for s in similar:
            rows.append(
                [
                    s["heat_id"],
                    s["metal_grade"],
                    f"{s['charge_weight_kg']:,.0f}",
                    f"{s['power_kw']:,.0f}",
                    f"{s['melting_time_min']:.0f}",
                    f"{s['energy_kwh']:,.0f}",
                    f"{s['energy_per_kg']:.3f}",
                ]
            )
        story.append(_table(rows, header=True))
    else:
        story.append(Paragraph("No similar heats available.", styles["FO"]))

    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Predictions are model estimates with documented error metrics; they are not measurements. "
            "This report supports review by a qualified operator and does not authorise control actions.",
            styles["FOSmall"],
        )
    )
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def generic_pdf(title: str, subtitle: str, sections: list[tuple[str, str]], tables: list[tuple[str, list[list[Any]]]]) -> bytes:
    buffer = io.BytesIO()
    styles = _styles()
    doc = _doc(buffer, title)
    story = _header(styles, title, subtitle)
    for heading, body in sections:
        story.append(Paragraph(heading, styles["FOH2"]))
        story.append(Paragraph(body, styles["FO"]))
    for heading, rows in tables:
        story.append(Paragraph(heading, styles["FOH2"]))
        if rows:
            story.append(_table(rows, header=True))
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Generated by ForgeOptima AI. Where synthetic or simulated data is used it is labelled; "
            "estimated emissions are not verified environmental measurements.",
            styles["FOSmall"],
        )
    )
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def to_csv(headers: list[str], rows: Iterable[Iterable[Any]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue().encode("utf-8-sig")
