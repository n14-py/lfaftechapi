const mongoose = require('mongoose');
const Article = require('../models/article'); // Importamos el "molde"

/**
 * [PÚBLICO] Obtener LISTA de artículos
 * (Lógica de la ruta GET /api/articles)
 * --- ¡ACTUALIZADO CON FILTRO DE PAÍS Y BÚSQUEDA! ---
 */
exports.getArticles = async (req, res) => {
    try {
        // ¡Ahora también leemos 'query' para la búsqueda!
        const { sitio, categoria, limite, pagina, pais, query } = req.query;
        
        if (!sitio) {
            return res.status(400).json({ error: "El parámetro 'sitio' es obligatorio." });
        }
        
        const limiteNum = parseInt(limite) || 12;
        const paginaNum = parseInt(pagina) || 1;
        const skip = (paginaNum - 1) * limiteNum;
        
        // Definiciones base
        let filtro = { sitio: sitio };
        let sort = { fecha: -1 }; // Ordenar por fecha por defecto
        let projection = {};      // Para el score de búsqueda (relevancia)

        // --- LÓGICA DE FILTRO PRINCIPAL (Búsqueda vs. Categoría/País) ---
        if (query) {
            // 1. LÓGICA DE BÚSQUEDA POR TEXTO (Global)
            filtro.$text = { $search: query };
            sort = { score: { $meta: "textScore" } }; // Ordenar por relevancia
            projection = { score: { $meta: "textScore" } }; // Necesario para ordenar
            
        } else if (pais) {
            // 2. LÓGICA DE FILTRO POR PAÍS (Existente)
            filtro.pais = pais;
        } else {
            // 3. LÓGICA DE FILTRO POR CATEGORÍA (Existente)
            // Nos aseguramos de que sean noticias SIN país (las generales).
            filtro.pais = { $in: [null, undefined] };
            
            if (categoria && categoria !== 'todos') {
                filtro.categoria = categoria;
            }
        }
        // --- FIN DE LA LÓGICA ---

        // Ejecutamos la consulta, aplicando el filtro, proyección (score), orden y paginación
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
 * (Lógica de la ruta GET /api/article/:id)
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
 * (Lógica de la ruta GET /api/articles/recommended)
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
            _id: { $ne: excludeId } // Excluir el artículo que ya se está viendo
        };

        const randomSkip = Math.floor(Math.random() * 20);
        
        const recommended = await Article.find(filtro)
            .sort({ fecha: -1 })
            .skip(randomSkip)
            .limit(4); // Trae 4 recomendados

        res.json(recommended);

    } catch (error) {
        console.error("Error en getRecommendedArticles:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
};