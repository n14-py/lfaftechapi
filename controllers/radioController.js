const Radio = require('../models/radio'); // Importamos nuestro modelo de la base de datos

/**
 * [PÚBLICO] Buscar estaciones por País, Género o Texto
 * (Ahora combina query Y pais, y acepta excludeUuid para RECOMENDACIONES)
 */
exports.searchRadios = async (req, res) => {
    try {
        const { pais, genero, query, limite, excludeUuid } = req.query; // ¡CAMBIO AÑADIDO: excludeUuid!

        let filtro = {}; // Filtro de MongoDB
        let sort = { popularidad: -1 }; 
        let projection = {};
        const limiteNum = parseInt(limite) || 100;

        // 1. FILTRO DE EXCLUSIÓN (Para recomendaciones)
        if (excludeUuid) {
            filtro.uuid = { $ne: excludeUuid }; // Excluye el UUID actual
        }

        // 2. Siempre filtramos por país si se proporciona
        if (pais) {
            filtro.pais_code = pais.toUpperCase();
        }

        if (query) {
            // 3. Si hay 'query', añadimos la búsqueda de texto
            filtro.$text = { $search: query };
            projection = { score: { $meta: "textScore" } }; 
            sort = { score: { $meta: "textScore" } }; 
        } else if (genero) {
            // 4. Si no hay 'query' pero hay 'genero'
            filtro.generos = new RegExp(genero, 'i');
        } 
        
        // 5. Lógica de aleatoriedad para Recomendaciones (sin query)
        if (!query && (pais || genero)) {
            const totalCount = await Radio.countDocuments(filtro);
            // Salto aleatorio para mostrar diferentes radios
            const randomSkip = totalCount > 10 ? Math.floor(Math.random() * (totalCount - 10)) : 0;
            
             const radios = await Radio.find(filtro, projection)
                                  .sort(sort)
                                  .skip(randomSkip) // Salto aleatorio para variedad
                                  .limit(limiteNum);

             res.json(radios);
             return; 
        }
        
        // Caso normal (query o populares)
        const radios = await Radio.find(filtro, projection)
                                  .sort(sort)
                                  .limit(limiteNum);
        
        res.json(radios);

    } catch (error) {
        console.error("Error en searchRadios (DB):", error.message);
        res.status(500).json({ error: "Error al buscar estaciones." });
    }
};

/**
 * [PÚBLICO] Obtener la lista de Países disponibles
 * (Lee de nuestra DB)
 */
exports.getCountries = async (req, res) => {
    try {
        const paises = await Radio.aggregate([
            { $group: { 
                _id: { code: "$pais_code", name: "$pais" } 
            }},
            { $project: {
                _id: 0,
                code: "$_id.code",
                name: "$_id.name"
            }},
            { $sort: { name: 1 } }
        ]);
        
        res.json(paises);

    } catch (error) {
        console.error("Error en getCountries (DB):", error.message);
        res.status(500).json({ error: "Error al obtener países." });
    }
};

/**
 * [PÚBLICO] Obtener la lista de Géneros (Tags) más populares
 * (Lee de nuestra DB)
 */
exports.getTags = async (req, res) => {
    try {
        const pipeline = [
            { $project: {
                generos: { $split: ["$generos", ","] }
            }},
            { $unwind: "$generos" },
            { $match: { 
                generos: { $exists: true, $ne: "", $ne: null, $regex: /.{2,}/ } 
            }},
            { $group: {
                _id: "$generos",
                count: { $sum: 1 }
            }},
            { $sort: { count: -1 } },
            { $limit: 100 },
            { $project: {
                _id: 0,
                name: "$_id",
                stationcount: "$count"
            }}
        ];
        
        const tags = await Radio.aggregate(pipeline);
        res.json(tags);

    } catch (error) {
        console.error("Error en getTags (DB):", error.message);
        res.status(500).json({ error: "Error al obtener géneros." });
    }
};

/**
 * [PÚBLICO] Obtener UNA SOLA radio por su UUID
 * (Para la página de "Más Info")
 */
exports.getRadioByUuid = async (req, res) => {
    try {
        const { uuid } = req.params; // Obtenemos el ID de la URL

        if (!uuid) {
            return res.status(400).json({ error: "Se requiere un UUID de estación." });
        }
        
        const radio = await Radio.findOne({ uuid: uuid });

        if (!radio) {
            return res.status(404).json({ error: "Estación no encontrada." });
        }
        
        res.json(radio); // Devolvemos la info de esa radio

    } catch (error) {
        console.error("Error en getRadioByUuid (DB):", error.message);
        res.status(500).json({ error: "Error al buscar la estación." });
    }
};