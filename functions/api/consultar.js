/**
 * Cloudflare Pages Function: /api/consultar
 * 
 * Proxy de backend y enriquecimiento con IA para la consulta de referencias catastrales y coordenadas GPS.
 * Consulta la Sede Electrónica del Catastro (OVC) y opcionalmente utiliza
 * Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct) para generar un resumen
 * inteligente del inmueble o parcela.
 */

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const rcRaw = (url.searchParams.get('rc') || '').trim();
  const latParam = (url.searchParams.get('lat') || '').trim();
  const lonParam = (url.searchParams.get('lon') || '').trim();

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=3600' // Cache de 1 hora para consultas idénticas
  };

  let queryLat = null;
  let queryLon = null;

  if (latParam && lonParam) {
    const pLat = parseFloat(latParam);
    const pLon = parseFloat(lonParam);
    if (!isNaN(pLat) && !isNaN(pLon)) {
      queryLat = pLat;
      queryLon = pLon;
    }
  } else if (rcRaw.includes(',')) {
    const parts = rcRaw.split(',');
    if (parts.length === 2) {
      const pLat = parseFloat(parts[0].trim());
      const pLon = parseFloat(parts[1].trim());
      if (!isNaN(pLat) && !isNaN(pLon)) {
        queryLat = pLat;
        queryLon = pLon;
      }
    }
  }

  let rc = '';
  if (queryLat !== null && queryLon !== null) {
    const coordRes = await obtenerRCDeCoordenadas(queryLat, queryLon);
    if (coordRes.error) {
      return new Response(JSON.stringify(coordRes), { status: 404, headers: corsHeaders });
    }
    rc = coordRes.referencia;
  } else {
    rc = rcRaw.replace(/[\s\-_.]/g, '').toUpperCase();
  }

  if (!rc || rc.length < 14) {
    return new Response(JSON.stringify({
      error: 'La referencia catastral debe tener al menos 14 caracteres o indicar coordenadas válidas.'
    }), { status: 400, headers: corsHeaders });
  }

  try {
    const data = await obtenerDatosCatastro(rc);

    if (data.error) {
      return new Response(JSON.stringify(data), { status: 404, headers: corsHeaders });
    }

    if (queryLat !== null && queryLon !== null) {
      if (!data.latitud) data.latitud = queryLat;
      if (!data.longitud) data.longitud = queryLon;
      if (!data.google_maps_url) data.google_maps_url = `https://www.google.com/maps?q=${queryLat},${queryLon}`;
    }

    // Enriquecimiento con Cloudflare Workers AI si la variable de entorno 'AI' está configurada
    if (context.env && context.env.AI) {
      try {
        const prompt = `Eres un experto técnico catastral y tasador inmobiliario en España. 
A partir de los siguientes datos oficiales del Catastro, redacta una síntesis ejecutiva, profesional y muy concisa (máximo 3 o 4 frases) describiendo las características clave de la propiedad:
- Referencia: ${data.referencia}
- Tipo: ${data.clase}
- Ubicación: ${data.direccion}, ${data.poblacion} (${data.provincia})
- Superficie: ${data.tamano_m2} m² (${data.tipo_tamano})
- Uso principal: ${data.uso_principal}
- Año edificación: ${data.ano_construccion || 'No consta'}
- Coeficiente horizontal: ${data.coeficiente_participacion || 'No aplica'}
${data.clase === 'Rústico' 
  ? `- Cultivos: ${(data.subparcelas || []).map(s => `${s.nombre} (${s.superficie_m2} m²)`).join(', ')}` 
  : `- Distribución: ${(data.construcciones || []).map(c => `${c.destino} (${c.superficie_m2} m²)`).join(', ')}`
}

Responde directamente con la descripción final en español, sin preámbulos ni encabezados.`;

        const aiResponse = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: 'Eres un redactor experto en análisis inmobiliario y catastral.' },
            { role: 'user', content: prompt }
          ]
        });

        if (aiResponse && aiResponse.response) {
          data.ai_summary = aiResponse.response.trim();
        }
      } catch (aiErr) {
        console.warn('Aviso: Cloudflare Workers AI no disponible o falló:', aiErr.message);
      }
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: `Error interno al consultar el Catastro: ${err.message}`
    }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

/**
 * Consulta OVC y extrae campos mediante expresiones regulares compatibles con Workers
 */
async function obtenerDatosCatastro(rc) {
  const matriz = rc.substring(0, 14);

  // 1. Consulta DNPRC
  const dnprcUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${rc}`;
  const respDnprc = await fetch(dnprcUrl);
  if (!respDnprc.ok) {
    throw new Error(`Catastro OVC HTTP ${respDnprc.status}`);
  }
  const xmlDnprc = await respDnprc.text();

  // Comprobar error
  const errMatch = xmlDnprc.match(/<lerr[^>]*>[\s\S]*?<des>(.*?)<\/des>/i);
  if (errMatch && errMatch[1]) {
    return { error: errMatch[1].trim() };
  }

  if (!xmlDnprc.includes('<bi>') && !xmlDnprc.includes('&lt;bi&gt;')) {
    // Comprobar si hay división horizontal (lrcdnp)
    const rcdnpRegex = /<rcdnp>([\s\S]*?)<\/rcdnp>/gi;
    let rMatch;
    const unidades = [];
    while ((rMatch = rcdnpRegex.exec(xmlDnprc)) !== null) {
      const block = rMatch[1];
      const pc1 = (block.match(/<pc1>(.*?)<\/pc1>/i) || [])[1] || '';
      const pc2 = (block.match(/<pc2>(.*?)<\/pc2>/i) || [])[1] || '';
      const car = (block.match(/<car>(.*?)<\/car>/i) || [])[1] || '';
      const cc1 = (block.match(/<cc1>(.*?)<\/cc1>/i) || [])[1] || '';
      const cc2 = (block.match(/<cc2>(.*?)<\/cc2>/i) || [])[1] || '';
      const pt = (block.match(/<pt>(.*?)<\/pt>/i) || [])[1] || '';
      const pu = (block.match(/<pu>(.*?)<\/pu>/i) || [])[1] || '';
      const ldt = (block.match(/<ldt>(.*?)<\/ldt>/i) || [])[1] || '';
      const fullRc = `${pc1}${pc2}${car}${cc1}${cc2}`.trim();
      if (fullRc) {
        unidades.push({
          referencia: fullRc,
          planta: pt.trim(),
          puerta: pu.trim(),
          ubicacion: `Planta ${pt.trim() || '-'} Puerta ${pu.trim() || '-'}`.trim(),
          direccion: ldt.trim()
        });
      }
    }
    if (unidades.length > 0) {
      const primerInmueble = await obtenerDatosCatastro(unidades[0].referencia);
      if (!primerInmueble.error) {
        primerInmueble.unidades_inmuebles = unidades;
        primerInmueble.referencia_matriz = rc.substring(0, 14);
        return primerInmueble;
      }
    }
    return { error: 'Inmueble o parcela no encontrada en Catastro.' };
  }

  // Parsear campos principales
  const cnMatch = xmlDnprc.match(/<cn>(.*?)<\/cn>/i);
  const claseRaw = cnMatch ? cnMatch[1].trim() : '';
  const clase = claseRaw === 'RU' ? 'Rústico' : claseRaw === 'UR' ? 'Urbano' : claseRaw;

  const cpMatch = xmlDnprc.match(/<cp>(.*?)<\/cp>/i);
  const cmcMatch = xmlDnprc.match(/<cmc>(.*?)<\/cmc>/i);
  const npMatch = xmlDnprc.match(/<np>(.*?)<\/np>/i);
  const nmMatch = xmlDnprc.match(/<nm>(.*?)<\/nm>/i);
  const ldtMatch = xmlDnprc.match(/<ldt>(.*?)<\/ldt>/i);

  const provCode = cpMatch ? cpMatch[1].trim() : rc.substring(0, 2);
  const munCode = cmcMatch ? cmcMatch[1].trim() : '';
  const provincia = npMatch ? npMatch[1].trim() : '';
  const poblacion = nmMatch ? nmMatch[1].trim() : '';
  const direccion = ldtMatch ? ldtMatch[1].trim() : '';

  const lusoMatch = xmlDnprc.match(/<luso>(.*?)<\/luso>/i);
  const sfcMatch = xmlDnprc.match(/<sfc>(.*?)<\/sfc>/i);
  const cptMatch = xmlDnprc.match(/<cpt>(.*?)<\/cpt>/i);
  const antMatch = xmlDnprc.match(/<ant>(.*?)<\/ant>/i);

  const luso = lusoMatch ? lusoMatch[1].trim() : '';
  const sfc = sfcMatch ? sfcMatch[1].trim() : '';
  const cpt = cptMatch ? cptMatch[1].trim() : '';
  const ant = antMatch ? antMatch[1].trim() : '';

  // Subparcelas (Rústico)
  const subparcelas = [];
  let totalM2Cultivo = 0;
  const sprRegex = /<spr>([\s\S]*?)<\/spr>/gi;
  let sprMatch;
  while ((sprMatch = sprRegex.exec(xmlDnprc)) !== null) {
    const sprBlock = sprMatch[1];
    const cspr = (sprBlock.match(/<cspr>(.*?)<\/cspr>/i) || [])[1] || '';
    const ccc = (sprBlock.match(/<ccc>(.*?)<\/ccc>/i) || [])[1] || '';
    const dcc = (sprBlock.match(/<dcc>(.*?)<\/dcc>/i) || [])[1] || '';
    const ip = (sprBlock.match(/<ip>(.*?)<\/ip>/i) || [])[1] || '';
    const sspStr = (sprBlock.match(/<ssp>(.*?)<\/ssp>/i) || [])[1] || '0';
    const m2 = parseInt(sspStr.trim(), 10) || 0;
    totalM2Cultivo += m2;

    subparcelas.push({
      subparcela: cspr.trim(),
      codigo: ccc.trim(),
      nombre: dcc.trim(),
      intensidad: ip.trim(),
      superficie_m2: m2
    });
  }

  // Construcciones (Urbano)
  const construcciones = [];
  const consRegex = /<cons>([\s\S]*?)<\/cons>/gi;
  let consMatch;
  while ((consMatch = consRegex.exec(xmlDnprc)) !== null) {
    const consBlock = consMatch[1];
    const lcd = (consBlock.match(/<lcd>(.*?)<\/lcd>/i) || [])[1] || '';
    const stlStr = (consBlock.match(/<stl>(.*?)<\/stl>/i) || [])[1] || '0';
    const pt = (consBlock.match(/<pt>(.*?)<\/pt>/i) || [])[1] || '';
    const pu = (consBlock.match(/<pu>(.*?)<\/pu>/i) || [])[1] || '';

    let ubicacion = '';
    if (pt || pu) {
      ubicacion = `Planta ${pt.trim() || '-'} Puerta ${pu.trim() || '-'}`.trim();
    }

    construcciones.push({
      destino: lcd.trim(),
      superficie_m2: parseInt(stlStr.trim(), 10) || 0,
      ubicacion: ubicacion
    });
  }

  const tamanoM2 = clase === 'Rústico' ? totalM2Cultivo : (parseInt(sfc, 10) || 0);
  const tipoTamano = clase === 'Rústico' 
    ? 'Extensión de parcela / terreno (Rústico)' 
    : 'Superficie construida (Inmueble Urbano)';

  // 2. Consulta Coordenadas WGS84
  let latitud = null;
  let longitud = null;
  let googleMapsUrl = '';

  try {
    const cpmrcUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?Provincia=&Municipio=&SRS=EPSG:4326&RC=${matriz}`;
    const respCoord = await fetch(cpmrcUrl);
    if (respCoord.ok) {
      const xmlCoord = await respCoord.text();
      const xcenMatch = xmlCoord.match(/<xcen>(.*?)<\/xcen>/i);
      const ycenMatch = xmlCoord.match(/<ycen>(.*?)<\/ycen>/i);
      if (xcenMatch && ycenMatch && xcenMatch[1] && ycenMatch[1]) {
        longitud = parseFloat(xcenMatch[1].trim());
        latitud = parseFloat(ycenMatch[1].trim());
        googleMapsUrl = `https://www.google.com/maps?q=${latitud},${longitud}`;
      }
    }
  } catch (eCoord) {
    console.warn('Aviso: Coordenadas no disponibles:', eCoord.message);
  }

  const urbrusFlag = clase === 'Rústico' ? 'R' : 'U';
  const sedeUrl = `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCConCiud.aspx?UrbRus=${urbrusFlag}&RefC=${rc}&esBice=&RCBice1=&RCBice2=&DenoBice=&from=OVCBusqueda&pest=rc&RCCompleta=${rc}&final=&del=${provCode}&mun=${munCode}`;

  return {
    referencia: rc,
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

async function obtenerRCDeCoordenadas(lat, lon) {
  const urlExact = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?SRS=EPSG:4326&Coordenada_X=${lon}&Coordenada_Y=${lat}`;
  const resp = await fetch(urlExact);
  if (resp.ok) {
    const xml = await resp.text();
    const pc1Match = xml.match(/<pc1>(.*?)<\/pc1>/i);
    const pc2Match = xml.match(/<pc2>(.*?)<\/pc2>/i);
    const ldtMatch = xml.match(/<ldt>(.*?)<\/ldt>/i);
    if (pc1Match && pc2Match && pc1Match[1] && pc2Match[1]) {
      return {
        referencia: `${pc1Match[1].trim()}${pc2Match[1].trim()}`,
        direccion: ldtMatch ? ldtMatch[1].trim() : '',
        latitud: lat,
        longitud: lon,
        distancia_m: 0.0,
        error: ''
      };
    }

    // Fallback: Proximidad
    const urlDist = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR_Distancia?SRS=EPSG:4326&Coordenada_X=${lon}&Coordenada_Y=${lat}`;
    const respDist = await fetch(urlDist);
    if (respDist.ok) {
      const xmlDist = await respDist.text();
      const pcdMatch = xmlDist.match(/<pcd>([\s\S]*?)<\/pcd>/i);
      if (pcdMatch) {
        const block = pcdMatch[1];
        const pc1 = (block.match(/<pc1>(.*?)<\/pc1>/i) || [])[1] || '';
        const pc2 = (block.match(/<pc2>(.*?)<\/pc2>/i) || [])[1] || '';
        const ldt = (block.match(/<ldt>(.*?)<\/ldt>/i) || [])[1] || '';
        const disStr = (block.match(/<dis>(.*?)<\/dis>/i) || [])[1] || '0';
        const dis = parseFloat(disStr.trim()) || 0;
        if (pc1 && pc2 && dis <= 60.0) {
          return {
            referencia: `${pc1.trim()}${pc2.trim()}`,
            direccion: ldt.trim(),
            latitud: lat,
            longitud: lon,
            distancia_m: dis,
            error: ''
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

function formatTitle(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s|\/)\S/g, a => a.toUpperCase());
}

function formatPercent(val, maxDecimals = 2) {
  if (!val) return '';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  if (isNaN(num)) return String(val);
  return num.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
}
