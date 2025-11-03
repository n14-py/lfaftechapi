const axios = require('axios');
const Radio = require('../models/radio');
const { generateRadioDescription } = require('../utils/bedrockClient');

// --- Configuración (igual que antes) ---
const BASE_URL = 'https://fi1.api.radio-browser.info/json';
const PAISES_LATAM = [
    "AR", "BO", "BR", "CL", "CO", "CR", "CU", "EC", "SV", 
    "GT", "HN", "MX", "NI", "PA", "PY", "PE", "DO", "UY", "VE"
];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =========================================================================
// FUNCIÓN 1: Sincronizar los datos básicos de las radios (SIN CAMBIOS)
// =========================================================================
exports.syncRadios = async (req, res) => {
    console.log(`Iniciando sincronización de radios para ${PAISES_LATAM.length} países...`);
    
    let totalRadiosSincronizadas = 0;
    let erroresFetch = [];
    let operations = []; 

    try {
        for (const paisCode of PAISES_LATAM) {
            try {
                const url = `${BASE_URL}/stations/search`; 
                const response = await axios.get(url, {
                    params: { countrycode: paisCode, hidebroken: true, limit: 500 }
                });
                
                const radios = response.data;
                console.log(`-> [${paisCode}] Encontradas ${radios.length} estaciones.`);

                for (const station of radios) {
                    if (!station.url_resolved || !station.name) continue;
                    operations.push({
                        updateOne: {
                            filter: { uuid: station.stationuuid },
                            update: {
                                $set: {
                                    uuid: station.stationuuid,
                                    nombre: station.name,
                                    pais_code: station.countrycode.toUpperCase(),
                                    pais: station.country,
                                    generos: station.tags,
                                    logo: station.favicon || null,
                                    stream_url: station.url_resolved,
                                    popularidad: station.votes 
                                }
                            },
                            upsert: true 
                        }
                    });
                }
            } catch (error) {
                console.error(`Error al buscar radios de [${paisCode}]: ${error.message}`);
                erroresFetch.push(paisCode);
            }
            await sleep(500);
        }

        console.log(`...Guardando ${operations.length} operaciones en MongoDB...`);
        let totalArticulosNuevos = 0;
        let totalArticulosActualizados = 0;

        if (operations.length > 0) {
            const result = await Radio.bulkWrite(operations);
            totalArticulosNuevos = result.upsertedCount;
            totalArticulosActualizados = result.modifiedCount;
            totalRadiosSincronizadas = totalArticulosNuevos + totalArticulosActualizados;
        }

        console.log("¡Sincronización de radios completada!");
        
        res.json({ 
            message: "Sincronización de radios completada.",
            reporte: {
                totalRadiosEncontradas: operations.length,
                radiosNuevasGuardadas: totalArticulosNuevos,
                radiosActualizadas: totalArticulosActualizados,
                totalRadiosEnDB: totalRadiosSincronizadas,
                paisesConError: erroresFetch
            }
        });

    } catch (error) {
        console.error("Error catastrófico en syncRadios:", error.message);
        res.status(500).json({ error: "Error al sincronizar radios." });
    }
};


// =========================================================================
// FUNCIÓN 2: Iniciar el trabajo pesado de IA (Lógica Rápida)
// =========================================================================

/**
 * [PRIVADO] Inicia el trabajo de IA en segundo plano.
 */
exports.syncRadioAIDescriptions = async (req, res) => {
    // 1. Responde al usuario INMEDIATAMENTE
    res.json({
        message: "¡Trabajo iniciado! Procesando todas las radios en segundo plano (Modo Lento y Seguro). Revisa los logs de Render."
    });

    // 2. Llama a la función real sin 'await'
    _runFullAISync(); 
};

/**
 * Esta función NO se exporta. Es el "trabajador" interno.
 * ¡ESTA ES LA VERSIÓN SÚPER SEGURA!
 */
async function _runFullAISync() {
    
    // --- ¡¡AQUÍ ESTÁ EL CAMBIO!! ---
    // Bajamos de 5 a 1. Súper lento, pero súper seguro.
    const LIMITE_LOTE = 1; 
    // ---------------------------------
    
    let lotesProcesados = 0;
    let radiosProcesadasExito = 0;
    let seguirProcesando = true;

    console.log(`--- INICIO DE TRABAJO PESADO DE IA (Lotes de ${LIMITE_LOTE}) ---`);

    while (seguirProcesando) {
        lotesProcesados++;
        
        try {
            // 1. Buscar el siguiente lote
            const radiosParaProcesar = await Radio.find({
                $or: [
                    { descripcionGenerada: { $exists: false } },
                    { descripcionGenerada: null },
                    { descripcionGenerada: "" }
                ]
            }).limit(LIMITE_LOTE);

            if (radiosParaProcesar.length === 0) {
                console.log("--- ¡TRABAJO COMPLETADO! No hay más radios que procesar. ---");
                seguirProcesando = false;
                break;
            }

            console.log(`[Lote #${lotesProcesados}] Iniciando... Procesando ${radiosParaProcesar.length} radios...`);

            // 2. Mapeamos cada radio a una promesa de IA
            const promesasDeIA = radiosParaProcesar.map(async (radio) => {
                try {
                    const descripcionSEO = await generateRadioDescription(radio);
                    
                    if (descripcionSEO) {
                        radio.descripcionGenerada = descripcionSEO;
                        await radio.save();
                        return { status: 'exito', nombre: radio.nombre };
                    } else {
                        return { status: 'fallo', nombre: radio.nombre };
                    }
                } catch (e) {
                    console.error(`Error procesando ${radio.nombre}: ${e.message}`);
                    return { status: 'fallo', nombre: radio.nombre };
                }
            });

            // 3. Esperar que el lote de IA termine
            const resultados = await Promise.all(promesasDeIA);

            // 4. Contar y reportar
            const exitos = resultados.filter(r => r.status === 'exito').length;
            const fallos = resultados.filter(r => r.status === 'fallo').length;
            radiosProcesadasExito += exitos;

            console.log(`[Lote #${lotesProcesados}] Completado. (Éxito: ${exitos}, Fallos: ${fallos}). Total de radios procesadas: ${radiosProcesadasExito}`);
            
            // Pausa de 3 segundos entre CADA radio.
            await sleep(3000); 

        } catch (error) {
            console.error(`Error catastrófico en el Lote #${lotesProcesados}:`, error.message);
            seguirProcesando = false;
        }
    }
}