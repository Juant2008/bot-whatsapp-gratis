const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURACIÓN DE IA ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 }
});

// --- CONFIGURACIÓN DB (ONE4CARS REAL) ---
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- ENTRENAMIENTO COMPLETO Y REGLAS DE ORO ---
const promptEntrenamiento = `
Eres el asesor experto de ONE4CARS. Importadora de autopartes China-Venezuela.
Almacén General y Almacén Intermedio en Caracas.

REGLAS DE INTERACCIÓN:
1. SALUDO HUMANO: Saluda cordialmente. Antes de mostrar el menú, pregunta: "¿Desea conocer nuestras opciones de servicios o busca un producto específico?"
2. NO REPETICIÓN: Si el cliente dice "gracias", "perfecto" o "entendido", despídete amablemente sin enviar el menú.
3. MENÚ DE 9 OPCIONES (Enviar solo si el cliente acepta o necesita guía):
   - 1. Consultar Stock/Precios (Pedir RIF y Modelo de Carro).
   - 2. Estado de Cuenta (Saldo de facturas no pagadas).
   - 3. Tasa BCV y Paralelo del día.
   - 4. Métodos de Pago (Zelle, Banesco Panamá, Transferencias Bs).
   - 5. Catálogo Digital: https://one4cars.com/buscar/
   - 6. Registro de Clientes Nuevos (Requisitos: RIF, Cédula, Foto local, 2 Referencias).
   - 7. Mercancía en Tránsito: https://one4cars.com/sevencorpweb/productos_transito_web.php
   - 8. Garantías y Fletes (Garantía de fábrica. Caracas flete gratis, interior cobro destino).
   - 9. Soporte para Vendedores (Acceso con Cédula).

DATOS DE NEGOCIO:
- Venta solo al Mayor (Mínimo 100$).
- Descuento Divisas: Se calcula según el campo "porcentaje" en tab_facturas (ej: 0.7 es 30% descuento).
- Productos: Bombas de gasolina, Bujías, Correas, Crucetas, Filtros, Muñones, Rodamientos, etc.
`;

// --- OBTENCIÓN DE TASA BCV Y PARALELO REAL ---
async function obtenerTasas() {
    let oficial = 1; let paralelo = 1;
    try {
        const resO = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        oficial = resO.data.promedio;
        const resP = await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo');
        paralelo = resP.data.promedio;
    } catch (e) { console.error("Error Tasas:", e.message); }
    return { oficial, paralelo };
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, auth: state, logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'open') qrCodeData = "CONECTADO";
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        const tasas = await obtenerTasas();
        let contextSQL = "";

        // Búsqueda de RIF en el mensaje para consulta SQL real
        const rifMatch = text.match(/[JVE][-]?\d+/i);
        if (rifMatch) {
            try {
                const conn = await mysql.createConnection(dbConfig);
                const rif = rifMatch[0].replace(/-/g, '');
                const [cliente] = await conn.execute("SELECT id_cliente, nombres FROM tab_cliente WHERE REPLACE(cedula, '-', '') = ?", [rif]);
                
                if (cliente.length > 0) {
                    const [deuda] = await conn.execute("SELECT SUM(total - monto_pagado) as saldo FROM tab_facturas WHERE id_cliente = ? AND pagada = 'NO'", [cliente[0].id_cliente]);
                    contextSQL = `SISTEMA: Cliente ${cliente[0].nombres}. Saldo Pendiente: $${deuda[0].saldo || 0}.`;
                }
                await conn.end();
            } catch (e) { contextSQL = "SISTEMA: Error de conexión a Base de Datos."; }
        }

        try {
            const promptFinal = `${promptEntrenamiento}\n\nCONTEXTO REAL:\nTasas: BCV ${tasas.oficial}, Paralelo ${tasas.paralelo}.\n${contextSQL}\n\nCliente: ${text}\nAsesor ONE4CARS:`;
            
            const result = await model.generateContent(promptFinal);
            const responseText = result.response.text();

            await sock.sendPresenceUpdate('composing', from);
            setTimeout(async () => {
                await sock.sendMessage(from, { text: responseText });
            }, 1000);
        } catch (e) { console.error("Error Gemini:", e); }
    });
}

// --- SERVIDOR WEB PARA QR (CON HEADER OBLIGATORIO) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    let display = "";
    if (qrCodeData === "CONECTADO") {
        display = `<h2 class="text-success">✅ SISTEMA ONLINE</h2><p>El bot de ONE4CARS está activo.</p>`;
    } else if (qrCodeData) {
        display = `<h2>Vincular WhatsApp</h2><img src="${qrCodeData}" width="300" style="border:5px solid #333; border-radius:10px;"><p>Escanee para iniciar sesión.</p><script>setTimeout(()=>location.reload(), 20000)</script>`;
    } else {
        display = `<h2>Iniciando...</h2><p>Generando código QR, por favor espere.</p><script>setTimeout(()=>location.reload(), 5000)</script>`;
    }

    res.end(`
        <html>
            <head>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <title>ONE4CARS Panel</title>
            </head>
            <body class="bg-light text-center">
                <header class="p-3 bg-dark text-white shadow mb-5">
                    <div class="container d-flex justify-content-between align-items-center">
                        <h4 class="m-0 text-primary">🚗 ONE4CARS</h4>
                        <span class="badge bg-primary">v1.5 Premium</span>
                    </div>
                </header>
                <div class="container">
                    <div class="card shadow-sm p-4 d-inline-block">
                        ${display}
                    </div>
                </div>
            </body>
        </html>`);
});

server.listen(port, '0.0.0.0', () => { startBot(); });
