/**
 * Cloudflare Pages Function: /api/coordenadas
 * 
 * Georreferenciación inversa: Convierte coordenadas GPS WGS84 (latitud, longitud)
 * en la Referencia Catastral (14 caracteres) correspondiente a la parcela.
 */

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const latStr = url.searchParams.get('lat') || '';
  const lonStr = url.searchParams.get('lon') || '';

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=3600'
  };

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) {
    return new Response(JSON.stringify({
      error: 'Debe proporcionar parámetros numéricos válidos para lat y lon.'
    }), { status: 400, headers: corsHeaders });
  }

  try {
    const res = await obtenerRCDeCoordenadas(lat, lon);
    if (res.error) {
      return new Response(JSON.stringify(res), { status: 404, headers: corsHeaders });
    }
    return new Response(JSON.stringify(res), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      error: `Error al consultar coordenadas en Catastro: ${err.message}`
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

    // Fallback: Proximidad (si el punto cae en vía pública o acera)
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
