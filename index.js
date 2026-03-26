require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors'); 

const app = express(); 
app.use(express.json());
app.use(cors()); 

// 1. CONEXIÓN A MONGODB ATLAS
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch(err => console.log("❌ Error Mongo:", err));

// 2. MODELOS
const Consulta = mongoose.model('Consulta', new mongoose.Schema({
    ruc: String,
    data: Object,
    fecha: { type: Date, default: Date.now }
}));

const User = mongoose.model('User', new mongoose.Schema({
    apiKey: String,
    nombre: String
}));

// 3. MIDDLEWARE SEGURIDAD
const validarApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const user = await User.findOne({ apiKey });
    if (!user) return res.status(403).json({ error: 'API KEY inválida' });
    next();
};

// 4. RUTA DE CONSULTA PROFESIONAL
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => {
    const { ruc } = req.params;

    try {
        // Buscar en caché local primero
        const cache = await Consulta.findOne({ ruc });
        if (cache) return res.json({ source: 'LOCAL', data: cache.data });

        // Intentar consulta real al SRI vía Proxy
        const urlSRI = `https://srienlinea.sri.gob.ec/sri-en-linea/rest/Persona/obtenerPorRuc?numeroRuc=${ruc}`;
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(urlSRI)}`;
        
        const proxyResponse = await axios.get(proxyUrl, { timeout: 15000 });
        const contents = JSON.parse(proxyResponse.data.contents);

        if (contents && (contents.razonSocial || contents.nombreCompleto)) {
            const nuevaData = {
                ruc: ruc,
                razonSocial: contents.razonSocial || contents.nombreCompleto,
                estado: contents.estadoPersona || "ACTIVO"
            };
            await new Consulta({ ruc, data: nuevaData }).save();
            return res.json({ source: 'SRI', data: nuevaData });
        }

        res.status(404).json({ error: 'RUC no encontrado en los registros oficiales.' });

    } catch (error) {
        res.status(500).json({ error: 'Servicio del SRI temporalmente no disponible.' });
    }
});

// 🔥 RUTA SECRETA PARA ELIMINAR TODA LA CACHÉ
app.get('/admin/clear-cache', async (req, res) => {
    try {
        await Consulta.deleteMany({});
        res.send("<h1>Caché eliminada</h1><p>La base de datos de consultas está limpia.</p>");
    } catch (error) {
        res.status(500).send("Error al limpiar");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));