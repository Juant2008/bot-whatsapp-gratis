const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN ONE4CARS ---
// REEMPLAZA ESTO CON TU API KEY REAL DE GOOGLE AI STUDIO
const API_KEY_IA = "TU_API_KEY_AQUI"; 
const genAI = new GoogleGenerativeAI(API_KEY_IA);
const modelIA = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 10000 // 10 segundos de espera
};

let qrCodeData = "Iniciando sistema... por favor espere.";
let socketBot = null;

// --- LÓGICA DE BASE DE DATOS (CON FILTRO DE VENDEDOR) ---
async function obtenerContextoBD(texto, deDonde) {
    let info = "Datos del sistema ONE4CARS: ";
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const tlf = deDonde.replace(/\D/g, '').slice(-10);

        // 1. ¿Es Vendedor?
        const [vendedores] = await conn.execute("SELECT id_vendedor, nombre FROM tab_vendedores WHERE telefono LIKE ?", [`%${tlf}%`]);
        
        if (vendedores.length > 0) {
            const v = vendedores[0];
            info += `Usuario: VENDEDOR ${v.nombre}. `;
            if (texto.includes("saldo") || texto.includes("mis clientes")) {
                const [cli] = await conn.execute("SELECT c.nombres, SUM(f.monto - f.abono_factura) as deuda FROM tab_cliente c JOIN tab_facturas f ON c.id_cliente = f.id_cliente WHERE c.id_vendedor = ? AND f.pagada = 'NO' GROUP BY c.id_cliente LIMIT 5", [v.id_vendedor]);
                info += `Reporte de sus clientes: ${cli.map(c => c.nombres + " debe $" + c.deuda).join(", ")}. `;
            }
        } else {
            // 2. ¿Es Cliente?
            const [clientes] = await conn.execute("SELECT id_cliente, nombres FROM tab_cliente WHERE telefono LIKE ?", [`%${tlf}%`]);
            if (clientes.length > 0) {
                const c = clientes[0];
                info += `Usuario: CLIENTE ${c.nombres}. `;
                if (texto.includes("saldo") || texto.includes("debo")) {
                    const [fac] = await conn.execute("SELECT SUM(monto - f.abono_factura) as d FROM tab_facturas f WHERE id_cliente = ? AND pagada = 'NO'", [c.id_cliente]);
                    info += `Su saldo deudor es de $${fac[0].d || 0}. `;
                }
            }
        }
    } catch (e) { 
        console.error("Error de conexión SQL:", e.message);
        info += " (No se pudo conectar a la base de datos en este momento).";
    } finally { 
        if (conn) await conn.end(); 
    }
    return info;
}

// --- INICIO DEL BOT ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeData = url; 
                console.log("✅ QR Generado. Escanea en la web.");
            });
        }
        if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 Conexión establecida con éxito');
        }
        if (connection === 'close') {
            qrCodeData = "Reconectando...";
            const code = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // 1. MENÚ ORIGINAL (RESPUESTA INSTANTÁNEA)
        const menuOriginal = {
            'medios de pago': 'https://www.one4cars.com/medios_de_pago.php',
            'estado de cuenta': 'https://www.one4cars.com/estado_de_cuenta.php',
            'lista de precio': 'https://www.one4cars.com/lista_de_precios.php',
            'tomar pedido': 'https://www.one4cars.com/tomar_pedido.php',
            'mis cliente': 'https://www.one4cars.com/mis_clientes.php',
            'afiliar cliente': 'https://www.one4cars.com/afiliar_clientes.php',
            'ficha producto': 'https://www.one4cars.com/consulta_productos.php',
            'despacho': 'https://www.one4cars.com/despacho.php'
        };

        for (const [key, url] of Object.entries(menuOriginal)) {
            if (body.includes(key)) {
                await sock.sendMessage(from, { text: `🚗 *ONE4CARS*\n\nAcceda aquí:\n🔗 ${url}` });
                return;
            }
        }

        // 2. INTELIGENCIA ARTIFICIAL (LENGUAJE NATURAL)
        const contexto = await obtenerContextoBD(body, from.split('@')[0]);
        const prompt = `Eres el asistente de ONE4CARS. INFO: ${contexto}. 
        Responde amablemente. Si no sabes algo o la base de datos falló, invita a escribir 'Asesor'. 
        Si el cliente saluda, muestra las opciones disponibles: Medios de pago, Estado de cuenta, Pedidos.`;

        try {
            const result = await modelIA.generateContent(`${prompt}\nUsuario dice: ${body}`);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) {
            await sock.sendMessage(from, { text: "Hola! ¿En qué puedo ayudarte? Escribe 'Medios de pago' o 'Asesor'." });
        }
    });
}

// --- SERVIDOR WEB (HEADER PHP SIMULADO) ---
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    const header = `
        <div style="background:#000; color:#fff; padding:20px; text-align:center; font-family:Arial;">
            <img src="https://one4cars.com/logo.png" width="180">
            <h1>SISTEMA DE CONTROL ONE4CARS</h1>
        </div>`;

    if (qrCodeData.startsWith("data:image")) {
        res.end(`${header}<center><br><h2>Escanea para conectar el Bot</h2><img src="${qrCodeData}" style="border:10px solid #fff; box-shadow:0 0 10px rgba(0,0,0,0.2);"></center>`);
    } else {
        res.end(`${header}<center><br><h2 style="color:green;">${qrCodeData}</h2><br>
        <a href="/cobranza" style="padding:15px 30px; background:#28a745; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold;">ENTRAR AL PANEL DE COBRANZA</a></center>`);
    }
}).listen(process.env.PORT || 10000);

startBot();
