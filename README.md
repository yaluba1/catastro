# Visor de Catastro - Yaluba

Aplicación web moderna y responsiva para la consulta de referencias catastrales en España, visualización de superficies, cultivos, linderos cartográficos oficiales (WMS INSPIRE del Catastro e IGN PNOA) y enlace directo a Google Maps y Registro de la Propiedad.

---

## 🎨 Características Principales

* **Identidad Visual Corporativa**:
  * Logo de **Yaluba** en la cabecera.
  * Paleta de colores oficial: **Verde Pistacho** como color principal y **Naranja Calabaza (`#FF7518`)** como secundario / acento.
  * **Modo Claro y Modo Oscuro**: Conmutador accesible con detección automática del sistema y persistencia en `localStorage`.
* **Diseño 100% Responsivo (Mobile-First)**:
  * Optimizado para **smartphones**, **tablets** y **ordenadores de escritorio**.
  * Zonas táctiles amplias (mínimo 44–48 px) para una pulsación cómoda con los dedos.
  * Prevención de auto-zoom en iOS Safari y adaptación automática de rejillas para pantallas estrechas.
* **Consulta Completa de Datos Catastrales**:
  * Distinción clara entre **Rústico** (parcelas, superficies de terreno, desglose de cultivos/subparcelas) y **Urbano** (superficie construida, año de construcción, división horizontal, reparto de locales/plantas/puertas).
  * **Síntesis Descriptiva Inteligente**: Generación de un resumen profesional y claro de la propiedad (compatible de forma nativa con **Cloudflare Workers AI**).
* **Visor Cartográfico Interactivo (Leaflet)**:
  * **Ortofoto aérea satelital PNOA** de alta resolución (Instituto Geográfico Nacional).
  * **Capa WMS Oficial de Parcelas del Catastro** (dibuja los linderos y geometrías catastrales exactas en tiempo real).
  * Callejero alternativo OpenStreetMap.
  * Marcador en el centroide de la parcela con popup interactivo.
  * **Botón destacado "Abrir en Google Maps"** centrado en las coordenadas exactas WGS84.
* **Módulo Informativo de Cargas y Estado Registral**:
  * Explicación pedagógica de la diferencia entre **Catastro** (ámbito fiscal y físico) y **Registro de la Propiedad** (ámbito jurídico: hipotecas, embargos y titularidad).
  * Acceso directo al **Geoportal de Registradores** y enlace para tramitar la **Nota Simple Oficial**.
* **Historial Local y Utilidades**:
  * Historial de búsquedas recientes guardado en el navegador.
  * Copia rápida de referencia catastral y de la ficha completa al portapapeles.
  * Compatibilidad con impresión limpia y guardado en PDF (`Ctrl + P`).

---

## 🚀 Despliegue en Cloudflare Pages

### Opción A: Despliegue desde la interfaz web de Cloudflare (Recomendada)
1. Inicia sesión en tu cuenta de [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Ve a **Workers & Pages** > **Create application** > pestaña **Pages** > **Connect to Git**.
3. Selecciona tu repositorio de GitHub o GitLab.
4. En los ajustes de compilación:
   * **Framework preset**: `None`
   * **Build command**: *(dejar en blanco)*
   * **Build output directory**: `web`
5. Haz clic en **Save and Deploy**. ¡Tu página estará activa en segundos con HTTPS y CDN global!

#### (Opcional) Activar Cloudflare Workers AI para resúmenes automáticos:
1. En tu proyecto de Cloudflare Pages, entra en **Settings** > **Functions**.
2. En la sección **Workers AI bindings**, haz clic en **Add binding**.
3. Asigna el nombre de variable: `AI`.
4. Guarda los cambios y despliega de nuevo. La función `/api/consultar` utilizará automáticamente el modelo `@cf/meta/llama-3.1-8b-instruct` para redactar descripciones inmobiliarias de cada finca o vivienda.

---

### Opción B: Despliegue manual por terminal con Wrangler

Si prefieres desplegar directamente desde tu terminal utilizando Wrangler:

```bash
# Despliegue directo a Producción:
npx wrangler pages deploy web --project-name=visor-catastro-yaluba --branch=production
```

> [!IMPORTANT]
> **¿Por qué es necesario `--branch=production`?**
> * **Rama de Producción de Cloudflare Pages**: En este proyecto de Cloudflare Pages, la rama principal de producción está configurada con el nombre `production`. 
> * Si ejecutas `wrangler pages deploy` sin especificar la rama o con `--branch=main`, Cloudflare creará un despliegue de **Preview** (vista previa temporal con URL única con hash).
> * Al indicar `--branch=production`, Cloudflare publica la actualización directamente en el dominio oficial de producción (`https://visor-catastro-yaluba.pages.dev`).

---

## 💻 Prueba y Ejecución en Local con uv

Para probar la aplicación en tu máquina local y en dispositivos móviles dentro de tu red WiFi, ejecuta con **uv**:

```bash
uv run python src/servidor_web.py
```

Esto iniciará el servidor de desarrollo y:
1. Abrirá automáticamente tu navegador en `http://localhost:8000`.
2. Mostrará en consola la **dirección IP de tu red local** (ej. `http://192.168.1.45:8000`) para que puedas abrir la app en tu **móvil o tablet** conectado a la misma red WiFi.
3. Servirá todos los archivos de `web/` y habilitará el endpoint local `/api/consultar`.

### Opciones adicionales del servidor:
```bash
# Cambiar de puerto (por ejemplo al 8080):
uv run python src/servidor_web.py --port 8080

# Iniciar sin abrir el navegador automáticamente:
uv run python src/servidor_web.py --no-browser
```

*Nota:* La aplicación cuenta con arquitectura dual; también puedes probarla simplemente con cualquier servidor estático (`uv run python -m http.server 8000 --directory web`), ya que el navegador es capaz de conectarse directamente con la Sede Electrónica del Catastro (`https://ovc.catastro.meh.es`) si no detecta backend.
