const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 }
});

// --- CONFIGURACIÓN DB (HOSTGATOR) ---
const dbConfig = {
    host: 'localhost',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- OBTENCIÓN DE TASA REAL (API BCV) ---
async function obtenerTasas() {
    let oficial = 1; let paralelo = 1;
    try {
        const resO = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        oficial = resO.data.promedio;
        const resP = await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo');
        paralelo = resP.data.promedio;
    } catch (e) { console.error("Error API Tasa:", e.message); }
    return { oficial, paralelo };
}

// --- ENTRENAMIENTO COMPLETO ONE4CARS ---
const promptEntrenamiento = `
Eres el asesor experto de ONE4CARS, importadora directa de China. 
UBICACIÓN: Almacén General y Almacén Intermedio en Caracas. Despachos nacionales.
PRODUCTOS ESTRELLA: Bombas de Gasolina, Bujías, Correas, Crucetas, Filtros Aceite/Gasolina, Lapiz Estabilizador, Muñones, Poleas, Puentes de Cardan, Puntas de Tripoide, Rodamientos, Tapas de Radiador, Terminales de Dirección.

REGLAS DE ORO:
1. HUMANIZACIÓN: Saluda con cordialidad venezolana. Antes de enviar el menú de opciones, pregunta si el cliente desea conocerlas o si tiene una duda específica.
2. MENÚ DE OPCIONES (Solo si el cliente acepta o está perdido):
   - 1. Consultar Stock (Requiere RIF y Modelo de Carro).
   - 2. Estado de Cuenta (Requiere RIF).
   - 3. Tasa del día BCV.
   - 4. Métodos de Pago (Zelle, Banesco Panamá, Bs).
   - 5. Catálogo de Productos (Link: https://one4cars.com/buscar/).
   - 6. Requisitos para Clientes Nuevos.
   - 7. Mercancía en Tránsito (China).
   - 8. Garantías y Fletes.
   - 9. Soporte para Vendedores (Requiere Cédula).
3. FILTRO MAYORISTA: Solo venta al mayor. Mínimo 100$.
4. PRECIOS: Moneda base USD. Si no sabes el precio exacto, indica que se le informará al procesar la factura.
5. DOCUMENTOS NUEVOS: Copia RIF, Cédula, Foto local, 2 Referencias comerciales, Nombre y Celular del representante.
6. LOGÍSTICA: Caracas flete gratis. Interior paga el cliente (Tealca, Zoom, etc).
7. GARANTÍA: Por defecto de fábrica. Tramitar con su vendedor.
8. SI EL CLIENTE ESTÁ SATISFECHO: (Ej. "Perfecto", "Gracias") NO envíes el menú. Despídete amablemente.

DATOS TÉCNICOS SQL:
- Descuento: Si tab_facturas.porcentaje es 0.6 = 40%, 0.7 = 30%.
- Facturas: pagada = 'NO' significa deuda pendiente.
- Vendedores: Verificar id_vendedor en tab_vendedores.
`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, auth: state, logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') qrCodeData = "ONLINE ✅";
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // --- LÓGICA DE DATOS REALES ---
        const tasas = await obtenerTasas();
        let sqlData = "";

        const rifMatch = text.match(/[JVE][-]?\d+/i);
        if (rifMatch) {
            const rif = rifMatch[0].replace(/-/g, '');
            try {
                const conn = await mysql.createConnection(dbConfig);
                const [cliente] = await conn.execute("SELECT id_cliente, nombres FROM tab_cliente WHERE REPLACE(cedula, '-', '') = ?", [rif]);
                if (cliente.length > 0) {
                    const [deuda] = await conn.execute("SELECT SUM(total - monto_pagado) as saldo FROM tab_facturas WHERE id_cliente = ? AND pagada = 'NO' AND anulado = 'no'", [cliente[0].id_cliente]);
                    sqlData = `SQL: Cliente ${cliente[0].nombres} encontrado. Saldo Pendiente: $${deuda[0].saldo || 0}.`;
                }
                await conn.end();
            } catch (err) { sqlData = "Error consultando Base de Datos."; }
        }

        try {
            const promptFinal = `${promptEntrenamiento}\n\nSITUACIÓN ACTUAL:\nTasas: BCV ${tasas.oficial}, Paralelo ${tasas.paralelo}.\n${sqlData}\n\nCliente: ${text}\nAsesor ONE4CARS:`;
            
            const result = await model.generateContent(promptFinal);
            const response = await result.response.text();

            await sock.sendPresenceUpdate('composing', from);
            setTimeout(async () => {
                await sock.sendMessage(from, { text: response });
            }, 1200);
        } catch (e) { console.error("Error Gemini:", e); }
    });
}

// --- PANEL WEB (RESTAURADO COMPLETO) ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none small">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm">COBRANZA</a>
                </nav>
            </div>
        </header>`;

    if (parsedUrl.pathname === '/cobranza') {
        const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
        <body class="bg-light">${header}<div class="container bg-white p-4 shadow">
        <h3>Reporte de Cuentas por Cobrar</h3><table class="table">
        <thead><tr><th>RIF</th><th>Cliente</th><th>Monto</th><th>Días</th></tr></thead>
        <tbody>${d.map(f => `<tr><td>${f.cedula}</td><td>${f.nombres}</td><td>$${f.saldo_pendiente}</td><td>${f.dias_vencidos}</td></tr>`).join('')}</tbody>
        </table></div></body></html>`);
        res.end();
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
        <body class="bg-light text-center">${header}<h1>Bot Status: ${qrCodeData}</h1></body></html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
