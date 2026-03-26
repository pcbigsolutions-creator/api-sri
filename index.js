require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors'); 

// 1. CONFIGURACIÓN DE LA APP
const app = express(); 

// 2. PERMISOS Y MIDDLEWARES
app.use(express.json());
app.use(cors()); 

// 3. CONEXIÓN A MONGODB ATLAS
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Servidor conectado a MongoDB Atlas (NUBE)"))
    .catch(err => console.log("❌ Error de conexión a Mongo:", err));

// 4. MODELOS DE DATOS
const consultaSchema = new mongoose.Schema({
    ruc: String,
    data: Object,
    fecha: { type: Date, default: Date.now }
});
const Consulta = mongoose.model('Consulta', consultaSchema);

const userSchema = new mongoose.Schema({
    apiKey: String,
    nombre: String,
    consultasRestantes: Number
});
const User = mongoose.model('User', userSchema);

// 5. MIDDLEWARE DE SEGURIDAD
const validarApiKey = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) return res.status(401).json({ error: 'API KEY requerida' });

        const user = await User.findOne({ apiKey });
        if (!user) return res.status(403).json({ error: 'API KEY inválida' });
        
        req.user = user;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Error de seguridad' });
    }
};

// 6. RUTA DE CONSULTA (VERSION ROBUSTA PARA EL SRI)
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => {
    const { ruc } = req.params;

    try {
        // 1. Revisar caché en Atlas
        const cache = await Consulta.findOne({ ruc });
        if (cache) return res.json({ source: 'CACHE_LOCAL', data: cache.data });

        // 2. Consultar al SRI (Ruta de Persona/obtenerPorRuc es más estable)
        const url = `https://srienlinea.sri.gob.ec/sri-en-linea/rest/Persona/obtenerPorRuc?numeroRuc=${ruc}`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://srienlinea.sri.gob.ec',
                'Referer': 'https://srienlinea.sri.gob.ec/'
            },
            timeout: 8000
        });

        // Verificamos si hay datos reales
        if (!response.data || (!response.data.razonSocial && !response.data.nombreCompleto)) {
            return res.status(404).json({ error: 'RUC no encontrado o SRI bloqueó la conexión.' });
        }

        // Algunos vienen como razonSocial y otros como nombreCompleto
        const nombreFinal = response.data.razonSocial || response.data.nombreCompleto;

        const nuevaData = {
            ruc: ruc,
            razonSocial: nombreFinal,
            estado: response.data.estadoPersona || "ACTIVO",
            mensaje: "Consulta exitosa - BIG SOLUTIONS PC"
        };

        // 3. Guardar en BD para no volver a molestar al SRI con el mismo RUC
        await new Consulta({ ruc, data: nuevaData }).save();

        res.json({ source: 'SRI_LIVE', data: nuevaData });

    } catch (error) {
        console.error("Error en el servidor:", error.message);
        res.status(500).json({ error: 'El SRI no responde. Intente de nuevo en unos segundos.' });
    }
});

// Ruta para crear usuarios
app.post('/crear-usuario', async (req, res) => {
    try {
        const { nombre, consultas } = req.body;
        const apiKey = Math.random().toString(36).substring(2, 12);
        
        const nuevoUsuario = new User({
            apiKey,
            nombre,
            consultasRestantes: consultas || 100
        });

        await nuevoUsuario.save();
        res.json({ mensaje: 'Usuario creado', apiKey });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// 7. ENCENDER EL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de BIG SOLUTIONS activo en puerto ${PORT}`);
});