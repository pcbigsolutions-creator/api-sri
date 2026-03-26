require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());

// 1. CONEXIÓN A MONGODB LOCAL
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Servidor conectado a MongoDB Local"))
  .catch(err => console.log("❌ Error de conexión a Mongo:", err));

// 2. MODELOS DE DATOS
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

// 3. MIDDLEWARE DE SEGURIDAD
const validarApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API KEY requerida' });

  const user = await User.findOne({ apiKey });
  if (!user) return res.status(403).json({ error: 'API KEY inválida' });

  if (user.consultasRestantes <= 0) {
    return res.status(403).json({ error: 'Sin consultas disponibles' });
  }

  req.user = user;
  next();
};

// 4. ENDPOINT DE CONSULTA
app.get('/api/ruc/:ruc', validarApiKey, async (req, res) => {
  const { ruc } = req.params;

  try {
    const existente = await Consulta.findOne({ ruc });
    if (existente) {
      req.user.consultasRestantes--;
      await req.user.save();
      return res.json({ source: 'CACHE_LOCAL', data: existente.data });
    }

    const url = `https://srienlinea.sri.gob.ec/facturacion-internet/consultas/publico/ruc-datos2.jspa?ruc=${ruc}`;
    
    const response = await axios.get(url, { 
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-EC,es;q=0.9',
        'Connection': 'keep-alive'
      }
    });

    const $ = cheerio.load(response.data);
    const razonSocial = $('td:contains("Raz")').next().text().trim() || $('th:contains("Raz")').next().text().trim();
    const estado = $('td:contains("Estado")').next().text().trim() || $('th:contains("Estado")').next().text().trim();

    if (!razonSocial) {
      return res.status(404).json({ error: 'RUC no encontrado' });
    }

    const dataReal = { ruc, razonSocial, estado, motor: "BIG_SOLUTIONS_V2" };
    await Consulta.create({ ruc, data: dataReal });
    req.user.consultasRestantes--;
    await req.user.save();

    res.json({ source: 'SRI_LIVE', data: dataReal });

  } catch (error) {
    res.status(500).json({ error: 'Error al conectar con el SRI' });
  }
});

// 5. RUTA PARA CREAR USUARIOS
app.post('/crear-usuario', async (req, res) => {
  const { nombre, consultas } = req.body;
  const apiKey = Math.random().toString(36).substring(2, 15);
  const user = await User.create({ nombre, apiKey, consultasRestantes: consultas || 10 });
  res.json({ mensaje: "Usuario creado", apiKey: user.apiKey });
});
// RUTA PARA VER TODO LO QUE HAS GUARDADO
app.get('/admin/historial', async (req, res) => {
  try {
    const historial = await Consulta.find().sort({ fecha: -1 });
    res.json({
      total_guardados: historial.length,
      registros: historial
    });
  } catch (error) {
    res.status(500).json({ error: "No se pudo leer el historial" });
  }
});
// 6. LANZAR SERVIDOR
app.listen(3000, () => {
  console.log('🚀 API SRI corriendo en puerto 3000');
});