require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors'); 

// 1. CONFIGURACIÓN DE LA APP
const app = express(); 
app.use(express.json());
app.use(cors()); 

// 2. CONEXIÓN A MONGODB ATLAS
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Servidor conectado a MongoDB Atlas (NUBE)"))
    .catch(err => console.log("❌ Error de conexión a Mongo:", err));

// 3. MODELOS DE DATOS
const Consulta = mongoose.model('Consulta', new mongoose.Schema({
    ruc: String,
    data: Object,
    fecha: { type: Date, default: Date.now }
}));

const User = mongoose.model('User', new mongoose.Schema({
    apiKey: String,
    nombre: String,
    consultasRestantes: Number
}));

// 4. BASE DE DATOS DE EMERGENCIA (Si el SRI bloquea la conexión)
const dbEmergencia = {
    "1790016919001": { razonSocial: "CORPORACION FAVORITA C.A. (SUPERMAXI)", estado: "ACTIVO" },
    "1790011674001": { razonSocial: "BANCO PICHINCHA C.A.", estado: "ACTIVO" },
    "1790053881001": { razonSocial: "EMPRESA ELECTRICA QUITO S.A. (EEQ)", estado: "ACTIVO" },
    "1760004650001": { razonSocial: "CORPORACION ELECTRICA DEL ECUADOR - CELEC EP", estado: "ACTIVO" },
    "1790010937001": { razonSocial: "PRODUBANCO - GRUPO PROMERICA", estado: "ACTIVO" },
    "1791256115001": { razonSocial: "CONSORCIO ECUATORIANO DE TELECOMUNICACIONES (CLARO)", estado: "ACTIVO" },
    "1790713806001": { razonSocial: "OTECEL S.A. (MOVISTAR)", estado: "ACTIVO" },
    "1760013210001": { razonSocial: "CORPORACION NACIONAL DE TELECOMUNICACIONES (CNT EP)", estado: "ACTIVO" }
};

// 5. MIDDLEWARE DE SEGURIDAD
const validarApiKey = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) return res.status(401).json({ error: 'API KEY requerida' });
        const user = await User.findOne({ apiKey });
        if (!user) return res.status(403).json({ error: 'API KEY inválida' });
        next();
    } catch (error) {
        res.status(500).json({ error: 'Error de seguridad' });
    }
};

// 6. RUTA DE CONSULTA HÍBRIDA (SRI + EMERGENCIA)
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => {
    const { ruc } = req.params;

    try {
        // 1. Revisar caché en Atlas
        const cache = await Consulta.findOne({ ruc });
        if (cache) return res.json({ source: 'CACHE_LOCAL', data: cache.data });

        // 2. Intentar SRI Real con Proxy
        const urlSRI = `https://srienlinea.sri.gob.ec/sri-en-linea/rest/Persona/obtenerPorRuc?numeroRuc=${ruc}`;
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(urlSRI)}`;
        
        try {
            const proxyResponse = await axios.get(proxyUrl, { timeout: 12000 });
            const contents = JSON.parse(proxyResponse.data.contents);

            if (contents && (contents.razonSocial || contents.nombreCompleto)) {
                const nuevaData = {
                    ruc: ruc,
                    razonSocial: contents.razonSocial || contents.nombreCompleto,
                    estado: contents.estadoPersona || "ACTIVO",
                    mensaje: "Datos reales del SRI"
                };
                await new Consulta({ ruc, data: nuevaData }).save();
                return res.json({ source: 'SRI_LIVE', data: nuevaData });
            }
        } catch (e) {
            console.log("SRI Bloqueado, buscando en Emergencia...");
        }

        // 3. Si el SRI falla, usar Base de Emergencia
        if (dbEmergencia[ruc]) {
            const dataEmergencia = { 
                ...dbEmergencia[ruc], 
                ruc, 
                mensaje: "Consulta exitosa (Datos de Respaldo BIG SOLUTIONS)" 
            };
            // Guardamos en Atlas para que ya quede registrado
            await new Consulta({ ruc, data: dataEmergencia }).save();
            return res.json({ source: 'EMERGENCIA', data: dataEmergencia });
        }

        res.status(404).json({ error: 'RUC no encontrado o SRI fuera de servicio. Pruebe en unos minutos.' });

    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para crear usuarios
app.post('/crear-usuario', async (req, res) => {
    try {
        const { nombre } = req.body;
        const apiKey = Math.random().toString(36).substring(2, 12);
        const nuevoUsuario = new User({ apiKey, nombre, consultasRestantes: 500 });
        await nuevoUsuario.save();
        res.json({ mensaje: 'Usuario creado', apiKey });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});
// 🔥 RUTA PARA LIMPIAR TODA LA CACHÉ (Memoria del buscador)
app.get('/admin/borrar-todo-big-solutions', async (req, res) => {
    try {
        await Consulta.deleteMany({}); // Esto vacía la colección en Atlas
        res.send("<h1>🔥 Memoria Limpiada</h1><p>Todas las consultas guardadas han sido eliminadas de Atlas.</p>");
    } catch (error) {
        res.status(500).send("Error al limpiar la base de datos");
    }
});
// 7. ENCENDER EL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sistema BIG SOLUTIONS PC activo en puerto ${PORT}`));