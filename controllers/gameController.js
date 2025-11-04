const Game = require('../models/game'); // El "molde" de Juego que creamos

/**
 * [PÚBLICO] Obtener la lista de juegos (con filtros y búsqueda)
 * Esta es la API principal que llamará tu index.html
 */
exports.getGames = async (req, res) => {
    try {
        const { category, query, limite, pagina } = req.query;

        const limiteNum = parseInt(limite) || 12; // 12 juegos por página
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;

        let filtro = {};
        let sort = { createdAt: -1 }; // Por defecto, los más nuevos primero
        let projection = {};

        // --- Lógica de Filtros ---
        
        // 1. Si hay una BÚSQUEDA de texto
        if (query) {
            filtro.$text = { $search: query };
            sort = { score: { $meta: "textScore" } }; // Ordenar por relevancia
            projection = { score: { $meta: "textScore" } };
        } 
        
        // 2. Si hay un filtro de CATEGORÍA (y no es "todos")
        else if (category && category.toLowerCase() !== 'all') {
            // Hacemos una búsqueda "insensible" a mayúsculas
            filtro.category = { $regex: new RegExp(`^${category}$`, 'i') };
        }

        // --- Fin de la lógica ---

        // Ejecutamos las dos consultas al mismo tiempo para más velocidad
        const [games, total] = await Promise.all([
            Game.find(filtro, projection).sort(sort).skip(skip).limit(limiteNum),
            Game.countDocuments(filtro)
        ]);

        res.json({
            totalJuegos: total,
            totalPaginas: Math.ceil(total / limiteNum),
            paginaActual: paginaNum,
            juegos: games
        });

    } catch (error) {
        console.error("Error en getGames:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

/**
 * [PÚBLICO] Obtener la lista de categorías
 * (Para tu menú de filtros en index.html)
 */
exports.getCategories = async (req, res) => {
    try {
        // Busca todas las categorías distintas, ignora las que sean null o vacías
        const categories = await Game.distinct('category', { 
            category: { $ne: null, $ne: "" } 
        });
        
        // Ordena alfabéticamente
        categories.sort(); 
        
        res.json(categories);
    } catch (error) {
        console.error("Error en getCategories:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

/**
 * [PÚBLICO] Obtener UN solo juego por su SLUG
 * (Para la página de detalle del juego)
 */
exports.getGameBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const game = await Game.findOne({ slug: slug });

        if (!game) {
            return res.status(404).json({ error: "Juego no encontrado." });
        }
        
        // Opcional: Incrementar vistas (tracking de popularidad)
        // game.views += 1;
        // await game.save();

        res.json(game);
    } catch (error) {
        console.error("Error en getGameBySlug:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


/**
 * [PÚBLICO] Generar el Sitemap.xml para los juegos
 * (Similar al de noticias y radios, para el SEO)
 */
exports.getSitemap = async (req, res) => {
    const BASE_URL = 'https://tusinitusineli.com'; // ¡Tu dominio!

    try {
        const games = await Game.find().select('slug updatedAt');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 1. Página Principal (index.html)
        xml += '<url>';
        xml += `<loc>${BASE_URL}/</loc>`;
        xml += '<priority>1.00</priority>';
        xml += '<changefreq>daily</changefreq>';
        xml += '</url>';

        // 2. Páginas Estáticas (las que tienes)
        xml += '<url>';
        xml += `<loc>${BASE_URL}/que-es-tusinitusineli.html</loc>`;
        xml += '<priority>0.80</priority>';
        xml += '<changefreq>monthly</changefreq>';
        xml += '</url>';
        xml += '<url>';
        xml += `<loc>${BASE_URL}/descargar.html</loc>`;
        xml += '<priority>0.70</priority>';
        xml += '<changefreq>monthly</changefreq>';
        xml += '</url>';
        xml += '<url>';
        xml += `<loc>${BASE_URL}/galeria.html</loc>`;
        xml += '<priority>0.70</priority>';
        xml += '<changefreq>monthly</changefreq>';
        xml += '</url>';
        
        // 3. Páginas de Juegos (Dinámicas)
        games.forEach(game => {
            const gameDate = new Date(game.updatedAt).toISOString().split('T')[0];
            xml += '<url>';
            // Aquí definiremos la URL amigable, ej: tusinitusineli.com/juego/bubble-shooter
            xml += `<loc>${BASE_URL}/juego/${game.slug}</loc>`; 
            xml += `<lastmod>${gameDate}</lastmod>`;
            xml += '<changefreq>weekly</changefreq>';
            xml += '<priority>0.90</priority>';
            xml += '</url>';
        });

        xml += '</urlset>';

        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getSitemap (Juegos):", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};