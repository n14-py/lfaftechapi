const axios = require('axios');
const Radio = require('../models/radio');

// Seguimos usando el servidor de Finlandia (fi1) que es estable
const BASE_URL = 'https://fi1.api.radio-browser.info/json';

// Lista de códigos de países de LATAM que vamos a sincronizar
const PAISES_LATAM = [
    "AR", "BO", "BR", "CL", "CO", "CR", "CU", "EC", "SV", 
    "GT", "HN", "MX", "NI", "PA", "PY", "PE", "DO", "UY", "VE"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * [PRIVADO] Sincronizar todas las radios de LATAM
 */
exports.syncRadios = async (req, res) => {
    console.log(`Iniciando sincronización de radios para ${PAISES_LATAM.length} países...`);
    
    let totalRadiosSincronizadas = 0;
    let erroresFetch = [];
    let operations = []; 

    try {
        for (const paisCode of PAISES_LATAM) {
            try {
                // --- ¡AQUÍ ESTÁ LA CORRECCIÓN! ---
                // En lugar de: /stations/bycountrycode/PY
                // Usamos:     /stations/search?countrycode=PY
                const url = `${BASE_URL}/stations/search`; 
                const response = await axios.get(url, {
                    params: {
                        countrycode: paisCode, //
                        hidebroken: true,
                        limit: 500 // Traer hasta 500 radios por país
                    }
                });
                // --- FIN DE LA CORRECCIÓN ---
                
                const radios = response.data;
                console.log(`-> [${paisCode}] Encontradas ${radios.length} estaciones.`);

                for (const station of radios) {
                    if (!station.url_resolved || !station.name) {
                        continue;
                    }

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
            await sleep(500); // Pequeña pausa
        }

        // 5. Ejecutamos todas las operaciones de guardado
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
        
        // 6. Enviamos el reporte
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