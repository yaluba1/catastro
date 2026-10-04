"""
Módulo CLI para la consulta y exportación de referencias catastrales a CSV.

Este script permite consultar una o más referencias catastrales españolas (tanto fincas
rústicas como inmuebles urbanos: pisos, locales, naves, chalets) utilizando los servicios
web públicos y gratuitos de la Sede Electrónica del Catastro (OVC).

Información extraída:
    - Referencia catastral normalizada (20 caracteres).
    - Clase de inmueble: Rústico vs Urbano.
    - Población, municipio y provincia.
    - Tamaño: Superficie de parcela/terreno para rústicos vs superficie construida para pisos.
    - Enlace a Google Maps centrado en la referencia (coordenadas GPS WGS84).
    - Uso principal (Residencial, Agrario, Comercial, etc.).
    - Año de construcción y coeficiente de participación horizontal (en urbanos).
    - Dirección normalizada o paraje rústico.
    - Desglose de cultivos/subparcelas (rústicos) o locales/plantas/puertas (urbanos).
    - Enlace directo a la ficha del inmueble en la Sede Electrónica del Catastro.

Ejemplos de uso desde terminal:
    # 1. Consultar una sola referencia:
    uv run python src/consultar_catastro.py 40204A006000510000JM

    # 2. Consultar varias referencias combinando rústicas y urbanas:
    uv run python src/consultar_catastro.py 40204A006000510000JM 5740104VL0354S0003IY

    # 3. Guardar en un archivo CSV personalizado:
    uv run python src/consultar_catastro.py 40204A006000510000JM --output fincas.csv

    # 4. Leer referencias desde un archivo de texto (una por línea):
    uv run python src/consultar_catastro.py --file referencias.txt --output resultado.csv
"""

import argparse
import csv
import logging
import os
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)

NS = {"cat": "http://www.catastro.meh.es/"}


def clean_cadastral_reference(rc: str) -> str:
    """
    Normaliza una cadena de referencia catastral eliminando espacios, guiones y tabulaciones.

    Args:
        rc (str): Cadena de texto con la referencia catastral.

    Returns:
        str: Referencia catastral limpia en letras mayúsculas.
    """
    return rc.strip().replace(" ", "").replace("-", "").upper()


def query_dnprc(rc: str, retries: int = 3, timeout: int = 15) -> Dict[str, Any]:
    """
    Consulta los Datos No Protegidos de un inmueble por Referencia Catastral (DNPRC) en la OVC.

    Soporta inmuebles rústicos (parcelas, cultivos, subparcelas) e inmuebles urbanos
    (viviendas, pisos en división horizontal, locales comerciales, oficinas, naves).

    Args:
        rc (str): Referencia catastral completa (14 o 20 caracteres).
        retries (int, opcional): Número de reintentos ante caídas de red. Por defecto 3.
        timeout (int, opcional): Tiempo máximo de espera en segundos. Por defecto 15.

    Returns:
        Dict[str, Any]: Diccionario con los datos del inmueble (clase, población, provincia,
            tamaño m², tipo_tamano, uso principal, año construcción, dirección, cultivos o
            construcciones y URL a la Sede Electrónica) o clave 'error' en caso de fallo.
    """
    url = f"http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC={rc}"
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code != 200:
                time.sleep(0.5)
                continue
            
            root = ET.fromstring(resp.content)
            
            # Comprobar si hay error en la consulta
            err_elem = root.find(".//cat:lerr", NS)
            if err_elem is not None:
                err_msgs = [e.text for e in err_elem.findall(".//cat:des", NS) if e.text]
                return {"error": "; ".join(err_msgs)}
            
            bi = root.find(".//cat:bi", NS)
            unidades_inmuebles = []
            if bi is None:
                # Comprobar si es un edificio con división horizontal (múltiples inmuebles)
                lrcdnp = root.find(".//cat:lrcdnp", NS)
                if lrcdnp is not None:
                    for rcdnp in lrcdnp.findall(".//cat:rcdnp", NS):
                        pc1 = rcdnp.find(".//cat:pc1", NS)
                        pc2 = rcdnp.find(".//cat:pc2", NS)
                        car = rcdnp.find(".//cat:car", NS)
                        cc1 = rcdnp.find(".//cat:cc1", NS)
                        cc2 = rcdnp.find(".//cat:cc2", NS)
                        loint = rcdnp.find(".//cat:loint", NS)
                        ldt = rcdnp.find(".//cat:ldt", NS)

                        ref_20 = ""
                        if pc1 is not None and pc2 is not None and car is not None and cc1 is not None and cc2 is not None:
                            ref_20 = f"{pc1.text or ''}{pc2.text or ''}{car.text or ''}{cc1.text or ''}{cc2.text or ''}".strip()

                        pt = loint.find("cat:pt", NS).text.strip() if loint is not None and loint.find("cat:pt", NS) is not None and loint.find("cat:pt", NS).text else ""
                        pu = loint.find("cat:pu", NS).text.strip() if loint is not None and loint.find("cat:pu", NS) is not None and loint.find("cat:pu", NS).text else ""
                        dir_str = ldt.text.strip() if ldt is not None and ldt.text else ""

                        desc_ubicacion = []
                        if pt:
                            desc_ubicacion.append(f"Planta {pt}")
                        if pu:
                            desc_ubicacion.append(f"Puerta {pu}")
                        ubicacion_texto = " - ".join(desc_ubicacion) if desc_ubicacion else "Inmueble"

                        if ref_20:
                            unidades_inmuebles.append({
                                "referencia": ref_20,
                                "planta": pt,
                                "puerta": pu,
                                "ubicacion": ubicacion_texto,
                                "direccion": dir_str,
                            })

                    if unidades_inmuebles:
                        # Consultar el primer inmueble de la lista para tener los datos de base
                        primer_inmueble = query_dnprc(unidades_inmuebles[0]["referencia"], retries=1, timeout=timeout)
                        if "error" not in primer_inmueble:
                            primer_inmueble["unidades_inmuebles"] = unidades_inmuebles
                            primer_inmueble["referencia_matriz"] = rc[:14]
                            return primer_inmueble

                return {"error": "Inmueble no encontrado"}
            
            # Clase de bien (RU = Rústico, UR = Urbano)
            cn_elem = bi.find(".//cat:cn", NS)
            clase_raw = cn_elem.text.strip() if cn_elem is not None and cn_elem.text else ""
            clase = "Rústico" if clase_raw == "RU" else "Urbano" if clase_raw == "UR" else clase_raw
            
            # Datos territoriales
            cp_elem = root.find(".//cat:cp", NS)
            cmc_elem = root.find(".//cat:cmc", NS)
            np_elem = root.find(".//cat:np", NS)
            nm_elem = root.find(".//cat:nm", NS)
            ldt_elem = root.find(".//cat:ldt", NS)
            
            prov_code = cp_elem.text.strip() if cp_elem is not None and cp_elem.text else rc[:2]
            mun_code = cmc_elem.text.strip() if cmc_elem is not None and cmc_elem.text else ""
            provincia = np_elem.text.strip() if np_elem is not None and np_elem.text else ""
            poblacion = nm_elem.text.strip() if nm_elem is not None and nm_elem.text else ""
            direccion = ldt_elem.text.strip() if ldt_elem is not None and ldt_elem.text else ""
            
            # Datos económicos / constructivos (debi)
            debi = bi.find(".//cat:debi", NS)
            luso = debi.find("cat:luso", NS).text.strip() if debi is not None and debi.find("cat:luso", NS) is not None and debi.find("cat:luso", NS).text else ""
            sfc = debi.find("cat:sfc", NS).text.strip() if debi is not None and debi.find("cat:sfc", NS) is not None and debi.find("cat:sfc", NS).text else ""
            cpt = debi.find("cat:cpt", NS).text.strip() if debi is not None and debi.find("cat:cpt", NS) is not None and debi.find("cat:cpt", NS).text else ""
            ant = debi.find("cat:ant", NS).text.strip() if debi is not None and debi.find("cat:ant", NS) is not None and debi.find("cat:ant", NS).text else ""
            
            # Subparcelas de cultivo (si rústico)
            subparcelas = []
            total_m2_cultivo = 0
            for spr in root.findall(".//cat:bico/cat:lspr/cat:spr", NS):
                cspr = spr.find("cat:cspr", NS)
                ccc = spr.find(".//cat:ccc", NS)
                dcc = spr.find(".//cat:dcc", NS)
                ip = spr.find(".//cat:ip", NS)
                ssp = spr.find(".//cat:ssp", NS)
                
                sub_id = cspr.text.strip() if cspr is not None and cspr.text else ""
                crop_code = ccc.text.strip() if ccc is not None and ccc.text else ""
                crop_name = dcc.text.strip() if dcc is not None and dcc.text else ""
                intensidad = ip.text.strip() if ip is not None and ip.text else ""
                m2_val = int(ssp.text.strip()) if ssp is not None and ssp.text and ssp.text.strip().isdigit() else 0
                
                total_m2_cultivo += m2_val
                subparcelas.append({
                    "subparcela": sub_id,
                    "codigo": crop_code,
                    "nombre": crop_name,
                    "intensidad": intensidad,
                    "superficie_m2": m2_val
                })
            
            # Construcciones / locales (si urbano)
            construcciones = []
            for cons in root.findall(".//cat:bico/cat:lcons/cat:cons", NS):
                lcd = cons.find(".//cat:lcd", NS)
                stl = cons.find(".//cat:stl", NS)
                loint = cons.find(".//cat:loint", NS)
                
                tipo_cons = lcd.text.strip() if lcd is not None and lcd.text else ""
                m2_cons = int(stl.text.strip()) if stl is not None and stl.text and stl.text.strip().isdigit() else 0
                
                planta = loint.find("cat:pt", NS).text.strip() if loint is not None and loint.find("cat:pt", NS) is not None and loint.find("cat:pt", NS).text else ""
                puerta = loint.find("cat:pu", NS).text.strip() if loint is not None and loint.find("cat:pu", NS) is not None and loint.find("cat:pu", NS).text else ""
                
                loc_str = f"Planta {planta} Puerta {puerta}".strip() if (planta or puerta) else ""
                construcciones.append({
                    "destino": tipo_cons,
                    "superficie_m2": m2_cons,
                    "ubicacion": loc_str
                })
            
            # Determinar tamaño y tipo de tamaño
            tamano_m2: Optional[int] = None
            tipo_tamano: str = ""
            detalle_uso: str = ""
            
            if clase == "Rústico":
                tamano_m2 = total_m2_cultivo
                tipo_tamano = "Extensión de parcela / terreno (Rústico)"
                detalles = []
                for s in subparcelas:
                    m2_f = f"{s['superficie_m2']:,}".replace(",", ".")
                    detalles.append(f"Subparc. {s['subparcela']}: [{s['codigo']}] {s['nombre'].title()} (Int. {s['intensidad']}, {m2_f} m²)")
                detalle_uso = "; ".join(detalles) if detalles else "Sin desglose de subparcelas"
            else:
                # Urbano: superficie construida
                tamano_m2 = int(sfc) if sfc.isdigit() else 0
                tipo_tamano = "Superficie construida (Piso / Inmueble Urbano)"
                detalles = []
                for c in construcciones:
                    m2_f = f"{c['superficie_m2']:,}".replace(",", ".")
                    part = f"{c['destino'].title()} ({m2_f} m²)"
                    if c["ubicacion"]:
                        part = f"{c['ubicacion']}: {part}"
                    detalles.append(part)
                detalle_uso = "; ".join(detalles) if detalles else (f"{luso} ({tamano_m2} m²)" if luso else "")

            # Construir URL oficial de la Sede
            urbrus_flag = "R" if clase == "Rústico" else "U"
            sede_url = (
                f"https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCConCiud.aspx?"
                f"UrbRus={urbrus_flag}&RefC={rc}&esBice=&RCBice1=&RCBice2=&DenoBice=&from=OVCBusqueda&"
                f"pest=rc&RCCompleta={rc}&final=&del={prov_code}&mun={mun_code}"
            )
            
            return {
                "rc": rc,
                "clase": clase,
                "poblacion": poblacion.title(),
                "provincia": provincia.title(),
                "tamano_m2": tamano_m2,
                "tipo_tamano": tipo_tamano,
                "uso_principal": luso.title() if luso else ("Agrario" if clase == "Rústico" else ""),
                "ano_construccion": ant,
                "coeficiente_participacion": cpt,
                "direccion": direccion,
                "detalle_info": detalle_uso,
                "sede_catastro_url": sede_url,
            }
        except Exception as e:
            if attempt == retries - 1:
                return {"error": str(e)}
            time.sleep(1)
    return {"error": "Exceeded retries"}


def query_coordenadas(rc: str, retries: int = 3, timeout: int = 15) -> Dict[str, Any]:
    """
    Obtiene las coordenadas geográficas (WGS84 EPSG:4326) del centroide de la parcela.

    Realiza una petición al servicio web `Consulta_CPMRC` de la Oficina Virtual del Catastro
    empleando la matriz catastral (primeros 14 caracteres de la referencia).

    Args:
        rc (str): Referencia catastral (mínimo 14 caracteres).
        retries (int, opcional): Número de reintentos en caso de error. Por defecto 3.
        timeout (int, opcional): Tiempo de espera máximo en segundos. Por defecto 15.

    Returns:
        Dict[str, Any]: Diccionario con:
            - latitud (float o None): Coordenada latitud en WGS84.
            - longitud (float o None): Coordenada longitud en WGS84.
            - google_maps_url (str): Enlace directo a Google Maps centrado en la posición.
    """
    matriz = rc[:14]
    url = f"http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?Provincia=&Municipio=&SRS=EPSG:4326&RC={matriz}"
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code != 200:
                time.sleep(0.5)
                continue
            
            root = ET.fromstring(resp.content)
            xcen = root.find(".//cat:xcen", NS)
            ycen = root.find(".//cat:ycen", NS)
            if xcen is not None and ycen is not None and xcen.text and ycen.text:
                lon = float(xcen.text.strip())
                lat = float(ycen.text.strip())
                return {
                    "latitud": lat,
                    "longitud": lon,
                    "google_maps_url": f"https://www.google.com/maps?q={lat},{lon}",
                }
            return {"latitud": None, "longitud": None, "google_maps_url": ""}
        except Exception as e:
            if attempt == retries - 1:
                return {"latitud": None, "longitud": None, "google_maps_url": "", "error_geo": str(e)}
            time.sleep(1)
    return {"latitud": None, "longitud": None, "google_maps_url": ""}


def query_rc_por_coordenadas(lat: float, lon: float, retries: int = 3, timeout: int = 15) -> Dict[str, Any]:
    """
    Obtiene la Referencia Catastral (14 caracteres) correspondiente a unas coordenadas WGS84 (GPS).

    Utiliza el servicio `Consulta_RCCOOR` de la OVC. Si las coordenadas caen en un punto
    intermedio o vía pública sin referencia directa, recurre a `Consulta_RCCOOR_Distancia`
    para encontrar la parcela catastral más próxima (hasta 60 metros).

    Args:
        lat (float): Latitud en grados decimales (WGS84).
        lon (float): Longitud en grados decimales (WGS84).
        retries (int, opcional): Intentos ante error.
        timeout (int, opcional): Tiempo de espera en segundos.

    Returns:
        Dict[str, Any]: {
            "referencia": str (14 caracteres),
            "direccion": str,
            "latitud": float,
            "longitud": float,
            "distancia_m": float,
            "error": str
        }
    """
    url_exact = (
        f"http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?"
        f"SRS=EPSG:4326&Coordenada_X={lon}&Coordenada_Y={lat}"
    )
    for attempt in range(retries):
        try:
            resp = requests.get(url_exact, timeout=timeout)
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                pc1 = root.find(".//cat:pc1", NS)
                pc2 = root.find(".//cat:pc2", NS)
                ldt = root.find(".//cat:ldt", NS)
                if pc1 is not None and pc2 is not None and pc1.text and pc2.text:
                    rc_14 = f"{pc1.text.strip()}{pc2.text.strip()}"
                    return {
                        "referencia": rc_14,
                        "direccion": ldt.text.strip() if ldt is not None and ldt.text else "",
                        "latitud": lat,
                        "longitud": lon,
                        "distancia_m": 0.0,
                        "error": "",
                    }

                # Fallback: consultar la parcela más cercana por distancia (ej. si cae en la acera o calzada)
                url_dist = (
                    f"http://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR_Distancia?"
                    f"SRS=EPSG:4326&Coordenada_X={lon}&Coordenada_Y={lat}"
                )
                resp_d = requests.get(url_dist, timeout=timeout)
                if resp_d.status_code == 200:
                    root_d = ET.fromstring(resp_d.content)
                    pcd = root_d.find(".//cat:pcd", NS)
                    if pcd is not None:
                        pc1_d = pcd.find(".//cat:pc1", NS)
                        pc2_d = pcd.find(".//cat:pc2", NS)
                        ldt_d = pcd.find(".//cat:ldt", NS)
                        dis_d = pcd.find(".//cat:dis", NS)
                        if pc1_d is not None and pc2_d is not None and pc1_d.text and pc2_d.text:
                            dist_val = float(dis_d.text.strip()) if dis_d is not None and dis_d.text else 0.0
                            if dist_val <= 60.0:
                                return {
                                    "referencia": f"{pc1_d.text.strip()}{pc2_d.text.strip()}",
                                    "direccion": ldt_d.text.strip() if ldt_d is not None and ldt_d.text else "",
                                    "latitud": lat,
                                    "longitud": lon,
                                    "distancia_m": dist_val,
                                    "error": "",
                                }

                return {
                    "error": "No se encontró ninguna parcela catastral en estas coordenadas ni en sus inmediaciones.",
                    "latitud": lat,
                    "longitud": lon,
                }
        except Exception as e:
            if attempt == retries - 1:
                return {"error": f"Error al consultar coordenadas: {str(e)}", "latitud": lat, "longitud": lon}
            time.sleep(1)
    return {"error": "Tiempo de espera agotado al consultar coordenadas.", "latitud": lat, "longitud": lon}


def consultar_referencia(rc: str) -> Dict[str, Any]:
    """
    Realiza una consulta combinada de datos descriptivos y geolocalización para una referencia.

    Limpia la referencia, ejecuta la consulta `DNPRC` para datos de superficie, uso y dirección,
    y consulta `CPMRC` para geolocalización en Google Maps.

    Args:
        rc (str): Referencia catastral a consultar.

    Returns:
        Dict[str, Any]: Diccionario unificado listo para su exportación a CSV con campos:
            referencia, clase, poblacion, provincia, tamano_m2, tipo_tamano, enlace_google_maps,
            latitud, longitud, uso_principal, ano_construccion, coeficiente_participacion,
            direccion, detalle_aprovechamiento_o_construccion, enlace_sede_catastro y error.
    """
    rc_clean = clean_cadastral_reference(rc)
    if len(rc_clean) < 14:
        return {
            "referencia": rc,
            "error": "Referencia catastral no válida (longitud menor a 14 caracteres)",
        }
    
    dnprc_data = query_dnprc(rc_clean)
    if "error" in dnprc_data:
        return {
            "referencia": rc_clean,
            "error": dnprc_data["error"],
        }
    
    geo_data = query_coordenadas(rc_clean)
    
    return {
        "referencia": rc_clean,
        "clase": dnprc_data.get("clase", ""),
        "poblacion": dnprc_data.get("poblacion", ""),
        "provincia": dnprc_data.get("provincia", ""),
        "tamano_m2": dnprc_data.get("tamano_m2"),
        "tipo_tamano": dnprc_data.get("tipo_tamano", ""),
        "enlace_google_maps": geo_data.get("google_maps_url", ""),
        "latitud": geo_data.get("latitud"),
        "longitud": geo_data.get("longitud"),
        "uso_principal": dnprc_data.get("uso_principal", ""),
        "ano_construccion": dnprc_data.get("ano_construccion", ""),
        "coeficiente_participacion": dnprc_data.get("coeficiente_participacion", ""),
        "direccion": dnprc_data.get("direccion", ""),
        "detalle_aprovechamiento_o_construccion": dnprc_data.get("detalle_info", ""),
        "enlace_sede_catastro": dnprc_data.get("sede_catastro_url", ""),
        "error": "",
    }


def export_to_csv(results: List[Dict[str, Any]], filepath: str, delimiter: str = ";") -> None:
    """
    Exporta la lista de resultados catastrales a un archivo CSV estructurado.

    Utiliza codificación UTF-8 con BOM (`utf-8-sig`) para compatibilidad directa con Microsoft
    Excel en plataformas Windows sin problemas de visualización de acentos ni caracteres especiales.

    Args:
        results (List[Dict[str, Any]]): Lista de diccionarios de inmuebles.
        filepath (str): Ruta de destino del archivo CSV.
        delimiter (str, opcional): Carácter separador de columnas. Por defecto ';'.
    """
    fieldnames = [
        "referencia",
        "poblacion",
        "provincia",
        "clase",
        "tamano_m2",
        "tipo_tamano",
        "enlace_google_maps",
        "latitud",
        "longitud",
        "uso_principal",
        "ano_construccion",
        "coeficiente_participacion",
        "direccion",
        "detalle_aprovechamiento_o_construccion",
        "enlace_sede_catastro",
        "error",
    ]
    
    os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else ".", exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=delimiter)
        writer.writeheader()
        for r in results:
            writer.writerow(r)


def print_table_preview(results: List[Dict[str, Any]]) -> None:
    """
    Imprime una tabla de resumen en la consola estándar con el estado de cada referencia.

    Args:
        results (List[Dict[str, Any]]): Lista de diccionarios con la información de los inmuebles.
    """
    print("\n" + "=" * 115)
    print(f"{'REFERENCIA':<22} | {'CLASE':<8} | {'POBLACIÓN':<18} | {'TAMAÑO':<16} | {'USO':<14} | {'GOOGLE MAPS'}")
    print("-" * 115)
    for r in results:
        if r.get("error"):
            print(f"{r['referencia']:<22} | ERROR: {r['error']}")
            continue
        
        ref = r.get("referencia", "")
        clase = r.get("clase", "")
        pob = r.get("poblacion", "")[:18]
        tam = f"{r.get('tamano_m2', 0):,} m²".replace(",", ".") if r.get("tamano_m2") is not None else "-"
        uso = r.get("uso_principal", "")[:14]
        maps = r.get("enlace_google_maps", "")
        print(f"{ref:<22} | {clase:<8} | {pob:<18} | {tam:<16} | {uso:<14} | {maps}")
    print("=" * 115 + "\n")


def main() -> None:
    """
    Punto de entrada CLI para procesar argumentos de terminal, coordinar consultas y generar el CSV.
    """
    parser = argparse.ArgumentParser(
        description="Consulta referencias catastrales (rústicas o urbanas) y exporta sus datos y geolocalización a CSV."
    )
    parser.add_argument(
        "referencias",
        nargs="*",
        help="Lista de una o más referencias catastrales (separadas por espacio).",
    )
    parser.add_argument(
        "-f",
        "--file",
        help="Archivo de texto con referencias catastrales (una por línea).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="catastro_referencias.csv",
        help="Ruta del archivo CSV de salida (por defecto: catastro_referencias.csv).",
    )
    parser.add_argument(
        "-d",
        "--delimiter",
        default=";",
        choices=[";", ","],
        help="Separador del CSV (por defecto ';' para máxima compatibilidad con Excel en español).",
    )
    parser.add_argument(
        "-w",
        "--workers",
        type=int,
        default=6,
        help="Número de hilos concurrentes para consultas múltiples (por defecto: 6).",
    )
    parser.add_argument(
        "--no-preview",
        action="store_true",
        help="No mostrar la tabla de resumen en consola.",
    )

    args = parser.parse_args()

    # Recoger lista de referencias
    rc_list = list(args.referencias)
    if args.file:
        if os.path.exists(args.file):
            with open(args.file, "r", encoding="utf-8") as f:
                for line in f:
                    clean = clean_cadastral_reference(line)
                    if clean:
                        rc_list.append(clean)
        else:
            logger.error(f"El archivo indicado no existe: {args.file}")
            sys.exit(1)

    if not rc_list:
        parser.print_help()
        sys.exit(1)

    # Eliminar duplicados preservando orden
    seen = set()
    unique_rcs = []
    for rc in rc_list:
        clean = clean_cadastral_reference(rc)
        if clean and clean not in seen:
            seen.add(clean)
            unique_rcs.append(clean)

    logger.info(f"Consultando Catastro para {len(unique_rcs)} referencia(s)...")

    # Consultar de forma concurrente
    results: List[Dict[str, Any]] = []
    t0 = time.time()
    if len(unique_rcs) == 1:
        results.append(consultar_referencia(unique_rcs[0]))
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            future_to_rc = {executor.submit(consultar_referencia, rc): rc for rc in unique_rcs}
            for future in as_completed(future_to_rc):
                results.append(future.result())
        # Reordenar según la lista original
        rc_order = {rc: i for i, rc in enumerate(unique_rcs)}
        results.sort(key=lambda r: rc_order.get(r.get("referencia", ""), 999999))

    dt = time.time() - t0
    logger.info(f"Consultas completadas en {dt:.2f}s.")

    # Exportar a CSV
    export_to_csv(results, args.output, delimiter=args.delimiter)
    logger.info(f"Archivo CSV guardado en: {os.path.abspath(args.output)}")

    # Mostrar vista previa en consola si procede
    if not args.no_preview:
        print_table_preview(results)


if __name__ == "__main__":
    main()
