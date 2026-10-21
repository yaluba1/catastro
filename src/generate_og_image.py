"""
Script para generar la imagen Open Graph (OG) oficial de 1200x630 px
para Visor de Catastro de Yaluba.
"""

import os
from PIL import Image, ImageDraw, ImageFont

def generate_og_image():
    width = 1200
    height = 630
    
    # Crear lienzo base con fondo oscuro y elegante
    img = Image.new("RGBA", (width, height), (13, 21, 15, 255))
    draw = ImageDraw.Draw(img)
    
    # Gradiente sutil o detalles de fondo decorativos
    for y in range(height):
        # Gradiente suave de arriba a abajo: de (16, 26, 18) a (9, 15, 11)
        r = int(16 - (y / height) * 7)
        g = int(26 - (y / height) * 11)
        b = int(18 - (y / height) * 7)
        draw.line([(0, y), (width, y)], fill=(r, g, b, 255))
    
    # Bordes decorativos con los colores de marca
    # Línea superior en Verde Pistacho (#7DA92E)
    draw.rectangle([0, 0, width, 8], fill=(125, 169, 46, 255))
    # Acento en Naranja Calabaza (#FF7518) en la esquina superior derecha
    draw.rectangle([width - 240, 0, width, 8], fill=(255, 117, 24, 255))
    
    # Recuadro interior sutil
    draw.rounded_rectangle([32, 32, width - 32, height - 32], radius=24, outline=(38, 58, 42, 255), width=2)
    
    # Cargar fuentes disponibles en Windows
    font_paths = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf"
    ]
    font_bold_path = next((f for f in font_paths if os.path.exists(f)), None)
    
    font_regular_paths = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf"
    ]
    font_reg_path = next((f for f in font_regular_paths if os.path.exists(f)), None)
    
    font_title = ImageFont.truetype(font_bold_path, 54) if font_bold_path else ImageFont.load_default()
    font_sub = ImageFont.truetype(font_reg_path, 25) if font_reg_path else ImageFont.load_default()
    font_tag = ImageFont.truetype(font_bold_path, 18) if font_bold_path else ImageFont.load_default()
    font_pill = ImageFont.truetype(font_bold_path, 20) if font_bold_path else ImageFont.load_default()
    font_footer = ImageFont.truetype(font_reg_path, 18) if font_reg_path else ImageFont.load_default()
    
    # Pegar Logo si existe
    logo_path = os.path.join("web", "img", "yaluba_logo.png")
    if os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path).convert("RGBA")
            # Redimensionar conservando proporción (ancho ~260px)
            aspect = logo.height / logo.width
            target_w = 260
            target_h = int(target_w * aspect)
            logo_resized = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
            img.alpha_composite(logo_resized, (80, 80))
        except Exception as e:
            print(f"Aviso al cargar logo: {e}")
            
    # Etiqueta badge "SEDE ELECTRÓNICA OFICIAL & CARTOGRAFÍA"
    draw.rounded_rectangle([420, 95, 870, 135], radius=20, fill=(29, 44, 32, 255), outline=(125, 169, 46, 255), width=1)
    draw.text((440, 103), "SEDE ELECTRÓNICA OFICIAL & CARTOGRAFÍA", fill=(148, 196, 56, 255), font=font_tag)
    
    # Título Principal
    draw.text((80, 200), "Visor de Catastro", fill=(255, 255, 255, 255), font=font_title)
    
    # Subtítulo descriptivo
    sub_text = "Consulta de Referencias Catastrales, Parcelas, Linderos y Superficies en España"
    draw.text((80, 275), sub_text, fill=(200, 216, 201, 255), font=font_sub)
    
    # Grid de 4 Pills / Características destacadas
    pills = [
        ("📍 Búsqueda por Ref. Catastral o GPS", 80, 350, 480, 410),
        ("🛰️ Ortofoto Satelital PNOA de Alta Resolución", 600, 350, 1100, 410),
        ("🗺️ Capa WMS Oficial de Linderos Catastrales", 80, 435, 530, 495),
        ("🏛️ Datos de Cultivos, Superficies y Registro", 570, 435, 1050, 495),
    ]
    
    for text, x1, y1, x2, y2 in pills:
        draw.rounded_rectangle([x1, y1, x2, y2], radius=14, fill=(22, 34, 25, 255), outline=(50, 75, 55, 255), width=1)
        draw.text((x1 + 20, y1 + 18), text, fill=(240, 245, 240, 255), font=font_pill)
        
    # Pie de página / branding
    footer_text = "yaluba.com  •  Datos oficiales de la Dirección General del Catastro y el IGN"
    draw.text((80, 545), footer_text, fill=(140, 165, 145, 255), font=font_footer)
    
    # Detalle verde pistacho en el footer
    draw.rectangle([80, 575, 200, 577], fill=(125, 169, 46, 255))
    draw.rectangle([205, 575, 250, 577], fill=(255, 117, 24, 255))
    
    # Guardar en web/img/og-image.png
    out_dir = os.path.join("web", "img")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "og-image.png")
    
    # Convertir a RGB para máxima compatibilidad con parsers de Open Graph (Facebook, WhatsApp, Twitter, LinkedIn)
    rgb_img = Image.new("RGB", (width, height), (13, 21, 15))
    rgb_img.paste(img, mask=img.split()[3])
    rgb_img.save(out_path, format="PNG", optimize=True)
    
    print(f"Imagen OG generada exitosamente en: {out_path} ({width}x{height} px)")

if __name__ == "__main__":
    generate_og_image()

