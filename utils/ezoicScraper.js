// Archivo: lfaftechapi/utils/ezoicScraper.js
// ¡NUEVO ARCHIVO! Este es el "Robot-Scraper"
// ------------------------------------------------
const axios = require('axios');
const cheerio = require('cheerio');
const Article = require('../models/article');

// ¡IMPORTANTE! Esta es la URL de tu canal de videos PÚBLICO en Ezoic (Humix).
// DEBES cambiar esto en tu .env por tu URL real.
// Ezoic la crea por ti, usualmente es algo como 'https.tusitio.com/video/'
const EZOIC_VIDEO_CHANNEL_URL = process.env.EZOIC_VIDEO_CHANNEL_URL;

/**
 * [INTERNO] Esta es la función principal del robot.
 * Se conectará a tu canal de Ezoic y buscará videos.
 */
async function scrapeEzoicChannel() {
    if (!EZOIC_VIDEO_CHANNEL_URL) {
        console.warn('[EzoicScraper] Omitiendo. Falta EZOIC_VIDEO_CHANNEL_URL en el .env');
        return;
    }

    let ezoicVideoMap;
    try {
        // 1. Descargar el HTML de tu canal de videos público de Ezoic
        console.log(`[EzoicScraper] Descargando HTML de: ${EZOIC_VIDEO_CHANNEL_URL}`);
        const { data } = await axios.get(EZOIC_VIDEO_CHANNEL_URL, {
            // Simulamos ser un navegador para evitar bloqueos
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // 2. Cargar el HTML en Cheerio (como jQuery)
        const $ = cheerio.load(data);

        // 3. Crear un "Mapa" de todos los videos en la página
        // Ezoic (Humix) suele envolver cada video en un <article> o <div> con un enlace <a>
        // y un título <h3>. Esto puede cambiar, ¡es la parte más frágil!
        ezoicVideoMap = new Map();

        // ATENCIÓN: Esta consulta ('a.humix-video-link' o similar) es un EJEMPLO.
        // Tendrás que inspeccionar tu página de Humix y ver qué selector CSS
        // contiene el enlace (<a>) y el título (<h3> o <div>) de tus videos.
        // Este es el selector más probable que usan:
        $('div.humix-read-more-container a[href*="/video/"]').each((i, el) => {
            const linkElement = $(el);
            const videoPageUrl = linkElement.attr('href'); // La URL a la PÁGINA del video
            const titleElement = linkElement.find('h3'); // O el selector de tu título
            
            const title = titleElement.text().trim();

            if (videoPageUrl && title) {
                // Chequeo de seguridad: Ezoic puede poner la URL completa o relativa
                const fullUrl = videoPageUrl.startsWith('http') ? videoPageUrl : `https://${new URL(EZOIC_VIDEO_CHANNEL_URL).hostname}${videoPageUrl}`;
                
                console.log(`[EzoicScraper] Encontrado en Humix: "${title}" -> ${fullUrl}`);
                ezoicVideoMap.set(title, fullUrl);
            }
        });

        if (ezoicVideoMap.size === 0) {
            console.warn('[EzoicScraper] No se encontraron videos en la página del canal. ¿El selector de Cheerio es correcto?');
            return;
        }

    } catch (error) {
        console.error(`[EzoicScraper] Error al descargar o "scrapear" el canal de Ezoic: ${error.message}`);
        return;
    }

    // 4. Buscar en nuestra DB artículos que estén "pendientes de Ezoic"
    const articlesToUpdate = await Article.find({
        videoProcessingStatus: 'pending_ezoic_import'
    });

    if (articlesToUpdate.length === 0) {
        console.log('[EzoicScraper] No hay artículos pendientes de importar.');
        return;
    }

    console.log(`[EzoicScraper] Buscando ${articlesToUpdate.length} artículos pendientes...`);
    let updatedCount = 0;

    // 5. Cruzar los datos: (Nuestra DB vs. Scraper de Ezoic)
    for (const article of articlesToUpdate) {
        // Limpiamos el título de nuestra DB para que coincida con el de Ezoic
        const cleanArticleTitle = article.titulo.trim();

        // ¡MAGIA! Buscamos el título en el "Mapa" que creamos
        if (ezoicVideoMap.has(cleanArticleTitle)) {
            const ezoicUrl = ezoicVideoMap.get(cleanArticleTitle);
            
            // ¡LO ENCONTRAMOS!
            // Ahora, Ezoic no nos da el <iframe>, pero nos da la URL de la PÁGINA.
            // El truco es convertir esa URL de PÁGINA en una URL de EMBED.
            // Por ejemplo:
            // Página: .../video/mi-video-123
            // Embed:  .../video/e-123 (Esto es un ejemplo, debes encontrar el patrón)

            // Por ahora, guardaremos la URL de la PÁGINA.
            // ¡MEJOR AÚN! El iframe de Ezoic suele ser la misma URL de la página.
            // Lo probaremos así:
            
            article.ezoicVideoUrl = ezoicUrl; // Guardamos la URL de la página
            article.videoProcessingStatus = 'complete'; // ¡Marcamos como COMPLETO!
            
            await article.save();
            console.log(`[EzoicScraper] ¡ÉXITO! Artículo "${article.titulo}" actualizado con URL de Ezoic.`);
            updatedCount++;
        } else {
             console.log(`[EzoicScraper] Artículo "${cleanArticleTitle}" aún no encontrado en Ezoic.`);
        }
    }

    console.log(`[EzoicScraper] Tarea finalizada. ${updatedCount} artículos actualizados.`);
}

// Exportamos la función para que server.js pueda llamarla
module.exports = {
    runEzoicScraperTask
};