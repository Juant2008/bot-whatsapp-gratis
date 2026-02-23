const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN ONE4CARS ---
const genAI = new GoogleGenerativeAI("AIzaSyBKfvF9FOU84Bg_FDJeDZs5kSKu-lwnVwM"); // <--- DEBES PONER TU LLAVE AQUÍ
const modelIA = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const dbConfig = {
    host: 'localhost',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let qrCodeData = "";
let socketBot = null;

// --- LÓGICA DE CONSULTA SEGURA (CLIENTES Y VENDEDORES) ---
async function obtenerContextoInteligente(texto, numeroWhatsApp) {
    const conn = await mysql.createConnection(dbConfig);
    let contexto = "Información de ONE4CARS: ";
    const tlf = numeroWhatsApp.replace(/\D/g, '').slice(-10); // Toma los últimos 10 dígitos

    try {
        // 1. VERIFICAR SI ES VENDEDOR
        const [vendedor] = await conn.execute("SELECT id_vendedor, nombre FROM tab_vendedores WHERE telefono LIKE ?", [`%${tlf}%`]);
        
        if (vendedor.length > 0) {
            const v = vendedor[0];
            contexto += `El usuario es el VENDEDOR ${v.nombre}. Tiene permiso para ver sus clientes. `;
            
            if (texto.includes("saldo") || texto.includes("cobranza")) {
                const [deudas] = await conn.execute(
                    "SELECT c.nombres, SUM(f.monto - f.abono_factura) as total FROM tab_cliente c JOIN tab_facturas f ON c.id_cliente = f.id_cliente WHERE c.id_vendedor = ? AND f.pagada = 'NO' GROUP BY c.id_cliente LIMIT 5",
                    [v.id_vendedor]
                );
                contexto += `Sus clientes con más deuda son: ${deudas.map(d => `${d.nombres} ($${d.total})`).join(", ")}. `;
            }
        } else {
            // 2. VERIFICAR SI ES CLIENTE
            const [cliente] = await conn.execute("SELECT id_cliente, nombres FROM tab_cliente WHERE telefono LIKE ?", [`%${tlf}%`]);
            if (cliente.length > 0) {
                const c = cliente[0];
                contexto += `El usuario es el CLIENTE ${c.nombres}. `;
                if (texto.includes("saldo") || texto.includes("debo")) {
                    const [facturas] = await conn.execute(
                        "SELECT SUM(monto - abono_factura) as deuda FROM tab_facturas WHERE id_cliente = ? AND pagada = 'NO'",
                        [c.id_cliente]
                    );
                    contexto += `Su deuda actual es de $${facturas[0].deuda || 0}. `;
                }
            }
        }

        // 3. BUSQUEDA DE PRODUCTOS (SIEMPRE DISPONIBLE)
        if (texto.includes("precio") || texto.includes("tienes") || texto.includes("hay")) {
            const busqueda = texto.replace(/precio|tienes|hay|de|un|una/g, "").trim();
            const [prod] = await conn.execute(
                "SELECT descripcion, precio, cantidad_existencia FROM tab_productos WHERE descripcion LIKE ? LIMIT 3",
                [`%${busqueda}%`]
            );
            if (prod.length > 0) {
                contexto += `En inventario: ${prod.map(p => `${p.descripcion} ($${p.precio})`).join(", ")}. `;
            }
        }
    } catch (e) {
        console.error("Error BD:", e);
    } finally {
        await conn.end();
    }
    return contexto;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'open') qrCodeData = "BOT ONLINE ✅";
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
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        // Obtener contexto de SQL
        const contextoReal = await obtenerContextoInteligente(body, from.split('@')[0]);

        // Prompt para la IA
        const instruccion = `
            Eres el asistente inteligente de ONE4CARS.
            INFO REAL DEL SISTEMA: ${contextoReal}.
            
            REGLAS DE ORO:
            1. Saluda cordialmente.
            2. Si es VENDEDOR, dale detalles de sus clientes.
            3. Si es CLIENTE, dile su deuda personal.
            4. Si pregunta por productos, usa los precios de la INFO REAL.
            5. Si no hay info real para su duda, dile: "No tengo el dato exacto, pero puedes ver aquí: https://www.one4cars.com/estado_de_cuenta.php".
            6. Sé breve, humano y usa emojis de autos.
        `;

        try {
            const result = await modelIA.generateContent(`${instruccion}\nPregunta: ${body}`);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: "⚠️ Error de conexión con la IA. Por favor, escribe 'Asesor' para hablar con un humano." });
        }
    });
}

// SERVIDOR HTTP CON HEADER PHP SIMULADO
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const header = `<div style="background:#000;color:#fff;padding:20px;text-align:center;"><img src="https://one4cars.com/logo.png" width="150"><h1>ONE4CARS AI CONTROL</h1></div>`;
    
    if (qrCodeData.includes("data:image")) {
        res.end(`${header}<center><h2>Escanea el QR</h2><img src="${qrCodeData}"></center>`);
    } else {
        res.end(`${header}<center><h2>${qrCodeData || "Iniciando..."}</h2><br><a href="/cobranza" style="padding:15px;background:green;color:#fff;text-decoration:none;">PANEL COBRANZA</a></center>`);
    }
}).listen(process.env.PORT || 10000);

startBot();
