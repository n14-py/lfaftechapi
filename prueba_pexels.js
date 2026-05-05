const axios = require('axios'); // Ya lo tienes en tu package.json[cite: 1]

const PEXELS_API_KEY = 'E7NPKeblGAwd7zgpV6LJcpmV6qZM1CdkYXmJiJUnxmyH9I2LYVIiWyzV';
const terminoBusqueda = 'storm at night';

// Fíjate que le agregamos "&orientation=landscape" para que solo te traiga videos horizontales (16:9)
const url = `https://api.pexels.com/videos/search?query=${terminoBusqueda}&orientation=landscape&per_page=2`;

axios.get(url, {
    headers: {
        'Authorization': PEXELS_API_KEY
    }
})
.then(response => {
    console.log("¡CONEXIÓN EXITOSA! Pexels respondió.");
    console.log("-----------------------------------");
    
    const videos = response.data.videos;
    if(videos.length > 0) {
        // Pexels devuelve varias calidades. Buscamos el link del archivo de video (HD)
        console.log(`Encontrado: ${videos[0].user.name}`);
        console.log(`URL del Video (MP4): ${videos[0].video_files[0].link}`);
    } else {
        console.log("No se encontraron videos para esa búsqueda.");
    }
})
.catch(error => {
    console.error("Fallo la petición:", error.response ? error.response.data : error.message);
});