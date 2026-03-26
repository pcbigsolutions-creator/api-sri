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

// 6. RUTA DE CONSULTA CON PROXY (SALTA EL BLOQUEO DE RENDER)
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => {
    const { ruc } = req.params;

    try {
        // 1. Revisar caché en Atlas
        const cache = await Consulta.findOne({ ruc });
        if (cache) return res.json({ source: 'CACHE_LOCAL', data: cache.data });

        // 2. Usar un Proxy para que el SRI no vea que venimos de Render (EE.UU.)
        const urlSRI = `https://srienlinea.sri.gob.ec/sri-en-linea/rest/Persona/obtenerPorRuc?numeroRuc=${ruc}`;
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(urlSRI)}`;
        
        console.log(`Consultando RUC ${ruc} vía Proxy...`);

        const proxyResponse = await axios.get(proxyUrl, { timeout: 10000 });
        
        // El proxy devuelve un string en 'contents', hay que convertirlo a objeto JSON
        const dataReal = JSON.parse(proxyResponse.data.contents);

        if (!dataReal || (!dataReal.razonSocial && !dataReal.nombreCompleto)) {
            return res.status(404).json({ error: 'El RUC no devolvió datos válidos del SRI.' });
        }

        const nombreFinal = dataReal.razonSocial || dataReal.nombreCompleto;

        const nuevaData = {
            ruc: ruc,
            razonSocial: nombreFinal,
            estado: dataReal.estadoPersona || "ACTIVO",
            mensaje: "Consulta exitosa vía Proxy - BIG SOLUTIONS PC"
        };

        // 3. Guardar en BD para no repetir la consulta al Proxy
        await new Consulta({ ruc, data: nuevaData }).save();

        res.json({ source: 'SRI_LIVE_PROXY', data: nuevaData });

    } catch (error) {
        console.error("Error detallado:", error.message);
        res.status(500).json({ 
            error: 'El SRI sigue bloqueando la conexión o el Proxy falló.',
            detalle: error.message 
        });
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
    console.log(`🚀 Sistema de BIG SOLUTIONS PC activo en puerto ${PORT}`);
});