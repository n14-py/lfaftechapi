const axios = require('axios');

// Usamos uno de los servidores recomendados y estables de la red de radio-browser
const BASE_URL = 'https://de1.api.radio-browser.info/json';

/**
 * Limpia los datos de la estación para enviar solo lo que necesitamos
 */
function limpiarEstacion(station) {
    return {
        // Usamos 'stationuuid' como ID único
        uuid: station.stationuuid, 
        nombre: station.name,
        pais_code: station.countrycode, //
        pais: station.country,
        generos: station.tags,
        logo: station.favicon || null, // El logo (puede estar vacío)
        // Esta es la URL de audio que el reproductor usará
        stream_url: station.url_resolved 
    };
}

/**
 * [PÚBLICO] Buscar estaciones por País o Género (Tag)
 */
exports.searchRadios = async (req, res) => {
    try {
        const { pais, genero, limite } = req.query;

        // Si no piden ni país ni género, no sabemos qué buscar
        if (!pais && !genero) {
            return res.status(400).json({ error: "Se requiere un 'pais' (ej: PY) o 'genero' (ej: rock)." });
        }

        const params = {
            limit: limite || 100, // Traer 100 por defecto
            hidebroken: true, // Ocultar radios que sabemos que están caídas
            order: 'clickcount', // Traer las más populares primero
            reverse: true
        };

        let url = `${BASE_URL}/stations/search`; // Endpoint de búsqueda avanzada

        if (pais) {
            params.countrycode = pais; // Buscar por código de país, ej: PY, AR
        }
        if (genero) {
            params.tag = genero; // Buscar por género (tag)
        }

        const response = await axios.get(url, { params });
        
        // Limpiamos los datos antes de enviarlos al frontend
        const radios = response.data.map(limpiarEstacion);
        
        res.json(radios);

    } catch (error) {
        console.error("Error en searchRadios:", error.message);
        res.status(500).json({ error: "Error al buscar estaciones." });
    }
};

/**
 * [PÚBLICO] Obtener la lista de Países disponibles
 */
exports.getCountries = async (req, res) => {
    try {
        const url = `${BASE_URL}/countries`; // Endpoint de países
        const response = await axios.get(url);
        
        // Filtramos solo países de LATAM (basado en nuestros códigos)
        const codigosLatam = ["ar", "bo", "br", "cl", "co", "cr", "cu", "ec", "sv", "gt", "hn", "mx", "ni", "pa", "py", "pe", "do", "uy", "ve"];
        
        const paisesLatam = response.data.filter(pais => 
            codigosLatam.includes(pais.iso_3166_1.toLowerCase())
        );

        res.json(paisesLatam);

    } catch (error) {
        console.error("Error en getCountries:", error.message);
        res.status(500).json({ error: "Error al obtener países." });
    }
};

/**
 * [PÚBLICO] Obtener la lista de Géneros (Tags) más populares
 */
exports.getTags = async (req, res) => {
    try {
        // Pedimos los 100 géneros más populares
        const params = {
            limit: 100,
            orderby: 'stationcount',
            reverse: true
        };
        const url = `${BASE_URL}/tags`; // Endpoint de tags/géneros
        const response = await axios.get(url, { params });
        res.json(response.data);

    } catch (error) {
        console.error("Error en getTags:", error.message);
        res.status(500).json({ error: "Error al obtener géneros." });
    }
};