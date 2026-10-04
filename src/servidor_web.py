"""
Servidor local para el Visor de Catastro (Yaluba).

Sirve la aplicación web estática ubicada en el directorio 'web/' y proporciona
el endpoint '/api/consultar?rc=...' utilizando directamente las funciones de
consulta a la Sede Electrónica del Catastro de 'src/consultar_catastro.py'.

Ejecución recomendada con uv:
    uv run python src/servidor_web.py
    uv run python src/servidor_web.py --port 8080
    uv run python src/servidor_web.py --no-browser
"""

import argparse
import json
import logging
import os
import socket
import sys
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Añadir la raíz del proyecto al sys.path para importar módulos de src
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.consultar_catastro import (
    clean_cadastral_reference,
    query_coordenadas,
    query_dnprc,
    query_rc_por_coordenadas,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("servidor_web")


def get_local_ip() -> str:
    """Obtiene la dirección IP local de la máquina en la red local (WiFi/LAN)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class CatastroWebHandler(SimpleHTTPRequestHandler):
    """
    Manejador HTTP que sirve el directorio web/ y gestiona el endpoint /api/consultar.
    """

    def __init__(self, *args, **kwargs):
        web_dir = str(PROJECT_ROOT / "web")
        super().__init__(*args, directory=web_dir, **kwargs)

    def do_OPTIONS(self):
        """Maneja peticiones CORS preflight."""
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """Gestiona peticiones GET a la API o al contenido estático."""
        parsed_url = urllib.parse.urlparse(self.path)
        
        # Interceptar endpoint de API
        if parsed_url.path == "/api/consultar":
            self.handle_api_consultar(parsed_url)
            return

        if parsed_url.path == "/api/coordenadas":
            self.handle_api_coordenadas(parsed_url)
            return

        # Para el resto, servir archivos estáticos desde web/
        super().do_GET()

    def handle_api_coordenadas(self, parsed_url: urllib.parse.ParseResult):
        """Devuelve la referencia catastral a partir de latitud y longitud."""
        params = urllib.parse.parse_qs(parsed_url.query)
        lat_raw = params.get("lat", [""])[0].strip()
        lon_raw = params.get("lon", [""])[0].strip()
        try:
            lat = float(lat_raw)
            lon = float(lon_raw)
        except (ValueError, TypeError):
            self.send_json_response(
                {"error": "Parámetros de latitud y longitud inválidos o no especificados."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        coord_res = query_rc_por_coordenadas(lat, lon)
        if coord_res.get("error"):
            self.send_json_response(coord_res, status=HTTPStatus.NOT_FOUND)
        else:
            self.send_json_response(coord_res, status=HTTPStatus.OK)

    def handle_api_consultar(self, parsed_url: urllib.parse.ParseResult):
        """Procesa la consulta a Catastro y devuelve JSON estructurado."""
        params = urllib.parse.parse_qs(parsed_url.query)
        rc_raw = params.get("rc", [""])[0].strip()
        lat_param = params.get("lat", [""])[0].strip()
        lon_param = params.get("lon", [""])[0].strip()

        query_lat = None
        query_lon = None

        if lat_param and lon_param:
            try:
                query_lat = float(lat_param)
                query_lon = float(lon_param)
            except ValueError:
                pass
        elif "," in rc_raw:
            parts = rc_raw.split(",")
            if len(parts) == 2:
                try:
                    query_lat = float(parts[0].strip())
                    query_lon = float(parts[1].strip())
                except ValueError:
                    pass

        if query_lat is not None and query_lon is not None:
            coord_res = query_rc_por_coordenadas(query_lat, query_lon)
            if coord_res.get("error"):
                self.send_json_response(
                    {"error": coord_res["error"]}, status=HTTPStatus.NOT_FOUND
                )
                return
            rc = coord_res["referencia"]
        else:
            rc = clean_cadastral_reference(rc_raw)

        if not rc or len(rc) < 14:
            self.send_json_response(
                {"error": "La referencia catastral debe tener al menos 14 caracteres o indicar coordenadas válidas."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        try:
            dnprc_data = query_dnprc(rc)
            if "error" in dnprc_data:
                self.send_json_response(
                    {"error": dnprc_data["error"]}, status=HTTPStatus.NOT_FOUND
                )
                return

            geo_data = query_coordenadas(rc)

            # Extraer listas de subparcelas y construcciones parseadas
            clase = dnprc_data.get("clase", "")
            detalle = dnprc_data.get("detalle_info", "")

            # Formatear coeficiente a un máximo de 2 decimales si procede
            cpt_raw = dnprc_data.get("coeficiente_participacion", "")
            cpt_formatted = ""
            if cpt_raw:
                try:
                    num_cpt = float(str(cpt_raw).replace(",", "."))
                    if num_cpt.is_integer():
                        cpt_formatted = f"{int(num_cpt)}"
                    else:
                        cpt_formatted = f"{num_cpt:.2f}".rstrip("0").rstrip(".").replace(".", ",")
                except Exception:
                    cpt_formatted = str(cpt_raw)

            final_lat = geo_data.get("latitud") or query_lat
            final_lon = geo_data.get("longitud") or query_lon
            gmaps_url = geo_data.get("google_maps_url")
            if not gmaps_url and final_lat is not None and final_lon is not None:
                gmaps_url = f"https://www.google.com/maps?q={final_lat},{final_lon}"

            # Formar respuesta completa compatible con el frontend
            resultado = {
                "referencia": dnprc_data.get("rc", rc),
                "referencia_matriz": dnprc_data.get("referencia_matriz", rc[:14]),
                "unidades_inmuebles": dnprc_data.get("unidades_inmuebles", []),
                "clase": clase,
                "poblacion": dnprc_data.get("poblacion", ""),
                "provincia": dnprc_data.get("provincia", ""),
                "tamano_m2": dnprc_data.get("tamano_m2", 0),
                "tipo_tamano": dnprc_data.get("tipo_tamano", ""),
                "uso_principal": dnprc_data.get("uso_principal", ""),
                "ano_construccion": dnprc_data.get("ano_construccion", ""),
                "coeficiente_participacion": cpt_formatted,
                "direccion": dnprc_data.get("direccion", ""),
                "detalle_info": detalle,
                "latitud": final_lat,
                "longitud": final_lon,
                "google_maps_url": gmaps_url or "",
                "sede_catastro_url": dnprc_data.get("sede_catastro_url", ""),
                "error": "",
            }

            self.send_json_response(resultado, status=HTTPStatus.OK)

        except Exception as e:
            logger.error(f"Error procesando referencia {rc}: {e}")
            self.send_json_response(
                {"error": f"Error interno en el servidor: {str(e)}"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def send_json_response(self, data: dict, status: int = HTTPStatus.OK):
        """Envía una respuesta JSON con cabeceras CORS y codificación UTF-8."""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        """Filtra y formatea mensajes de registro de peticiones de forma segura."""
        try:
            if len(args) >= 3:
                sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} {args[1]} -> {args[2]}\n")
            elif len(args) == 2:
                sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} -> {args[1]}\n")
            elif args:
                sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")
            else:
                sys.stderr.write(f"[{self.log_date_time_string()}] {format}\n")
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(
        description="Servidor local para el Visor de Catastro (Yaluba)."
    )
    parser.add_argument(
        "-p", "--port", type=int, default=8000, help="Puerto del servidor (por defecto: 8000)"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Dirección de escucha (0.0.0.0 para permitir acceso en red local desde móvil/tablet)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="No abrir automáticamente el navegador web al iniciar",
    )
    args = parser.parse_args()

    local_ip = get_local_ip()
    port = args.port
    host = args.host

    server_address = (host, port)
    httpd = ThreadingHTTPServer(server_address, CatastroWebHandler)

    print("\n" + "=" * 70)
    print("  YALUBA - VISOR DE CATASTRO (Servidor Local con uv)")
    print("=" * 70)
    print(f"  * En este ordenador:        http://localhost:{port}")
    if local_ip != "127.0.0.1":
        print(f"  * En tu movil o tablet:     http://{local_ip}:{port}  (misma red WiFi)")
    print(f"  * Carpeta web servida:      {PROJECT_ROOT / 'web'}")
    print(f"  * Endpoint API activo:      http://localhost:{port}/api/consultar?rc=...")
    print("=" * 70)
    print("  Presiona Ctrl + C para detener el servidor.\n")

    if not args.no_browser:
        webbrowser.open(f"http://localhost:{port}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDeteniendo el servidor...")
        httpd.server_close()
        print("Servidor detenido correctamente.\n")


if __name__ == "__main__":
    main()
