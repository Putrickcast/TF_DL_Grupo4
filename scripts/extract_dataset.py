"""Build the JSON dataset used by the Angular demo.

The final app should not parse Excel in the browser. This script keeps the data
preparation step explicit and reproducible: it reads the two required sheets,
normalizes field names, joins Spanish reviews by Airbnb ID, and writes a compact
JSON artifact under public/data/listings.json.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
INPUT_XLSX = Path(r"C:/TF_DL/G4_mod_finale.xlsx")
OUTPUT_JSON = ROOT / "public" / "data" / "listings.json"


def clean_text(value: Any) -> str:
    """Return readable text from an Excel cell without losing Spanish accents."""

    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def number(value: Any, default: float = 0.0) -> float:
    """Parse Excel numeric cells and string-like numbers consistently."""

    if value is None or (isinstance(value, float) and math.isnan(value)):
        return default
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return default


def yes_no(value: Any) -> bool:
    return clean_text(value).upper() == "SI"


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def quick_sentiment(text: str) -> str:
    """Lightweight Spanish lexicon used only to summarize the dataset artifact."""

    positive = {
        "excelente",
        "bueno",
        "buena",
        "bonito",
        "bonita",
        "limpio",
        "limpia",
        "agradable",
        "recomendado",
        "recomiendo",
        "perfecta",
        "perfecto",
        "cómodo",
        "comodo",
        "acogedor",
        "increíble",
        "increible",
    }
    negative = {
        "malo",
        "mala",
        "sucio",
        "sucia",
        "ruido",
        "problema",
        "problemas",
        "odio",
        "desafortunadamente",
        "difícil",
        "dificil",
        "incómodo",
        "incomodo",
    }
    words = {w.lower() for w in re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", text)}
    pos = len(words & positive)
    neg = len(words & negative)
    if pos > neg:
        return "positivo"
    if neg > pos:
        return "alerta"
    return "neutro"


def build_dataset() -> dict[str, Any]:
    principal_raw = pd.read_excel(INPUT_XLSX, sheet_name="Principal", header=None)
    reviews_raw = pd.read_excel(INPUT_XLSX, sheet_name="Reviews")

    headers = [clean_text(value) for value in principal_raw.iloc[1].tolist()]
    principal = principal_raw.iloc[2:].copy()
    principal.columns = headers
    principal = principal.dropna(how="all")

    reviews_by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for _, row in reviews_raw.iterrows():
        listing_id = clean_text(row.get("ID Airbnb"))
        review_text = clean_text(row.get("Reseña (Debe estar solo en español)"))
        if not listing_id or not review_text or review_text == ".":
            continue
        reviews_by_id[listing_id].append(
            {
                "date": clean_text(row.get("Fecha de colecta")),
                "index": int(number(row.get("#Review"), 0)),
                "text": review_text,
                "sentimentHint": quick_sentiment(review_text),
            }
        )

    listings: list[dict[str, Any]] = []
    for _, row in principal.iterrows():
        listing_id = clean_text(row.get("ID Airbnb"))
        if not listing_id:
            continue

        reviews = reviews_by_id.get(listing_id, [])
        title = clean_text(row.get("Título de cabecera"))
        description = clean_text(row.get("Acerca de este espacio"))
        recognition = clean_text(row.get("Reconocimiento de Airbnb"))
        summary = clean_text(row.get("Resumen de la propiedad"))

        listings.append(
            {
                "id": listing_id,
                "city": clean_text(row.get("Ciudad")),
                "district": clean_text(row.get("Distrito")),
                "collectionDate": clean_text(row.get("Fecha de colecta")),
                "host": clean_text(row.get("Alias")),
                "canonicalUrl": clean_text(row.get("URL Canónica")),
                "title": title,
                "propertyTitle": clean_text(row.get("Título de la propiedad")),
                "summary": summary,
                "recognition": recognition,
                "description": description,
                "superhost": yes_no(row.get("¿Es superhost?")),
                "verifiedIdentity": yes_no(row.get("¿Identidad verificada del host?")),
                "hostHasPhoto": yes_no(row.get("¿Host tiene foto de perfil?")),
                "hostYears": number(row.get("Tiempo como host en años")),
                "exactLocation": yes_no(row.get("Ubicación exacta")),
                "bedType": number(row.get("Tipo de cama")),
                "rooms": number(row.get("Número de cuartos o habitaciones")),
                "accommodationType": number(row.get("Tipo de alojamiento")),
                "amenities": number(row.get("Número de servicios o amenidades")),
                "price": number(row.get("Precio por noche")),
                "rating": number(row.get("Promedio de reviews o calificaión")),
                "instantBookable": yes_no(row.get("Instant bookable")),
                "cancellationPolicy": number(row.get("Política de cancelación")),
                "guestPhoneRequired": yes_no(row.get("Verificar teléfono de huésped")),
                "availabilityOver90": yes_no(row.get("Disponibilidad mayor a 90 días")),
                "reviewCountExcel": int(number(row.get("Número de reviews o reseñas"), 0)),
                "reviewCountMatched": len(reviews),
                "reviews": reviews,
                "searchText": " ".join([title, summary, recognition, description]).lower(),
            }
        )

    matched = sum(1 for item in listings if item["reviewCountMatched"] > 0)
    topic_counter = Counter()
    for item in listings:
        text = " ".join(review["text"].lower() for review in item["reviews"])
        for topic, variants in {
            "limpieza": ["limpio", "limpia", "impecable", "ordenado"],
            "ubicación": ["ubicación", "ubicacion", "barranco", "malecón", "malecon", "cerca"],
            "anfitrión": ["anfitrión", "anfitrion", "host", "respuesta", "atento"],
            "comodidad": ["cómodo", "comodo", "cama", "acogedor", "descansar"],
            "precio": ["precio", "calidad", "valor"],
        }.items():
            if any(variant in text for variant in variants):
                topic_counter[topic] += 1

    return {
        "meta": {
            "sourceWorkbook": str(INPUT_XLSX),
            "generatedFromSheets": ["Principal", "Reviews"],
            "context": "Trabajo final Deep Learning multimodal - Airbnb Barranco, Lima",
            "listingCount": len(listings),
            "reviewCount": sum(item["reviewCountMatched"] for item in listings),
            "matchedListingCount": matched,
            "unmatchedListingCount": len(listings) - matched,
            "district": "Barranco",
            "imagePolicy": (
                "El Excel no trae fotos. Las fotos reales se referencian desde "
                "public/data/image-manifest.json y se guardan localmente en public/img/<ID Airbnb>/."
            ),
            "fusionWeights": {"vision": 1 / 3, "tabular": 1 / 3, "reviews": 1 / 3},
            "decisionThresholds": {
                "recommended": 75,
                "review": 50,
                "notRecommendedBelow": 50,
            },
            "topReviewTopics": topic_counter.most_common(),
        },
        "listings": listings,
    }


def main() -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    dataset = build_dataset()
    OUTPUT_JSON.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")
    print(
        f"{dataset['meta']['listingCount']} listings, "
        f"{dataset['meta']['reviewCount']} matched reviews"
    )


if __name__ == "__main__":
    main()
