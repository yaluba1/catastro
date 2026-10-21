"""
Script para validar la integridad del marcado SEO y JSON-LD de la web app.
"""

import json
import re
import os

def validate_seo():
    html_path = os.path.join("web", "index.html")
    assert os.path.exists(html_path), "No existe web/index.html"
    
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()
        
    # 1. Validar etiquetas meta esenciales
    assert '<meta name="description"' in html, "Falta meta description"
    assert '<link rel="canonical"' in html, "Falta link canonical"
    assert '<meta property="og:image"' in html, "Falta og:image"
    assert '<meta name="twitter:card"' in html, "Falta twitter:card"
    
    # 2. Validar JSON-LD
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
    assert m, "No se encontró bloque application/ld+json"
    
    json_text = m.group(1).strip()
    data = json.loads(json_text)
    
    types = [item.get("@type") for item in data.get("@graph", [])]
    print(f"[OK] JSON-LD parseado correctamente.")
    print(f"[OK] Tipos Schema.org encontrados en @graph: {types}")
    
    # 3. Validar existencia física de la imagen OG
    og_img_path = os.path.join("web", "img", "og-image.png")
    assert os.path.exists(og_img_path), "No existe web/img/og-image.png"
    print(f"[OK] Imagen OG verificada en disco: {og_img_path} ({os.path.getsize(og_img_path)} bytes)")
    
    # 4. Validar robots.txt y sitemap.xml
    assert os.path.exists(os.path.join("web", "robots.txt")), "No existe robots.txt"
    assert os.path.exists(os.path.join("web", "sitemap.xml")), "No existe sitemap.xml"
    print(f"[OK] Archivos robots.txt y sitemap.xml presentes.")
    
    print("\nTodos los chequeos SEO han pasado con exito!")

if __name__ == "__main__":
    validate_seo()

