const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. CONFIGURACIÓN DEL IMPERIO DE CANALES
// ============================================================================
const CONFIGURACION_CANALES = [
    { id: 0, archivoToken: 'token_0.json', nombreHablad: "Noticias Lat" },
    { id: 1, archivoToken: 'token_1.json', nombreHablad: "Noticias Lat Última Hora" },
    { id: 2, archivoToken: 'token_2.json', nombreHablad: "Noticias Lat Ahora" }, 
    { id: 3, archivoToken: 'token_3.json', nombreHablad: "Noticias Lat Hoy" }        
];

// ============================================================================
// 2. MOTOR DE TIEMPO (CALCULADORA DE FECHAS DINÁMICAS)
// ============================================================================
function calcularFechas(rangoTiempo) {
    const hoy = new Date();
    let startDate = new Date();
    let endDate = new Date();
    let contextoTiempo = ""; // Frase que dirá Alexa

    switch (rangoTiempo) {
        case 'ayer':
            // Intenta traer estrictamente lo de ayer
            startDate.setDate(hoy.getDate() - 1);
            endDate.setDate(hoy.getDate() - 1);
            contextoTiempo = "el día de ayer";
            break;
        case '28dias':
            startDate.setDate(hoy.getDate() - 28);
            endDate.setDate(hoy.getDate() - 1);
            contextoTiempo = "los últimos veintiocho días";
            break;
        case 'mes':
            // Desde el día 1 del mes actual hasta ayer
            startDate.setDate(1); 
            endDate.setDate(hoy.getDate() - 1);
            const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
            contextoTiempo = `lo que va del mes de ${meses[hoy.getMonth()]}`;
            break;
        case '7dias':
        default:
            // Rango seguro de 7 días
            startDate.setDate(hoy.getDate() - 8);
            endDate.setDate(hoy.getDate() - 2);
            contextoTiempo = "los últimos siete días consolidados";
            break;
    }

    return {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
        texto: contextoTiempo
    };
}

// ============================================================================
// 3. EXTRACCIÓN DE DATOS PROFUNDA (CON TRY/CATCH POR CAPAS)
// ============================================================================
async function getChannelData(config, fechas) {
    const tokenPath = path.join(__dirname, '..', 'tokens', config.archivoToken);
    
    const result = { 
        canalId: config.id,
        canalNombre: config.nombreHablad, 
        rendimiento: { vistas: 0, ingresos: 0, likes: 0, comentarios: 0 },
        historico: { suscriptores: 0, videosSubidos: 0, vistasTotales: 0 },
        estado: "OK"
    };

    if (!fs.existsSync(tokenPath)) {
        result.estado = "SIN_TOKEN";
        return result;
    }

    try {
        const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        const oauth2Client = new google.auth.OAuth2(tokenData.client_id, tokenData.client_secret);
        oauth2Client.setCredentials({ refresh_token: tokenData.refresh_token });

        const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });
        const youtubeData = google.youtube({ version: 'v3', auth: oauth2Client });

        // --- EXTRACCIÓN A: ESTADÍSTICAS DEL CANAL (SUSCRIPTORES) ---
        try {
            const dataResponse = await youtubeData.channels.list({ part: 'statistics', mine: true });
            if (dataResponse.data.items && dataResponse.data.items.length > 0) {
                const stats = dataResponse.data.items[0].statistics;
                result.historico.suscriptores = parseInt(stats.subscriberCount) || 0;
                result.historico.vistasTotales = parseInt(stats.viewCount) || 0;
                result.historico.videosSubidos = parseInt(stats.videoCount) || 0;
            }
        } catch (subsError) {
            console.error(`❌ [Canal ${config.id}] Error obteniendo perfil:`, subsError.message);
        }

        // --- EXTRACCIÓN B: ANALYTICS (VISTAS Y DINERO DEL RANGO SOLICITADO) ---
        try {
            const analyticsResponse = await youtubeAnalytics.reports.query({
                ids: 'channel==MINE',
                startDate: fechas.start,
                endDate: fechas.end,
                metrics: 'views,estimatedRevenue,likes,comments'
            });

            if (analyticsResponse.data.rows && analyticsResponse.data.rows.length > 0) {
                result.rendimiento.vistas = parseInt(analyticsResponse.data.rows[0][0]) || 0;
                result.rendimiento.ingresos = parseFloat(analyticsResponse.data.rows[0][1]) || 0;
                result.rendimiento.likes = parseInt(analyticsResponse.data.rows[0][2]) || 0;
                result.rendimiento.comentarios = parseInt(analyticsResponse.data.rows[0][3]) || 0;
            }
        } catch (apiError) {
            // Manejo del error de monetización o permisos
            if (apiError.message.includes('Insufficient permission') || apiError.code === 403) {
                result.estado = "NO_MONETIZADO";
                const fallbackResponse = await youtubeAnalytics.reports.query({
                    ids: 'channel==MINE',
                    startDate: fechas.start,
                    endDate: fechas.end,
                    metrics: 'views,likes,comments'
                });

                if (fallbackResponse.data.rows && fallbackResponse.data.rows.length > 0) {
                    result.rendimiento.vistas = parseInt(fallbackResponse.data.rows[0][0]) || 0;
                    result.rendimiento.likes = parseInt(fallbackResponse.data.rows[0][1]) || 0;
                    result.rendimiento.comentarios = parseInt(fallbackResponse.data.rows[0][2]) || 0;
                    result.rendimiento.ingresos = 0; 
                }
            } else {
                result.estado = "ERROR_API";
                console.error(`❌ [Canal ${config.id}] Error en Analytics:`, apiError.message);
            }
        }

        return result;

    } catch (error) {
        result.estado = "ERROR_CRITICO";
        console.error(`❌ [Canal ${config.id}] Error Fatal:`, error.message);
        return result;
    }
}

// ============================================================================
// 4. EL CEREBRO DE ALEXA (NLG - Generación de Lenguaje Natural)
// ============================================================================
exports.getStatsForAlexa = async (req, res) => {
    try {
        // Parámetros de la URL o Body
        const tipoConsulta = (req.query.consulta || req.body.consulta || 'general').toLowerCase();
        const canalId = parseInt(req.query.canal_id || req.body.canal_id || -1); // -1 significa "Todos los canales"
        const rangoTiempoStr = (req.query.tiempo || req.body.tiempo || '7dias').toLowerCase();

        // Calculamos las fechas exactas
        const fechas = calcularFechas(rangoTiempoStr);
        let speechText = "";
        
        // Ejecutamos las llamadas en paralelo para máxima velocidad
        const promesas = CONFIGURACION_CANALES.map(config => getChannelData(config, fechas));
        const resultados = await Promise.all(promesas);

        // Variables acumuladoras
        let totalViews = 0, totalRevenue = 0, totalLikes = 0, totalComments = 0;
        let totalSubscribers = 0, totalVideos = 0, canalesActivos = 0;
        let canalTop = null, maxVistas = -1;

        resultados.forEach(canal => {
            if (canal.estado !== "SIN_TOKEN" && canal.estado !== "ERROR_CRITICO") {
                canalesActivos++;
                totalViews += canal.rendimiento.vistas;
                totalRevenue += canal.rendimiento.ingresos;
                totalLikes += canal.rendimiento.likes;
                totalComments += canal.rendimiento.comentarios;
                totalSubscribers += canal.historico.suscriptores;
                totalVideos += canal.historico.videosSubidos;

                if (canal.rendimiento.vistas > maxVistas) {
                    maxVistas = canal.rendimiento.vistas;
                    canalTop = canal;
                }
            }
        });

        // =========================================================
        // LÓGICA DE RESPUESTAS HABLADAS (Súper Personalizadas)
        // =========================================================
        
        // CASO 1: Consulta de un CANAL ESPECÍFICO
        if (canalId >= 0 && canalId < 4) {
            const c = resultados.find(x => x.canalId === canalId);
            if (!c || c.estado === "SIN_TOKEN") {
                speechText = `Lo siento, no tengo acceso al canal ${CONFIGURACION_CANALES[canalId].nombreHablad} en este momento.`;
            } else {
                // Inteligencia para el dinero retrasado de "ayer"
                let txtIngresos = `y generó ${c.rendimiento.ingresos.toFixed(2)} dólares.`;
                if (rangoTiempoStr === 'ayer' && c.rendimiento.ingresos === 0 && c.rendimiento.vistas > 0 && c.estado !== "NO_MONETIZADO") {
                    txtIngresos = `Aunque YouTube aún está calculando las ganancias exactas de ayer.`;
                } else if (c.estado === "NO_MONETIZADO") {
                    txtIngresos = `El canal aún no registra ingresos monetarios oficiales.`;
                }

                if (tipoConsulta === 'suscriptores') {
                    speechText = `El canal ${c.canalNombre} cuenta actualmente con ${c.historico.suscriptores} suscriptores y tiene ${c.historico.videosSubidos} videos en su catálogo.`;
                } else if (tipoConsulta === 'ingresos') {
                    speechText = `Para el canal ${c.canalNombre}, en ${fechas.texto}, las ganancias estimadas son de ${c.rendimiento.ingresos.toFixed(2)} dólares.`;
                } else {
                    speechText = `Reporte detallado de ${c.canalNombre}: En ${fechas.texto}, el canal obtuvo ${c.rendimiento.vistas} reproducciones y ${c.rendimiento.likes} me gusta. ${txtIngresos} Su comunidad actual es de ${c.historico.suscriptores} suscriptores.`;
                }
            }
        } 
        
        // CASO 2: Consulta GLOBAL (Toda la red)
        else {
            let txtIngresosGlobal = `generando un total de ${totalRevenue.toFixed(2)} dólares.`;
            
            // Inteligencia global para "ayer"
            if (rangoTiempoStr === 'ayer' && totalRevenue === 0 && totalViews > 0) {
                txtIngresosGlobal = `Los ingresos de ayer aún se están procesando en los servidores de YouTube, pero las vistas fueron excelentes.`;
            }

            switch (tipoConsulta) {
                case 'top':
                    if (canalTop) {
                        speechText = `El canal rey durante ${fechas.texto} fue ${canalTop.canalNombre}, liderando la red con ${canalTop.rendimiento.vistas} vistas.`;
                    } else {
                        speechText = `No hay datos suficientes para determinar el mejor canal en ${fechas.texto}.`;
                    }
                    break;

                case 'ingresos':
                    if (rangoTiempoStr === 'ayer' && totalRevenue === 0) {
                        speechText = `Los reportes financieros del día de ayer todavía están siendo procesados por YouTube. Intenta preguntar de nuevo más tarde o consulta los últimos siete días.`;
                    } else {
                        speechText = `Tu imperio ha generado una ganancia combinada de ${totalRevenue.toFixed(2)} dólares durante ${fechas.texto}.`;
                    }
                    break;
                
                case 'vistas':
                    speechText = `El tráfico de tu red es espectacular. En ${fechas.texto}, acumulaste ${totalViews} reproducciones sumando todos tus canales activos.`;
                    break;

                case 'interacciones':
                    speechText = `El compromiso de tu audiencia en ${fechas.texto} incluye ${totalLikes} me gusta y ${totalComments} comentarios en toda la red de noticias.`;
                    break;

                case 'suscriptores':
                    speechText = `El crecimiento es constante. Hoy tu red consolida un total de ${totalSubscribers} suscriptores sumando los ${canalesActivos} canales.`;
                    break;

                case 'general':
                default:
                    speechText = `Resumen ejecutivo de tu red en ${fechas.texto}: Tus ${canalesActivos} canales activos lograron un total de ${totalViews} vistas conjuntas, ${txtIngresosGlobal} A día de hoy, tu imperio informativo cuenta con ${totalSubscribers} suscriptores y un histórico de ${totalVideos} videos publicados.`;
                    break;
            }
        }

        // =========================================================
        // DEVOLVER RESPUESTA EN JSON
        // =========================================================
        res.status(200).json({
            status: 'success',
            speech: speechText,
            rango_analizado: fechas,
            datos_red: {
                metricas_rango: { vistas: totalViews, ingresos: totalRevenue.toFixed(2), likes: totalLikes, comentarios: totalComments },
                metricas_historicas: { suscriptores: totalSubscribers, videos_totales: totalVideos, canales_conectados: canalesActivos }
            },
            desglose_por_canal: resultados
        });

    } catch (error) {
        console.error("❌ Error en Súper Controlador Alexa:", error);
        res.status(500).json({ 
            status: 'error', 
            speech: 'He perdido conexión con el centro de datos de YouTube. Intenta en unos minutos.' 
        });
    }
};