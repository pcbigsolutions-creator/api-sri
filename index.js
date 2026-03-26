require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors'); 

// 1. CONFIGURACIÓN DE LA APP (El orden aquí es sagrado)
const app = express(); 

// 2. PERMISOS Y MIDDLEWARES
app.use(express.json());
app.use(cors()); // Esto permite que tu buscador web se conecte

// 3. CONEXIÓN A MONGODB (Atlas en la nube)
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Servidor conectado a la Base de Datos en la Nube"))
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

// 5. MIDDLEWARE DE SEGURIDAD (Validar API KEY)
const validarApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API KEY requerida' });

    const user = await User.findOne({ apiKey });
    if (!user) return res.status(403).json({ error: 'API KEY inválida' });
    
    req.user = user;
    next();
};

// 6. RUTAS DE LA API
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => { // <--- FÍJATE EN ESTE 'async'
    const { ruc } = req.params;

    try {
        // 1. Revisar caché en Atlas
        const cache = await Consulta.findOne({ ruc });
        if (cache) return res.json({ source: 'CACHE_LOCAL', data: cache.data });

        // 2. Consultar al SRI Real (Endpoint público)
        const url = `https://srienlinea.sri.gob.ec/sri-en-linea/rest/ConsultasGenerales/obtenerPorRuc?numeroRuc=${ruc}`;
        const response = await axios.get(url);
        
        // Estructurar los datos reales que vienen del SRI
        const nuevaData = {
            ruc: ruc,
            razonSocial: response.data.razonSocial || "Nombre no encontrado",
            estado: response.data.estadoContribuyente || "ACTIVO",
            mensaje: "Datos reales del SRI obtenidos por BIG SOLUTIONS"
        };

        // 3. Guardar en BD para futuras consultas
        await new Consulta({ ruc, data: nuevaData }).save();

        res.json({ source: 'SRI_LIVE', data: nuevaData });

    } catch (error) {
        console.error("Error en consulta:", error.message);
        res.status(500).json({ error: 'RUC no encontrado o SRI fuera de servicio' });
    }
});

        // 3. Guardar en BD para la próxima vez
        await new Consulta({ ruc, data: nuevaData }).save();

        res.json({ source: 'SRI_LIVE', data: nuevaData });

    } catch (error) {
        res.status(500).json({ error: 'Error al consultar el SRI' });
    }
});

// Ruta para crear usuarios (y generar API Keys)
app.post('/crear-usuario', async (req, res) => {
    const { nombre, consultas } = req.body;
    const apiKey = Math.random().toString(36).substring(2, 12);
    
    const nuevoUsuario = new User({
        apiKey,
        nombre,
        consultasRestantes: consultas || 10
    });

    await nuevoUsuario.save();
    res.json({ mensaje: 'Usuario creado', apiKey });
});

// 7. ENCENDER EL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API de BIG SOLUTIONS corriendo en puerto ${PORT}`);
});