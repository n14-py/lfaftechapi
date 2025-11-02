const Radio = require('../models/radio'); // ¡Importamos nuestro modelo de la base de datos!

/**
 * [PÚBLICO] Buscar estaciones por País, Género o Texto
 * --- ¡ACTUALIZADO! ---
 * --- ¡Ahora busca en NUESTRA base de datos! ---
 */
exports.searchRadios = async (req, res) => {
    try {
        const { pais, genero, query, limite } = req.query;

        let filtro = {}; // Filtro de MongoDB
        let sort = { popularidad: -1 }; // Ordenar por popularidad (votos) por defecto
        let projection = {};
        const limiteNum = parseInt(limite) || 100;

        if (query) {
            // 1. LÓGICA DE BÚSQUEDA POR TEXTO (para el buscador)
            // Busca en los campos 'nombre' y 'generos' (definido en el modelo)
            filtro.$text = { $search: query };
            projection = { score: { $meta: "textScore" } }; 
            sort = { score: { $meta: "textScore" } }; // Ordenar por relevancia de búsqueda

        } else if (pais) {
            // 2. LÓGICA DE FILTRO POR PAÍS
            filtro.pais_code = pais.toUpperCase();
        
        } else if (genero) {
            // 3. LÓGICA DE FILTRO POR GÉNERO (TAG)
            // Busca que el género esté en el string 'generos' (ej: "rock, pop")
            filtro.generos = new RegExp(genero, 'i'); // 'i' = case-insensitive
        
        } else {
            // 4. LÓGICA POR DEFECTO (Populares)
            // No se aplica filtro, solo se ordena por popularidad (ya definido en 'sort')
        }

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
 * --- ¡ACTUALIZADO! ---
 * --- ¡Ahora busca en NUESTRA base de datos! ---
 */
exports.getCountries = async (req, res) => {
    try {
        // Usamos 'aggregate' para obtener los pares únicos de código/nombre de país
        // de las radios que YA tenemos en nuestra base de datos.
        const paises = await Radio.aggregate([
            { $group: { 
                _id: { code: "$pais_code", name: "$pais" } 
            }},
            { $project: {
                _id: 0,
                code: "$_id.code",
                name: "$_id.name"
            }},
            { $sort: { name: 1 } } // Ordenar alfabéticamente
        ]);
        
        res.json(paises);

    } catch (error) {
        console.error("Error en getCountries (DB):", error.message);
        res.status(500).json({ error: "Error al obtener países." });
    }
};

/**
 * [PÚBLICO] Obtener la lista de Géneros (Tags) más populares
 * --- ¡ACTUALIZADO! ---
 * --- ¡Ahora busca en NUESTRA base de datos! ---
 */
exports.getTags = async (req, res) => {
    try {
        // Este es un proceso más complejo:
        // 1. Toma todas las radios.
        // 2. Separa el string "rock,pop,jazz" en un array ["rock", "pop", "jazz"].
        // 3. Agrupa por cada género y cuenta cuántas radios hay.
        // 4. Devuelve los 100 géneros más populares.
        
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