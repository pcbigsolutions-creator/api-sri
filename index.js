require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors'); 

// 1. CONFIGURACIÓN DE LA APP
const app = express(); 

// 2. PERMISOS Y MIDDLEWARES (Fundamental para el buscador web)
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

// 6. RUTAS DE LA API (CORREGIDA CON ASYNC/AWAIT)
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => {
    const { ruc } = req.params;

    try {
        // 1. Revisar si ya está en tu Base de Datos (Atlas)
        const cache = await Consulta.findOne({ ruc });
        if (cache) return res.json({ source: 'CACHE_LOCAL', data: cache.data });

        // 2. Consultar al SRI Real (Endpoint público oficial)
        // 2. Consultar al SRI Real
        const url = `https://srienlinea.sri.gob.ec/sri-en-linea/rest/ConsultasGenerales/obtenerPorRuc?numeroRuc=${ruc}`;
        
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                },
                timeout: 5000 // Si el SRI no responde en 5 segundos, salta error
            });

            if (!response.data || !response.data.razonSocial) {
                return res.status(404).json({ error: 'El RUC no existe en los registros oficiales.' });
            }

            const nuevaData = {
                ruc: ruc,
                razonSocial: response.data.razonSocial,
                estado: response.data.estadoContribuyente || "ACTIVO",
                mensaje: "Datos reales del SRI"
            };

            await new Consulta({ ruc, data: nuevaData }).save();
            res.json({ source: 'SRI_LIVE', data: nuevaData });

        } catch (axiosError) {
            // Esto nos dirá en los LOGS de Render si es un bloqueo o un error de red
            console.error("Detalle del error:", axiosError.response ? axiosError.response.status : axiosError.message);
            return res.status(500).json({ 
                error: 'El SRI bloqueó la conexión o está fuera de servicio.',
                detalle: axiosError.message 
            });
        }

        // Estructurar los datos reales
        const nuevaData = {
            ruc: ruc,
            razonSocial: response.data.razonSocial,
            estado: response.data.estadoContribuyente || "ACTIVO",
            mensaje: "Datos reales del SRI obtenidos por BIG SOLUTIONS"
        };

        // 3. Guardar en tu Base de Datos para futuras consultas
        const nuevaConsulta = new Consulta({ ruc, data: nuevaData });
        await nuevaConsulta.save();

        res.json({ source: 'SRI_LIVE', data: nuevaData });

    } catch (error) {
        console.error("Error en consulta:", error.message);
        res.status(500).json({ error: 'El SRI no responde. Intente más tarde.' });
    }
});

// Ruta para crear usuarios (API Keys)
app.post('/crear-usuario', async (req, res) => {
    try {
        const { nombre, consultas } = req.body;
        const apiKey = Math.random().toString(36).substring(2, 12);
        
        const nuevoUsuario = new User({
            apiKey,
            nombre,
            consultasRestantes: consultas || 50
        });

        await nuevoUsuario.save();
        res.json({ mensaje: 'Usuario creado con éxito', apiKey });
    } catch (error) {
        res.status(500).json({ error: 'No se pudo crear el usuario' });
    }
});

// 7. ENCENDER EL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API de BIG SOLUTIONS corriendo en puerto ${PORT}`);
});