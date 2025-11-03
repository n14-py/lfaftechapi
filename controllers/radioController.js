const Radio = require('../models/radio'); // Importamos nuestro modelo de la base de datos

/**
 * [PÚBLICO] Buscar estaciones por País, Género o Texto
 * (Ahora devuelve el listado, el total y soporta paginación)
 */
exports.searchRadios = async (req, res) => {
    try {
        const { pais, genero, query, limite, pagina, excludeUuid } = req.query; // Añadimos 'pagina'

        const limiteNum = parseInt(limite) || 20;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;

        let filtro = {}; 
        let sort = { popularidad: -1 }; 
        let projection = {};
        
        // 1. FILTRO DE EXCLUSIÓN
        if (excludeUuid) {
            filtro.uuid = { $ne: excludeUuid };
        }

        // 2. Siempre filtramos por país si se proporciona
        if (pais) {
            filtro.pais_code = pais.toUpperCase();
        }

        if (query) {
            // 3. LÓGICA DE BÚSQUEDA POR TEXTO (para nombre, país o frecuencia)
            filtro.$text = { $search: query };
            projection = { score: { $meta: "textScore" } }; 
            sort = { score: { $meta: "textScore" } }; 
        } else if (genero) {
            // 4. LÓGICA DE GÉNERO
            filtro.generos = new RegExp(genero, 'i');
        } 
        
        // 5. Lógica de aleatoriedad SOLAMENTE para RECOMENDACIONES (cuando excludeUuid está presente y NO hay query)
        let skipRandom = skip;
        if (excludeUuid && !query) {
            const totalCount = await Radio.countDocuments(filtro);
            skipRandom = totalCount > limiteNum ? Math.floor(Math.random() * (totalCount - limiteNum)) : 0;
        } 
        
        // Ejecución de las consultas
        const [radios, total] = await Promise.all([
            Radio.find(filtro, projection)
                .sort(sort)
                .skip(skipRandom) 
                .limit(limiteNum),
            Radio.countDocuments(filtro) // Obtener el total sin limitación
        ]);
        
        // 6. Devolver el resultado en formato de paginación
        res.json({
            totalRadios: total,
            totalPaginas: Math.ceil(total / limiteNum),
            paginaActual: paginaNum,
            radios: radios
        });

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
        const { uuid } = req.params; 

        if (!uuid) {
            return res.status(400).json({ error: "Se requiere un UUID de estación." });
        }
        
        const radio = await Radio.findOne({ uuid: uuid });

        if (!radio) {
            return res.status(404).json({ error: "Estación no encontrada." });
        }
        
        res.json(radio); 

    } catch (error) {
        console.error("Error en getRadioByUuid (DB):", error.message);
        res.status(500).json({ error: "Error al buscar la estación." });
    }
};


// --- ¡NUEVA FUNCIÓN! SITEMAP DINÁMICO ---
/**
 * [PÚBLICO] Generar el Sitemap.xml para las radios.
 */
exports.getRadioSitemap = async (req, res) => {
    // ¡IMPORTANTE! Cambia esto por la URL real de tu sitio web (ej. https://turadio.lat)
    const BASE_URL = 'https://turadio.lat'; 

    try {
        // 1. Obtenemos todos los UUIDs de las radios
        const radios = await Radio.find()
            .select('uuid')
            .lean(); 

        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 2. Añadir Páginas Estáticas
        const staticPages = [
            { loc: '', priority: '1.00', changefreq: 'hourly' }, 
            { loc: 'index.html?filtro=generos', priority: '0.90', changefreq: 'daily' },
            { loc: 'contacto.html', priority: '0.70', changefreq: 'monthly' },
        ];

        staticPages.forEach(page => {
            xml += '<url>';
            xml += `<loc>${BASE_URL}/${page.loc}</loc>`;
            xml += `<priority>${page.priority}</priority>`;
            xml += `<changefreq>${page.changefreq}</changefreq>`;
            xml += '</url>';
        });

        // 3. Añadir todas las páginas de Detalle de Radio (Dinámicas)
        radios.forEach(radio => {
            xml += '<url>';
            // URL del detalle de la radio
            xml += `<loc>${BASE_URL}/index.html?radio=${radio.uuid}</loc>`; 
            xml += '<changefreq>weekly</changefreq>';
            xml += '<priority>0.80</priority>';
            xml += '</url>';
        });

        xml += '</urlset>';

        // 4. Enviar el XML
        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getRadioSitemap:", error);
        res.status(500).json({ error: "Error interno del servidor al generar sitemap." });
    }
};