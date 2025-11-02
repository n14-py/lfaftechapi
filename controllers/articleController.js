const mongoose = require('mongoose');
const Article = require('../models/article');

/**
 * [PÚBLICO] Obtener LISTA de artículos
 * (Lógica de la ruta GET /api/articles)
 * --- ¡ACTUALIZADO CON NUEVA LÓGICA DE FILTRADO! ---
 */
exports.getArticles = async (req, res) => {
    try {
        const { sitio, categoria, limite, pagina, pais, query } = req.query;
        
        if (!sitio) {
            return res.status(400).json({ error: "El parámetro 'sitio' es obligatorio." });
        }
        
        const limiteNum = parseInt(limite) || 12;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;
        
        // Definiciones base
        let filtro = { sitio: sitio };
        let sort = { fecha: -1 }; 
        let projection = {};      

        // --- LÓGICA DE FILTRO PRINCIPAL (Búsqueda vs. País vs. Categoría) ---
        
        if (query) {
            // 1. LÓGICA DE BÚSQUEDA POR TEXTO (Prioridad Máxima)
            filtro.$text = { $search: query };
            sort = { score: { $meta: "textScore" } }; 
            projection = { score: { $meta: "textScore" } }; 
            
        } else if (pais) {
            // 2. LÓGICA DE FILTRO POR PAÍS
            filtro.pais = pais;
            
        } else if (categoria && categoria !== 'todos') {
            // 3. LÓGICA DE FILTRO POR CATEGORÍA (si no es 'todos')
            filtro.categoria = categoria;
            
        } else {
            // 4. LÓGICA POR DEFECTO (categoria='todos' o 'general')
            // No aplica filtro de país o categoría, mostrando todo lo del 'sitio'.
        }
        // --- FIN DE LA LÓGICA ---

        const articles = await Article.find(filtro, projection).sort(sort).skip(skip).limit(limiteNum);
        const total = await Article.countDocuments(filtro);

        res.json({
            totalArticulos: total,
            totalPaginas: Math.ceil(total / limiteNum),
            paginaActual: paginaNum,
            articulos: articles
        });
    } catch (error) {
        console.error("Error en getArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

/**
 * [PÚBLICO] Obtener UN solo artículo por su ID
 * (Sin cambios)
 */
exports.getArticleById = async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) {
            return res.status(400).json({ error: "ID de artículo no válido." });
        }
        
        const article = await Article.findById(articleId);
        if (!article) {
            return res.status(404).json({ error: "Artículo no encontrado." });
        }
        res.json(article);
    } catch (error) {
        console.error("Error en getArticleById:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};

/**
 * [PÚBLICO] Obtener artículos RECOMENDADOS
 * (Sin cambios)
 */
exports.getRecommendedArticles = async (req, res) => {
    try {
        const { sitio, categoria, excludeId } = req.query;
        if (!sitio || !categoria) {
            return res.status(400).json({ error: "Parámetros 'sitio' y 'categoria' son obligatorios." });
        }

        let filtro = { 
            sitio: sitio, 
            categoria: categoria,
            _id: { $ne: excludeId } 
        };

        const randomSkip = Math.floor(Math.random() * 20);
        
        const recommended = await Article.find(filtro)
            .sort({ fecha: -1 })
            .skip(randomSkip)
            .limit(4); 

        res.json(recommended);

    } catch (error) {
        console.error("Error en getRecommendedArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};


// --- ¡¡AQUÍ ESTÁ LA FUNCIÓN QUE FALTABA!! ---

/**
 * [PÚBLICO] Generar el Sitemap.xml
 * (Añadido al final de articleController.js)
 */
exports.getSitemap = async (req, res) => {
    // ¡IMPORTANTE! Cambia esto por la URL real de tu sitio web
    const BASE_URL = 'https://noticias.lat'; // URL del Frontend

    try {
        // 1. Obtenemos todos los artículos de la DB
        const articles = await Article.find({ sitio: 'noticias.lat' }) // Filtra por sitio
            .sort({ fecha: -1 })
            .select('_id fecha');
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 2. Añadir Páginas Estáticas (Homepage, Contacto, etc.)
        const staticPages = [
            { loc: '', priority: '1.00', changefreq: 'daily' }, // Homepage
            { loc: 'sobre-nosotros.html', priority: '0.80', changefreq: 'monthly' },
            { loc: 'contacto.html', priority: '0.80', changefreq: 'monthly' },
            { loc: 'politica-privacidad.html', priority: '0.50', changefreq: 'yearly' },
            { loc: 'terminos.html', priority: '0.50', changefreq: 'yearly' },
        ];

        staticPages.forEach(page => {
            xml += '<url>';
            xml += `<loc>${BASE_URL}/${page.loc}</loc>`;
            xml += `<priority>${page.priority}</priority>`;
            xml += `<changefreq>${page.changefreq}</changefreq>`;
            xml += '</url>';
        });

        // 3. Añadir todos los Artículos (Dinámicos)
        articles.forEach(article => {
            const articleDate = new Date(article.fecha).toISOString().split('T')[0];
            xml += '<url>';
            // URL del artículo en el frontend
            xml += `<loc>${BASE_URL}/articulo.html?id=${article._id}</loc>`; 
            xml += `<lastmod>${articleDate}</lastmod>`;
            xml += '<changefreq>weekly</changefreq>';
            xml += '<priority>0.90</priority>';
            xml += '</url>';
        });

        xml += '</urlset>';

        // 4. Enviar el XML
        res.header('Content-Type', 'application/xml');
        res.send(xml);

    } catch (error) {
        console.error("Error en getSitemap:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};