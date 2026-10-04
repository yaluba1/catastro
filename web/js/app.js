/**
 * Visor de Catastro - Yaluba
 * Lógica Frontend, Visor Cartográfico Interactivo y Conexión con Sede Electrónica del Catastro (OVC)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Constantes de ubicación por defecto: Kilómetro Cero (Puerta del Sol, Madrid)
  const DEFAULT_LAT = 40.416629;
  const DEFAULT_LON = -3.703813;
  const DEFAULT_ZOOM = 18;

  // ==========================================
  // 1. GESTOR DE TEMA (CLARO / OSCURO)
  // ==========================================
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeText = document.getElementById('theme-text');
  const metaThemeColor = document.getElementById('meta-theme-color');

  function initTheme() {
    const savedTheme = localStorage.getItem('yaluba_catastro_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    applyTheme(initialTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('yaluba_catastro_theme', theme);
    
    if (theme === 'dark') {
      themeToggleBtn.setAttribute('aria-label', 'Cambiar a modo claro');
      themeToggleBtn.setAttribute('title', 'Cambiar a modo claro');
      if (themeText) themeText.textContent = 'Modo Claro';
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#16221B');
    } else {
      themeToggleBtn.setAttribute('aria-label', 'Cambiar a modo oscuro');
      themeToggleBtn.setAttribute('title', 'Cambiar a modo oscuro');
      if (themeText) themeText.textContent = 'Modo Oscuro';
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#7DA92E');
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    const modal = document.getElementById('crypto-modal');
    const modalQr = document.getElementById('crypto-modal-qr');
    if (modal && modal.style.display === 'flex' && modalQr && typeof activeCryptoType !== 'undefined') {
      if (activeCryptoType === 'btc') {
        modalQr.src = nextTheme === 'dark' ? 'img/btc-qr-dark.svg' : 'img/btc-qr.svg';
      } else if (activeCryptoType === 'sol') {
        modalQr.src = nextTheme === 'dark' ? 'img/solana-qr-dark.svg' : 'img/solana-qr.svg';
      }
    }
  });

  initTheme();

  // ==========================================
  // 2. ELEMENTOS DEL DOM Y FORMULARIO
  // ==========================================
  const searchForm = document.getElementById('search-form');
  const rcInput = document.getElementById('rc-input');
  const clearBtn = document.getElementById('clear-btn');
  const geoBtn = document.getElementById('geo-btn');
  const submitBtn = document.getElementById('submit-btn');
  const charCounter = document.getElementById('char-counter');
  const formatHint = document.getElementById('format-hint');

  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const errorMessage = document.getElementById('error-message');
  const resultsSection = document.getElementById('results-section');
  const historySection = document.getElementById('history-section');
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');

  // Elementos de resultados
  const classBadge = document.getElementById('class-badge');
  const useBadge = document.getElementById('use-badge');
  const resultRc = document.getElementById('result-rc');
  const copyRcBtn = document.getElementById('copy-rc-btn');
  const copySummaryBtn = document.getElementById('copy-summary-btn');
  const printBtn = document.getElementById('print-btn');
  const resultAddress = document.getElementById('result-address');
  const resultMunicipio = document.getElementById('result-municipio');
  const resultProvincia = document.getElementById('result-provincia');
  const resultSummary = document.getElementById('result-summary');

  const btnGoogleMaps = document.getElementById('btn-google-maps');
  const btnSedeCatastro = document.getElementById('btn-sede-catastro');
  const coordsText = document.getElementById('coords-text');

  const multiUnitsCard = document.getElementById('multi-units-card');
  const multiUnitsBadge = document.getElementById('multi-units-badge');
  const multiUnitsSelect = document.getElementById('multi-units-select');

  const sizeLabel = document.getElementById('size-label');
  const resultSize = document.getElementById('result-size');
  const resultSizeExtra = document.getElementById('result-size-extra');
  const resultUse = document.getElementById('result-use');
  const resultClassText = document.getElementById('result-class-text');
  const resultYear = document.getElementById('result-year');
  const resultYearSub = document.getElementById('result-year-sub');
  const resultCoef = document.getElementById('result-coef');
  const resultCoefSub = document.getElementById('result-coef-sub');

  const latVal = document.getElementById('lat-val');
  const lonVal = document.getElementById('lon-val');
  const centerDefaultBtn = document.getElementById('center-default-btn');

  const detailsSection = document.getElementById('details-section');
  const detailsTitle = document.getElementById('details-title');
  const detailsCountBadge = document.getElementById('details-count-badge');
  const detailsTableWrapper = document.getElementById('details-table-wrapper');

  let currentPropertyData = null;
  let leafletMap = null;
  let mapMarker = null;

  // ==========================================
  // 3. DETECCIÓN Y FORMATEO DE ENTRADA (RC / GPS)
  // ==========================================
  function cleanRC(raw) {
    if (!raw) return '';
    return raw.trim().replace(/[\s\-_.]/g, '').toUpperCase();
  }

  function detectarCoordenadas(texto) {
    if (!texto) return null;
    const t = texto.trim();

    // 1. Enlace de Google Maps (/@lat,lon o ?q=lat,lon o query=lat,lon)
    const gmapsMatch = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (gmapsMatch) {
      const lat = parseFloat(gmapsMatch[1]);
      const lon = parseFloat(gmapsMatch[2]);
      if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }

    // 2. Par decimal lat, lon (con coma, punto y coma o espacio)
    // Ejemplos: "40.416629, -3.703813" o "40.416629 -3.703813"
    const pairMatch = t.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
    if (pairMatch) {
      const lat = parseFloat(pairMatch[1]);
      const lon = parseFloat(pairMatch[2]);
      if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }

    return null;
  }

  rcInput.addEventListener('input', () => {
    const rawVal = rcInput.value;
    const coords = detectarCoordenadas(rawVal);
    
    if (coords) {
      charCounter.textContent = 'Coordenadas GPS';
      formatHint.textContent = `Coordenadas detectadas: (${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)})`;
      formatHint.style.color = 'var(--secondary-pumpkin)';
      clearBtn.style.display = 'flex';
      return;
    }

    const cleanVal = cleanRC(rawVal);
    // Solo normalizar si no parece estar escribiendo coordenadas (sin comas ni espacios decimales)
    if (rawVal !== cleanVal && !rawVal.includes(',') && !rawVal.includes('.')) {
      rcInput.value = cleanVal;
    }

    const len = cleanVal.length;
    charCounter.textContent = `${len} / 20 caracteres`;
    clearBtn.style.display = rawVal.length > 0 ? 'flex' : 'none';

    if (len === 14) {
      formatHint.textContent = 'Formato Parcela (14 car.) - Correcto';
      formatHint.style.color = 'var(--primary-pistacho)';
    } else if (len === 20) {
      formatHint.textContent = 'Formato Inmueble Completo (20 car.) - Correcto';
      formatHint.style.color = 'var(--primary-pistacho)';
    } else if (len > 20) {
      formatHint.textContent = 'Longitud mayor de 20 (verifica o usa coordenadas)';
      formatHint.style.color = 'var(--text-muted)';
    } else {
      formatHint.textContent = 'Acepta Ref. Catastral o Coordenadas (lat, lon)';
      formatHint.style.color = 'var(--text-muted)';
    }
  });

  clearBtn.addEventListener('click', () => {
    rcInput.value = '';
    charCounter.textContent = '0 caracteres';
    formatHint.textContent = 'Acepta Ref. Catastral o Coordenadas (lat, lon)';
    formatHint.style.color = 'var(--text-muted)';
    clearBtn.style.display = 'none';
    rcInput.focus();
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = rcInput.value.trim();
    if (!val) return;

    const coords = detectarCoordenadas(val);
    if (coords) {
      ejecutarConsultaCoordenadas(coords.lat, coords.lon);
      return;
    }

    const rc = cleanRC(val);
    if (rc) {
      ejecutarConsulta(rc);
    }
  });

  // Botón "Mi Ubicación" (GPS del navegador)
  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      obtenerUbicacionGps();
    });
  }

  // Botón centrar en Sol (Km 0)
  if (centerDefaultBtn) {
    centerDefaultBtn.addEventListener('click', () => {
      if (leafletMap) {
        leafletMap.flyTo([DEFAULT_LAT, DEFAULT_LON], DEFAULT_ZOOM, { duration: 1.2 });
      }
      if (latVal && lonVal) {
        latVal.textContent = DEFAULT_LAT.toFixed(5);
        lonVal.textContent = DEFAULT_LON.toFixed(5);
      }
    });
  }

  // ==========================================
  // 4. CONSULTA AL CATASTRO POR REFERENCIA
  // ==========================================
  async function ejecutarConsulta(rc) {
    if (rc.length < 14) {
      mostrarError('La referencia catastral debe tener al menos 14 caracteres.');
      return;
    }

    setLoading(true);
    ocultarResultados();
    ocultarError();

    try {
      let data = null;

      // Intentar primero a través de la Pages Function (/api/consultar)
      try {
        const apiRes = await fetch(`/api/consultar?rc=${encodeURIComponent(rc)}`);
        if (apiRes.ok) {
          data = await apiRes.json();
          if (data && data.error) {
            throw new Error(data.error);
          }
        }
      } catch (errApi) {
        console.info('API local/Pages no disponible o en desarrollo, recurriendo a consulta directa OVC:', errApi.message);
      }

      // Si no obtuvimos datos vía endpoint, consultar directamente OVC Catastro (soporta HTTPS y CORS)
      if (!data || !data.referencia) {
        data = await consultarCatastroDirecto(rc);
      }

      if (data.error) {
        mostrarError(data.error);
        return;
      }

      currentPropertyData = data;
      renderizarResultados(data);
      guardarHistorial(data);

      if (data.latitud && data.longitud) {
        localStorage.setItem('yaluba_last_coords', JSON.stringify({
          lat: data.latitud,
          lon: data.longitud,
          zoom: 18
        }));
      }

      // Scroll suave en móvil hacia los resultados
      if (window.innerWidth < 768) {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

    } catch (err) {
      console.error('Error general de consulta:', err);
      mostrarError(err.message || 'Error de conexión con la Sede Electrónica del Catastro.');
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // 5. CONSULTA AL CATASTRO POR COORDENADAS GPS
  // ==========================================
  async function ejecutarConsultaCoordenadas(lat, lon) {
    if (latVal && lonVal) {
      latVal.textContent = lat.toFixed(5);
      lonVal.textContent = lon.toFixed(5);
    }
    rcInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    charCounter.textContent = 'Coordenadas GPS';
    formatHint.textContent = `Consultando parcela en ${lat.toFixed(4)}, ${lon.toFixed(4)}...`;
    formatHint.style.color = 'var(--secondary-pumpkin)';
    clearBtn.style.display = 'flex';

    setLoading(true);
    ocultarResultados();
    ocultarError();

    try {
      let data = null;

      // 1. Intentar /api/consultar con parámetros lat y lon
      try {
        const apiRes = await fetch(`/api/consultar?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        if (apiRes.ok) {
          data = await apiRes.json();
          if (data && data.error) throw new Error(data.error);
        }
      } catch (errApi) {
        console.info('API local/Pages no disponible con coords, probando /api/coordenadas o directo OVC:', errApi.message);
      }

      // 2. Si no, consultar endpoint /api/coordenadas para resolver la RC
      if (!data || !data.referencia) {
        try {
          const coordRes = await fetch(`/api/coordenadas?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
          if (coordRes.ok) {
            const cData = await coordRes.json();
            if (cData && cData.referencia) {
              const subRes = await fetch(`/api/consultar?rc=${encodeURIComponent(cData.referencia)}`);
              if (subRes.ok) {
                data = await subRes.json();
              }
            }
          }
        } catch (eCoord) {
          console.info('Endpoint /api/coordenadas falló:', eCoord.message);
        }
      }

      // 3. Fallback directo a OVC
      if (!data || !data.referencia) {
        const cDirect = await consultarCoordenadasDirecto(lat, lon);
        if (cDirect.error) {
          mostrarError(cDirect.error);
          return;
        }
        data = await consultarCatastroDirecto(cDirect.referencia);
      }

      if (data.error) {
        mostrarError(data.error);
        return;
      }

      // Guardar últimas coordenadas válidas
      localStorage.setItem('yaluba_last_coords', JSON.stringify({
        lat: data.latitud || lat,
        lon: data.longitud || lon,
        zoom: 18
      }));

      rcInput.value = data.referencia;
      charCounter.textContent = `${data.referencia.length} / 20 caracteres`;
      formatHint.textContent = 'Parcela localizada correctamente';
      formatHint.style.color = 'var(--primary-pistacho)';

      currentPropertyData = data;
      renderizarResultados(data);
      actualizarMapa(data.latitud || lat, data.longitud || lon, data);
      guardarHistorial(data);

      // Scroll suave a los resultados en móviles
      if (window.innerWidth < 768) {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

    } catch (err) {
      console.error('Error al consultar por coordenadas:', err);
      mostrarError(err.message || 'No se pudo obtener la parcela para estas coordenadas.');
    } finally {
      setLoading(false);
    }
  }

  // Geolocalización del dispositivo (móviles con chip GPS y portátiles con Wi-Fi/red)
  function obtenerUbicacionGps() {
    if (!navigator.geolocation) {
      alert('Tu navegador o dispositivo no soporta el servicio de geolocalización.');
      return;
    }

    if (geoBtn) {
      geoBtn.classList.add('loading');
    }

    // Fase 1: Intentar alta precisión (ideal para móviles con satélites GPS directos)
    navigator.geolocation.getCurrentPosition(
      (pos) => procesarPosicionGps(pos),
      (errHigh) => {
        console.info('Alta precisión GPS no disponible (habitual en portátiles sin chip GPS). Reintentando por Wi-Fi/red...', errHigh.message);

        // Fase 2: Fallback para portátiles (triangulación por redes Wi-Fi e IP)
        navigator.geolocation.getCurrentPosition(
          (pos) => procesarPosicionGps(pos),
          (errLow) => {
            if (geoBtn) geoBtn.classList.remove('loading');
            let msg = 'Ubicación no disponible.';
            if (errLow.code === 1 || errHigh.code === 1) {
              msg = 'Ubicación desactivada en tu sistema/navegador. Haz clic en el mapa para situarte.';
            } else if (errLow.code === 2) {
              msg = 'Sin señal GPS/Wi-Fi en este equipo. Haz clic directamente en el mapa.';
            } else if (errLow.code === 3) {
              msg = 'Tiempo de espera agotado al consultar la ubicación.';
            }

            if (formatHint) {
              formatHint.textContent = `⚠️ ${msg}`;
              formatHint.style.color = 'var(--secondary-pumpkin)';
            }

            // Llamar la atención amigablemente sobre el mapa
            const pill = document.getElementById('map-instruction-pill');
            if (pill) {
              pill.style.borderColor = 'var(--secondary-pumpkin)';
              setTimeout(() => {
                pill.style.borderColor = '';
              }, 3000);
            }
          },
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 120000
          }
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 4500, // Timeout corto para no congelar la interfaz en portátiles sin chip
        maximumAge: 0
      }
    );
  }

  function procesarPosicionGps(pos) {
    if (geoBtn) geoBtn.classList.remove('loading');
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 0; // Precisión estimada en metros

    if (leafletMap) {
      const targetZoom = accuracy > 150 ? 16 : 18;
      leafletMap.flyTo([lat, lon], targetZoom, { duration: 1.5 });
    }

    colocarPinTemporal(lat, lon);

    // Si es un portátil con margen amplio de Wi-Fi/IP (>100 metros), avisar sutilmente
    if (accuracy > 100) {
      formatHint.textContent = `Aproximación por Wi-Fi (±${Math.round(accuracy)}m). Haz clic en tu tejado para afinar.`;
      formatHint.style.color = 'var(--secondary-pumpkin)';
    }

    ejecutarConsultaCoordenadas(lat, lon);
  }

  // ==========================================
  // 6. CONSULTAS DIRECTAS XML A CATASTRO (FALLBACK)
  // ==========================================
  function getTag(root, tag) {
    if (!root) return '';
    const el = root.getElementsByTagName(tag)[0];
    return el && el.textContent ? el.textContent.trim() : '';
  }

  function formatPercent(val, maxDecimals = 2) {
    if (val === null || val === undefined || val === '') return '';
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
    if (isNaN(num)) return String(val);
    return num.toLocaleString('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals
    });
  }

  async function consultarCatastroDirecto(rc) {
    const rcClean = cleanRC(rc);
    const matriz = rcClean.substring(0, 14);

    const dnprcUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${rcClean}`;
    const respDnprc = await fetch(dnprcUrl);
    if (!respDnprc.ok) {
      throw new Error(`El Catastro respondió con código de estado HTTP ${respDnprc.status}`);
    }
    const xmlTextDnprc = await respDnprc.text();
    const parser = new DOMParser();
    const xmlDocDnprc = parser.parseFromString(xmlTextDnprc, 'text/xml');

    const errDes = getTag(xmlDocDnprc, 'des');
    const lerr = xmlDocDnprc.getElementsByTagName('lerr')[0];
    if (lerr && errDes) {
      return { error: errDes };
    }

    const bi = xmlDocDnprc.getElementsByTagName('bi')[0];
    if (!bi) {
      // Comprobar división horizontal (lrcdnp)
      const lrcdnp = xmlDocDnprc.getElementsByTagName('lrcdnp')[0];
      if (lrcdnp) {
        const rcdnpElems = xmlDocDnprc.getElementsByTagName('rcdnp');
        const unidades = [];
        for (let i = 0; i < rcdnpElems.length; i++) {
          const item = rcdnpElems[i];
          const pc1 = getTag(item, 'pc1');
          const pc2 = getTag(item, 'pc2');
          const car = getTag(item, 'car');
          const cc1 = getTag(item, 'cc1');
          const cc2 = getTag(item, 'cc2');
          const pt = getTag(item, 'pt');
          const pu = getTag(item, 'pu');
          const ldt = getTag(item, 'ldt');
          const fullRc = `${pc1}${pc2}${car}${cc1}${cc2}`.trim();
          if (fullRc) {
            unidades.push({
              referencia: fullRc,
              planta: pt,
              puerta: pu,
              ubicacion: `Planta ${pt || '-'} Puerta ${pu || '-'}`.trim(),
              direccion: ldt
            });
          }
        }
        if (unidades.length > 0) {
          const primerInmueble = await consultarCatastroDirecto(unidades[0].referencia);
          if (!primerInmueble.error) {
            primerInmueble.unidades_inmuebles = unidades;
            primerInmueble.referencia_matriz = matriz;
            return primerInmueble;
          }
        }
      }
      return { error: 'Inmueble o parcela no encontrada en el Catastro.' };
    }

    const claseRaw = getTag(bi, 'cn');
    const clase = claseRaw === 'RU' ? 'Rústico' : claseRaw === 'UR' ? 'Urbano' : claseRaw;

    const provCode = getTag(xmlDocDnprc, 'cp') || rcClean.substring(0, 2);
    const munCode = getTag(xmlDocDnprc, 'cmc');
    const provincia = getTag(xmlDocDnprc, 'np');
    const poblacion = getTag(xmlDocDnprc, 'nm');
    const direccion = getTag(xmlDocDnprc, 'ldt');

    const debi = xmlDocDnprc.getElementsByTagName('debi')[0];
    const luso = getTag(debi || bi, 'luso');
    const sfc = getTag(debi || bi, 'sfc');
    const cpt = getTag(debi || bi, 'cpt');
    const ant = getTag(debi || bi, 'ant');

    // Subparcelas (Rústico)
    const subparcelas = [];
    let totalM2Cultivo = 0;
    const sprElems = xmlDocDnprc.getElementsByTagName('spr');
    for (let i = 0; i < sprElems.length; i++) {
      const spr = sprElems[i];
      const cspr = getTag(spr, 'cspr');
      const ccc = getTag(spr, 'ccc');
      const dcc = getTag(spr, 'dcc');
      const ip = getTag(spr, 'ip');
      const sspStr = getTag(spr, 'ssp') || '0';
      const m2 = parseInt(sspStr, 10) || 0;
      totalM2Cultivo += m2;

      subparcelas.push({
        subparcela: cspr,
        codigo: ccc,
        nombre: dcc,
        intensidad: ip,
        superficie_m2: m2
      });
    }

    // Construcciones (Urbano)
    const construcciones = [];
    const consElems = xmlDocDnprc.getElementsByTagName('cons');
    for (let i = 0; i < consElems.length; i++) {
      const cons = consElems[i];
      const lcd = getTag(cons, 'lcd');
      const stl = parseInt(getTag(cons, 'stl') || '0', 10);
      const pt = getTag(cons, 'pt');
      const pu = getTag(cons, 'pu');

      let ubicacion = '';
      if (pt || pu) {
        ubicacion = `Planta ${pt || '-'} Puerta ${pu || '-'}`.trim();
      }

      construcciones.push({
        destino: lcd,
        superficie_m2: stl,
        ubicacion: ubicacion
      });
    }

    let tamanoM2 = 0;
    let tipoTamano = '';
    if (clase === 'Rústico') {
      tamanoM2 = totalM2Cultivo;
      tipoTamano = 'Extensión de parcela / terreno (Rústico)';
    } else {
      tamanoM2 = parseInt(sfc, 10) || 0;
      tipoTamano = 'Superficie construida (Inmueble Urbano)';
    }

    // Coordenadas WGS84
    let latitud = null;
    let longitud = null;
    let googleMapsUrl = '';
    try {
      const cpmrcUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?Provincia=&Municipio=&SRS=EPSG:4326&RC=${matriz}`;
      const respCoord = await fetch(cpmrcUrl);
      if (respCoord.ok) {
        const xmlCoordText = await respCoord.text();
        const xmlDocCoord = parser.parseFromString(xmlCoordText, 'text/xml');
        const xcen = getTag(xmlDocCoord, 'xcen');
        const ycen = getTag(xmlDocCoord, 'ycen');
        if (xcen && ycen) {
          longitud = parseFloat(xcen);
          latitud = parseFloat(ycen);
          googleMapsUrl = `https://www.google.com/maps?q=${latitud},${longitud}`;
        }
      }
    } catch (eGeo) {
      console.warn('No se pudieron obtener las coordenadas geográficas:', eGeo);
    }

    const urbrusFlag = clase === 'Rústico' ? 'R' : 'U';
    const sedeUrl = `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCConCiud.aspx?UrbRus=${urbrusFlag}&RefC=${rcClean}&esBice=&RCBice1=&RCBice2=&DenoBice=&from=OVCBusqueda&pest=rc&RCCompleta=${rcClean}&final=&del=${provCode}&mun=${munCode}`;

    return {
      referencia: rcClean,
      referencia_matriz: matriz,
      clase: clase,
      poblacion: formatTitle(poblacion),
      provincia: formatTitle(provincia),
      tamano_m2: tamanoM2,
      tipo_tamano: tipoTamano,
      uso_principal: formatTitle(luso) || (clase === 'Rústico' ? 'Agrario' : 'Urbano'),
      ano_construccion: ant,
      coeficiente_participacion: formatPercent(cpt, 2),
      direccion: direccion,
      subparcelas: subparcelas,
      construcciones: construcciones,
      latitud: latitud,
      longitud: longitud,
      google_maps_url: googleMapsUrl,
      sede_catastro_url: sedeUrl,
      error: ''
    };
  }

  async function consultarCoordenadasDirecto(lat, lon) {
    const parser = new DOMParser();
    const urlExact = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?SRS=EPSG:4326&Coordenada_X=${lon}&Coordenada_Y=${lat}`;
    const resp = await fetch(urlExact);
    if (resp.ok) {
      const xml = await resp.text();
      const doc = parser.parseFromString(xml, 'text/xml');
      const pc1 = getTag(doc, 'pc1');
      const pc2 = getTag(doc, 'pc2');
      const ldt = getTag(doc, 'ldt');
      if (pc1 && pc2) {
        return {
          referencia: `${pc1}${pc2}`,
          direccion: ldt,
          latitud: lat,
          longitud: lon,
          distancia_m: 0
        };
      }

      // Proximidad si cae en vía pública
      const urlDist = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR_Distancia?SRS=EPSG:4326&Coordenada_X=${lon}&Coordenada_Y=${lat}`;
      const respDist = await fetch(urlDist);
      if (respDist.ok) {
        const xmlDist = await respDist.text();
        const docDist = parser.parseFromString(xmlDist, 'text/xml');
        const pcd = docDist.getElementsByTagName('pcd')[0];
        if (pcd) {
          const pc1d = getTag(pcd, 'pc1');
          const pc2d = getTag(pcd, 'pc2');
          const ldtd = getTag(pcd, 'ldt');
          const dis = parseFloat(getTag(pcd, 'dis') || '0') || 0;
          if (pc1d && pc2d && dis <= 60.0) {
            return {
              referencia: `${pc1d}${pc2d}`,
              direccion: ldtd,
              latitud: lat,
              longitud: lon,
              distancia_m: dis
            };
          }
        }
      }
    }
    return {
      error: 'No se encontró ninguna parcela catastral en estas coordenadas ni en sus inmediaciones.',
      latitud: lat,
      longitud: lon
    };
  }

  // ==========================================
  // 7. RENDERIZADO DE RESULTADOS EN EL DOM
  // ==========================================
  function renderizarResultados(data) {
    const isRustico = data.clase === 'Rústico';

    classBadge.textContent = data.clase || 'Desconocido';
    classBadge.className = `badge-class ${isRustico ? 'rustico' : 'urbano'}`;

    useBadge.textContent = data.uso_principal || (isRustico ? 'Agrario' : 'Residencial');
    resultRc.textContent = data.referencia;
    resultAddress.textContent = data.direccion || 'Dirección no disponible';
    resultMunicipio.textContent = data.poblacion || '-';
    resultProvincia.textContent = data.provincia || '-';

    resultSummary.textContent = generarSintesisInmueble(data);

    // Métricas
    sizeLabel.textContent = isRustico ? 'Superficie de Parcela' : 'Superficie Construida';
    if (data.tamano_m2 && data.tamano_m2 > 0) {
      resultSize.textContent = `${data.tamano_m2.toLocaleString('es-ES')} m²`;
      if (isRustico) {
        const ha = (data.tamano_m2 / 10000).toLocaleString('es-ES', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        resultSizeExtra.textContent = `${ha} ha`;
      } else {
        resultSizeExtra.textContent = 'En división horizontal o unifamiliar';
      }
    } else {
      resultSize.textContent = '-';
      resultSizeExtra.textContent = 'Sin datos de superficie';
    }

    resultUse.textContent = data.uso_principal || (isRustico ? 'Agrario' : 'Urbano');
    resultClassText.textContent = isRustico ? 'Finca Rústica' : 'Inmueble Urbano';

    if (data.ano_construccion && data.ano_construccion !== '0') {
      resultYear.textContent = data.ano_construccion;
      const antiguedad = new Date().getFullYear() - parseInt(data.ano_construccion, 10);
      resultYearSub.textContent = `${antiguedad} años de antigüedad`;
    } else {
      resultYear.textContent = '-';
      resultYearSub.textContent = isRustico ? 'Suelo rústico sin edificación' : 'Año no declarado';
    }

    if (data.coeficiente_participacion) {
      resultCoef.textContent = `${formatPercent(data.coeficiente_participacion, 2)}%`;
      resultCoefSub.textContent = 'Cuota en propiedad horizontal';
    } else {
      resultCoef.textContent = '-';
      resultCoefSub.textContent = isRustico ? 'Finca única independiente' : 'No aplica o finca matriz';
    }

    // Acciones Google Maps y Sede Catastro
    if (data.google_maps_url) {
      btnGoogleMaps.href = data.google_maps_url;
      btnGoogleMaps.style.display = 'flex';
      if (data.latitud && data.longitud) {
        coordsText.textContent = `${data.latitud.toFixed(5)}, ${data.longitud.toFixed(5)}`;
      }
    } else {
      btnGoogleMaps.style.display = 'none';
    }

    if (data.sede_catastro_url) {
      btnSedeCatastro.href = data.sede_catastro_url;
      btnSedeCatastro.style.display = 'flex';
    }

    // Gestión de división horizontal (múltiples unidades en el edificio)
    if (multiUnitsCard && multiUnitsSelect) {
      if (data.unidades_inmuebles && data.unidades_inmuebles.length > 1) {
        multiUnitsCard.style.display = 'block';
        if (multiUnitsBadge) {
          multiUnitsBadge.textContent = `${data.unidades_inmuebles.length} inmuebles`;
        }
        let optsHtml = '';
        data.unidades_inmuebles.forEach(u => {
          const isSelected = u.referencia === data.referencia ? 'selected' : '';
          const label = u.ubicacion || 'Inmueble';
          optsHtml += `<option value="${escapeHtml(u.referencia)}" ${isSelected}>${escapeHtml(label)} • Ref: ${escapeHtml(u.referencia)}</option>`;
        });
        multiUnitsSelect.innerHTML = optsHtml;

        multiUnitsSelect.onchange = (e) => {
          const selectedRc = e.target.value;
          if (selectedRc && selectedRc !== data.referencia) {
            rcInput.value = selectedRc;
            ejecutarConsulta(selectedRc);
          }
        };
      } else {
        multiUnitsCard.style.display = 'none';
      }
    }

    // Asistente de Cargas y Nota Simple (Paso 1)
    const copyRcStepText = document.getElementById('copy-rc-step-text');
    if (copyRcStepText) {
      copyRcStepText.textContent = `Copiar ${data.referencia}`;
    }

    renderizarDesglose(data);

    resultsSection.style.display = 'block';

    if (data.latitud && data.longitud) {
      actualizarMapa(data.latitud, data.longitud, data);
    }
  }

  // Síntesis descriptiva
  function generarSintesisInmueble(data) {
    if (data.ai_summary) {
      return data.ai_summary;
    }

    const isRustico = data.clase === 'Rústico';
    const m2 = data.tamano_m2 ? data.tamano_m2.toLocaleString('es-ES') : '0';

    if (isRustico) {
      const numSub = data.subparcelas ? data.subparcelas.length : 0;
      let cultivosTexto = '';
      if (numSub > 0) {
        const nombresCultivos = [...new Set(data.subparcelas.map(s => s.nombre.toLowerCase()))].filter(Boolean);
        if (nombresCultivos.length > 0) {
          cultivosTexto = ` con dedicación principal a ${nombresCultivos.join(', ')}`;
        }
      }
      return `Finca rústica de ${m2} m² de superficie situada en el término municipal de ${data.poblacion} (${data.provincia}), en el paraje o localización ${data.direccion}. Consta de un uso catastral ${data.uso_principal.toLowerCase()}${cultivosTexto}, subdividida en ${numSub} subparcela${numSub !== 1 ? 's' : ''} productiva${numSub !== 1 ? 's' : ''}.`;
    } else {
      let detalleUrb = '';
      if (data.ano_construccion) {
        detalleUrb += ` edificada en el año ${data.ano_construccion}`;
      }
      if (data.coeficiente_participacion) {
        detalleUrb += ` y con una cuota de participación horizontal del ${formatPercent(data.coeficiente_participacion, 2)}%`;
      }
      return `Inmueble urbano de uso ${data.uso_principal.toLowerCase()} con una superficie construida total de ${m2} m²${detalleUrb}. Ubicado en ${data.direccion}, dentro de la población de ${data.poblacion} (${data.provincia}).`;
    }
  }

  function renderizarDesglose(data) {
    const isRustico = data.clase === 'Rústico';

    if (isRustico) {
      detailsTitle.textContent = 'Desglose de Subparcelas y Cultivos';
      const items = data.subparcelas || [];
      detailsCountBadge.textContent = `${items.length} subparcela${items.length !== 1 ? 's' : ''}`;

      if (items.length === 0) {
        detailsTableWrapper.innerHTML = '<p style="padding: 1rem; color: var(--text-muted); font-size: 0.9rem;">No consta desglose de cultivos para esta parcela en el Catastro.</p>';
        return;
      }

      const totalM2 = data.tamano_m2 || 1;
      let html = `
        <table class="custom-table" role="table" aria-label="Tabla de subparcelas agrícolas">
          <thead>
            <tr>
              <th>Subp.</th>
              <th>Cultivo / Aprovechamiento</th>
              <th>Intensidad</th>
              <th>Superficie</th>
              <th>% Parcela</th>
            </tr>
          </thead>
          <tbody>
      `;

      items.forEach(item => {
        const pct = ((item.superficie_m2 / totalM2) * 100).toLocaleString('es-ES', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        });
        html += `
          <tr>
            <td><span class="subp-tag">${escapeHtml(item.subparcela || '-')}</span></td>
            <td><strong>${escapeHtml(item.nombre || 'Cultivo sin clasificar')}</strong> ${item.codigo ? `<span style="font-size: 0.78rem; color: var(--text-muted);">(${escapeHtml(item.codigo)})</span>` : ''}</td>
            <td>${escapeHtml(item.intensidad || '00')}</td>
            <td><strong>${item.superficie_m2.toLocaleString('es-ES')} m²</strong></td>
            <td>
              <div class="pct-bar-wrap">
                <span>${pct}%</span>
                <div class="pct-bar-bg"><div class="pct-bar-fill" style="width: ${Math.min(100, (item.superficie_m2 / totalM2) * 100)}%;"></div></div>
              </div>
            </td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      detailsTableWrapper.innerHTML = html;

    } else {
      detailsTitle.textContent = 'Elementos y Construcciones Declaradas';
      const items = data.construcciones || [];
      detailsCountBadge.textContent = `${items.length} elemento${items.length !== 1 ? 's' : ''}`;

      if (items.length === 0) {
        detailsTableWrapper.innerHTML = '<p style="padding: 1rem; color: var(--text-muted); font-size: 0.9rem;">No constan elementos construidos detallados en la ficha simplificada del Catastro.</p>';
        return;
      }

      let html = `
        <table class="custom-table" role="table" aria-label="Tabla de construcciones urbanas">
          <thead>
            <tr>
              <th>Uso / Destino</th>
              <th>Planta / Puerta</th>
              <th>Superficie Construida</th>
            </tr>
          </thead>
          <tbody>
      `;

      items.forEach(item => {
        html += `
          <tr>
            <td><strong>${escapeHtml(item.destino || 'Vivienda')}</strong></td>
            <td>${escapeHtml(item.ubicacion || 'Planta Principal')}</td>
            <td><strong>${item.superficie_m2.toLocaleString('es-ES')} m²</strong></td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      detailsTableWrapper.innerHTML = html;
    }
  }

  // ==========================================
  // 8. VISOR CARTOGRÁFICO INTERACTIVO (LEAFLET + PNOA + CATASTRO WMS)
  // ==========================================
  function initLeafletMap() {
    const mapElement = document.getElementById('map');
    if (!mapElement || typeof L === 'undefined') return;

    try {
      // Leer última ubicación guardada o fallback a Km 0 (Puerta del Sol)
      let initialLat = DEFAULT_LAT;
      let initialLon = DEFAULT_LON;
      let initialZoom = DEFAULT_ZOOM;

      const savedCoords = localStorage.getItem('yaluba_last_coords');
      if (savedCoords) {
        try {
          const parsed = JSON.parse(savedCoords);
          if (parsed.lat && parsed.lon) {
            initialLat = parsed.lat;
            initialLon = parsed.lon;
            initialZoom = parsed.zoom || 18;
          }
        } catch (eParse) {}
      }

      leafletMap = L.map('map', {
        center: [initialLat, initialLon],
        zoom: initialZoom,
        scrollWheelZoom: false,
        zoomControl: true
      });

      // Capa 1: Satélite Oficial PNOA (IGN)
      const pnoaLayer = L.tileLayer.wms('https://www.ign.es/wms-inspire/pnoa-ma', {
        layers: 'OI.OrthoimageCoverage',
        format: 'image/png',
        transparent: false,
        version: '1.3.0',
        attribution: '© IGN España - PNOA'
      });

      // Capa 2: Callejero OpenStreetMap
      const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      });

      // Capa 3: Linderos Oficiales Catastro (WMS)
      const catastroWmsLayer = L.tileLayer.wms('https://ovc.catastro.meh.es/cartografia/INSPIRE/spadgcwms.aspx', {
        layers: 'CP.CadastralParcel,BU.Building',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        attribution: '© D.G. del Catastro'
      });

      pnoaLayer.addTo(leafletMap);
      catastroWmsLayer.addTo(leafletMap);

      const baseMaps = {
        'Satélite Oficial (PNOA)': pnoaLayer,
        'Callejero (OpenStreetMap)': osmLayer
      };

      const overlayMaps = {
        'Linderos Catastro (WMS)': catastroWmsLayer
      };

      L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(leafletMap);

      // Actualizar coordenadas en tiempo real al mover el ratón
      leafletMap.on('mousemove', (e) => {
        if (latVal && lonVal) {
          latVal.textContent = e.latlng.lat.toFixed(5);
          lonVal.textContent = e.latlng.lng.toFixed(5);
        }
      });

      // Interacción clave: Clic en el mapa para consultar la parcela
      leafletMap.on('click', (e) => {
        const clickLat = e.latlng.lat;
        const clickLon = e.latlng.lng;
        colocarPinTemporal(clickLat, clickLon);
        ejecutarConsultaCoordenadas(clickLat, clickLon);
      });

      // Actualizar valores iniciales de la barra de coordenadas
      if (latVal && lonVal) {
        latVal.textContent = initialLat.toFixed(5);
        lonVal.textContent = initialLon.toFixed(5);
      }

      setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
      }, 300);

    } catch (err) {
      console.warn('Error inicializando visor cartográfico:', err);
    }
  }

  function colocarPinTemporal(lat, lon) {
    if (!leafletMap || typeof L === 'undefined') return;

    if (mapMarker) {
      leafletMap.removeLayer(mapMarker);
    }

    const customPin = L.divIcon({
      className: 'catastro-pin-wrap',
      html: `
        <div style="transform: translate(-14px, -36px); width: 28px; height: 36px; cursor: pointer; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));">
          <svg viewBox="0 0 24 36" width="28" height="36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24c0-6.627-5.373-12-12-12z" fill="#FF7518"/>
            <circle cx="12" cy="12" r="5" fill="#FFFFFF"/>
          </svg>
        </div>
      `,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -36]
    });

    mapMarker = L.marker([lat, lon], { icon: customPin }).addTo(leafletMap);
  }

  function actualizarMapa(lat, lon, data) {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    if (typeof L === 'undefined') {
      mapElement.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 250px; padding: 2rem; text-align: center; background-color: var(--bg-subtle); color: var(--text-secondary); border-radius: var(--radius-md);">
          <p style="font-weight: 700; margin-bottom: 0.5rem; color: var(--text-primary);">Visor Cartográfico</p>
          <p style="font-size: 0.88rem; margin-bottom: 1rem;">Coordenadas: ${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
          <a href="${data.google_maps_url}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.5rem; background-color: var(--secondary-pumpkin); color: #fff; padding: 0.6rem 1.2rem; border-radius: var(--radius-sm); font-weight: 700; font-size: 0.85rem; text-decoration: none;">
            Abrir ubicación en Google Maps &rarr;
          </a>
        </div>
      `;
      return;
    }

    try {
      if (!leafletMap) {
        initLeafletMap();
      }

      leafletMap.setView([lat, lon], 18);

      if (mapMarker) {
        leafletMap.removeLayer(mapMarker);
      }

      const customPin = L.divIcon({
        className: 'catastro-pin-wrap',
        html: `
          <div style="transform: translate(-14px, -36px); width: 28px; height: 36px; cursor: pointer; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));">
            <svg viewBox="0 0 24 36" width="28" height="36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24c0-6.627-5.373-12-12-12z" fill="#FF7518"/>
              <circle cx="12" cy="12" r="5" fill="#FFFFFF"/>
            </svg>
          </div>
        `,
        iconSize: [28, 36],
        iconAnchor: [14, 36],
        popupAnchor: [0, -36]
      });

      const popupHtml = `
        <div style="font-family: var(--font-sans); font-size: 0.85rem; line-height: 1.4; color: #1E293B;">
          <strong style="color: #7DA92E; font-size: 0.95rem;">${escapeHtml(data.referencia)}</strong><br>
          <strong>${escapeHtml(data.direccion)}</strong><br>
          <span>${escapeHtml(data.poblacion)} (${escapeHtml(data.provincia)})</span><br>
          <span>Superficie: <strong>${data.tamano_m2 ? data.tamano_m2.toLocaleString('es-ES') : '-'} m²</strong></span><br>
          <div style="margin-top: 0.5rem;">
            <a href="${data.google_maps_url}" target="_blank" rel="noopener noreferrer" style="color: #FF7518; font-weight: 700; text-decoration: underline;">
              Abrir en Google Maps &rarr;
            </a>
          </div>
        </div>
      `;

      mapMarker = L.marker([lat, lon], { icon: customPin }).addTo(leafletMap).bindPopup(popupHtml);

      if (latVal && lonVal) {
        latVal.textContent = lat.toFixed(5);
        lonVal.textContent = lon.toFixed(5);
      }

      setTimeout(() => {
        if (leafletMap) leafletMap.invalidateSize();
      }, 200);
    } catch (eMap) {
      console.warn('Error al actualizar Leaflet:', eMap);
    }
  }

  // ==========================================
  // 9. ACCIONES: COPIAR Y ACCIONES REGISTRALES
  // ==========================================
  copyRcBtn.addEventListener('click', () => {
    if (!currentPropertyData) return;
    copiarTexto(currentPropertyData.referencia, copyRcBtn);
  });

  copySummaryBtn.addEventListener('click', () => {
    if (!currentPropertyData) return;
    const d = currentPropertyData;
    const textoFicha = `FICHA CATASTRAL - YALUBA
Referencia: ${d.referencia}
Clase: ${d.clase}
Dirección: ${d.direccion}
Municipio: ${d.poblacion} (${d.provincia})
Superficie: ${d.tamano_m2 ? d.tamano_m2.toLocaleString('es-ES') : '-'} m² (${d.tipo_tamano})
Uso: ${d.uso_principal}
Año Construcción: ${d.ano_construccion || '-'}
Coeficiente Horizontal: ${d.coeficiente_participacion ? formatPercent(d.coeficiente_participacion, 2) + '%' : '-'}
Google Maps: ${d.google_maps_url}
Sede Catastro: ${d.sede_catastro_url}
`;
    copiarTexto(textoFicha, copySummaryBtn);
  });

  printBtn.addEventListener('click', () => {
    window.print();
  });

  // Copiar Referencia Catastral (Paso 1 Guía Nota Simple)
  const copyRcStepBtn = document.getElementById('copy-rc-step-btn');
  const copyRcStepText = document.getElementById('copy-rc-step-text');
  if (copyRcStepBtn) {
    copyRcStepBtn.addEventListener('click', () => {
      if (!currentPropertyData) return;
      copiarTexto(currentPropertyData.referencia, copyRcStepBtn);
      const originalText = copyRcStepText.textContent;
      copyRcStepText.textContent = '¡Referencia Copiada!';
      setTimeout(() => {
        copyRcStepText.textContent = originalText;
      }, 2000);
    });
  }

  // Copiar Motivo de Interés Legítimo (Paso 2 Guía Nota Simple)
  const copyReasonBtn = document.getElementById('copy-reason-btn');
  const copyReasonText = document.getElementById('copy-reason-text');
  const reasonSelect = document.getElementById('reason-select');
  if (copyReasonBtn && reasonSelect) {
    copyReasonBtn.addEventListener('click', () => {
      const motivo = reasonSelect.value;
      if (!motivo) return;
      copiarTexto(motivo, copyReasonBtn);
      const originalText = copyReasonText.textContent;
      copyReasonText.textContent = '¡Motivo Copiado al Portapapeles!';
      setTimeout(() => {
        copyReasonText.textContent = originalText;
      }, 2000);
    });
  }

  function copiarTexto(texto, btnElement) {
    navigator.clipboard.writeText(texto).then(() => {
      btnElement.classList.add('copied');
      setTimeout(() => {
        btnElement.classList.remove('copied');
      }, 2000);
    }).catch(err => {
      console.warn('Fallo al copiar:', err);
      const ta = document.createElement('textarea');
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btnElement.classList.add('copied');
      setTimeout(() => btnElement.classList.remove('copied'), 2000);
    });
  }

  // ==========================================
  // 10. HISTORIAL DE BÚSQUEDAS LOCAL
  // ==========================================
  function cargarHistorial() {
    try {
      const items = JSON.parse(localStorage.getItem('yaluba_catastro_history') || '[]');
      if (!Array.isArray(items) || items.length === 0) {
        historySection.style.display = 'none';
        return;
      }

      historyList.innerHTML = '';
      items.slice(0, 6).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'history-item-btn';
        btn.innerHTML = `
          <span class="chip-badge ${item.clase === 'Rústico' ? 'rustico' : 'urbano'}">${item.clase || 'RC'}</span>
          <span class="history-rc">${escapeHtml(item.rc)}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.poblacion || '')}</span>
        `;
        btn.addEventListener('click', () => {
          rcInput.value = item.rc;
          rcInput.dispatchEvent(new Event('input'));
          ejecutarConsulta(item.rc);
        });
        historyList.appendChild(btn);
      });

      historySection.style.display = 'block';
    } catch (e) {
      console.warn('Error leyendo historial:', e);
    }
  }

  function guardarHistorial(data) {
    try {
      let items = JSON.parse(localStorage.getItem('yaluba_catastro_history') || '[]');
      if (!Array.isArray(items)) items = [];

      items = items.filter(i => i.rc !== data.referencia);
      items.unshift({
        rc: data.referencia,
        clase: data.clase,
        poblacion: data.poblacion,
        direccion: data.direccion,
        timestamp: Date.now()
      });

      localStorage.setItem('yaluba_catastro_history', JSON.stringify(items.slice(0, 10)));
      cargarHistorial();
    } catch (e) {
      console.warn('Error guardando en historial:', e);
    }
  }

  clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem('yaluba_catastro_history');
    cargarHistorial();
  });

  cargarHistorial();

  // ==========================================
  // 11. INICIALIZACIÓN DEL MAPA INICIAL
  // ==========================================
  initLeafletMap();

  // ==========================================
  // 12. UTILIDADES Y HELPERS DE UI
  // ==========================================
  function setLoading(isLoading) {
    if (isLoading) {
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
      loadingState.style.display = 'block';
    } else {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      loadingState.style.display = 'none';
    }
  }

  function mostrarError(msg) {
    errorMessage.textContent = msg;
    errorState.style.display = 'block';
    resultsSection.style.display = 'none';
  }

  function ocultarError() {
    errorState.style.display = 'none';
  }

  function ocultarResultados() {
    resultsSection.style.display = 'none';
  }

  function formatTitle(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/(?:^|\s|\/)\S/g, a => a.toUpperCase());
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================
  // 13. GESTIÓN DE DONACIONES CRYPTO (Invítame a un café)
  // ==========================================
  const cryptoModal = document.getElementById('crypto-modal');
  const cryptoModalBackdrop = document.getElementById('crypto-modal-backdrop');
  const cryptoModalClose = document.getElementById('crypto-modal-close');
  const cryptoModalTitle = document.getElementById('crypto-modal-title');
  const cryptoModalIcon = document.getElementById('crypto-modal-icon');
  const cryptoModalQr = document.getElementById('crypto-modal-qr');
  const cryptoModalAddress = document.getElementById('crypto-modal-address');
  const cryptoModalUri = document.getElementById('crypto-modal-uri');
  const cryptoCopyAddressBtn = document.getElementById('crypto-copy-address-btn');
  const cryptoCopyAddressText = document.getElementById('crypto-copy-address-text');
  const cryptoCopyUriBtn = document.getElementById('crypto-copy-uri-btn');
  const cryptoCopyUriText = document.getElementById('crypto-copy-uri-text');
  const tipBtcBtn = document.getElementById('tip-btc-btn');
  const tipSolBtn = document.getElementById('tip-sol-btn');

  const CRYPTO_DATA = {
    btc: {
      title: 'Bitcoin',
      icon: 'img/bitcoin.svg',
      address: 'bc1qhja0dm86zvwhvarqv0sgs8zed5v39g6khvjety',
      uri: 'bitcoin:bc1qhja0dm86zvwhvarqv0sgs8zed5v39g6khvjety?amount=0.00002&message=Cryptax%20tips',
      qrLight: 'img/btc-qr.svg',
      qrDark: 'img/btc-qr-dark.svg'
    },
    sol: {
      title: 'Solana',
      icon: 'img/solana.svg',
      address: '4q3tmrDPhh2YzLjkAoc5mkiuXq1Dbtn5uzRH1UaZLrRR',
      uri: 'solana:4q3tmrDPhh2YzLjkAoc5mkiuXq1Dbtn5uzRH1UaZLrRR?amount=0.02&label=Cryptax%20tips',
      qrLight: 'img/solana-qr.svg',
      qrDark: 'img/solana-qr-dark.svg'
    }
  };

  let activeCryptoType = 'btc';

  function abrirModalCrypto(tipo) {
    activeCryptoType = tipo;
    const config = CRYPTO_DATA[tipo];
    if (!config) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (cryptoModalTitle) cryptoModalTitle.textContent = config.title;
    if (cryptoModalIcon) {
      cryptoModalIcon.src = config.icon;
      cryptoModalIcon.alt = config.title;
    }
    if (cryptoModalQr) {
      cryptoModalQr.src = isDark ? config.qrDark : config.qrLight;
    }
    if (cryptoModalAddress) {
      cryptoModalAddress.textContent = config.address;
    }
    if (cryptoModalUri) {
      cryptoModalUri.textContent = config.uri;
    }

    if (cryptoCopyAddressText) cryptoCopyAddressText.textContent = 'Copiar Dirección';
    if (cryptoCopyAddressBtn) cryptoCopyAddressBtn.classList.remove('copied');
    if (cryptoCopyUriText) cryptoCopyUriText.textContent = 'Copiar URI';
    if (cryptoCopyUriBtn) cryptoCopyUriBtn.classList.remove('copied');

    if (cryptoModal) cryptoModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function cerrarModalCrypto() {
    if (cryptoModal) cryptoModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function copiarTexto(texto, btnEl, textEl, defaultText) {
    if (!texto) return;

    const feedbackExito = () => {
      if (textEl) textEl.textContent = '¡Copiado!';
      if (btnEl) btnEl.classList.add('copied');
      setTimeout(() => {
        if (textEl) textEl.textContent = defaultText;
        if (btnEl) btnEl.classList.remove('copied');
      }, 2500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(texto);
        feedbackExito();
        return;
      } catch (err) {
        console.warn('Fallo navigator.clipboard:', err);
      }
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = texto;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      feedbackExito();
    } catch (e) {
      console.error('Error al copiar:', e);
    }
  }

  if (tipBtcBtn) tipBtcBtn.addEventListener('click', () => abrirModalCrypto('btc'));
  if (tipSolBtn) tipSolBtn.addEventListener('click', () => abrirModalCrypto('sol'));
  if (cryptoModalClose) cryptoModalClose.addEventListener('click', cerrarModalCrypto);
  if (cryptoModalBackdrop) cryptoModalBackdrop.addEventListener('click', cerrarModalCrypto);

  if (cryptoCopyAddressBtn) {
    cryptoCopyAddressBtn.addEventListener('click', () => {
      const config = CRYPTO_DATA[activeCryptoType];
      if (config) copiarTexto(config.address, cryptoCopyAddressBtn, cryptoCopyAddressText, 'Copiar Dirección');
    });
  }

  if (cryptoCopyUriBtn) {
    cryptoCopyUriBtn.addEventListener('click', () => {
      const config = CRYPTO_DATA[activeCryptoType];
      if (config) copiarTexto(config.uri, cryptoCopyUriBtn, cryptoCopyUriText, 'Copiar URI');
    });
  }

  if (cryptoModalAddress) {
    cryptoModalAddress.addEventListener('click', () => {
      const config = CRYPTO_DATA[activeCryptoType];
      if (config) copiarTexto(config.address, cryptoCopyAddressBtn, cryptoCopyAddressText, 'Copiar Dirección');
    });
  }

  if (cryptoModalUri) {
    cryptoModalUri.addEventListener('click', () => {
      const config = CRYPTO_DATA[activeCryptoType];
      if (config) copiarTexto(config.uri, cryptoCopyUriBtn, cryptoCopyUriText, 'Copiar URI');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cryptoModal && cryptoModal.style.display === 'flex') {
      cerrarModalCrypto();
    }
  });
});
