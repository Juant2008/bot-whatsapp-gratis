const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Importamos la IA

// --- CONFIGURACIÓN ---
// Asegúrate de poner la variable GEMINI_API_KEY en Render
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Intentamos cargar cobranza si existe, si no, no rompemos el bot
let cobranza;
try {
    cobranza = require('./cobranza');
} catch (e) {
    console.log("Módulo cobranza no encontrado o con error, continuando sin él.");
}

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- CEREBRO DE LA IA (Tus respuestas y links) ---
const knowledgeBase = `
Eres el asistente virtual de ONE4CARS. Tu objetivo es atender al cliente de forma amable, corta y precisa.
IMPORTANTE: Si el cliente pregunta por uno de los siguientes temas, DEBES responder con el texto y el enlace exacto que se indica a continuación:

1. 'medios de pago' o 'como pagar':
   "Estimado cliente, acceda al siguiente enlace para ver nuestras formas de pago actualizadas:\n\n🔗 https://www.one4cars.com/medios_de_pago.php/"

2. 'estado de cuenta' o 'cuanto debo':
   "Estimado cliente, puede consultar su estado de cuenta detallado en el siguiente link:\n\n🔗 https://www.one4cars.com/estado_de_cuenta.php/"

3. 'lista de precios' o 'precios':
   "Estimado cliente, descargue nuestra lista de precios más reciente aquí:\n\n🔗 https://www.one4cars.com/lista_de_precios.php/"

4. 'tomar pedido' o 'hacer pedido':
   "Estimado cliente, inicie la carga de su pedido de forma rápida aquí:\n\n🔗 https://www.one4cars.com/tomar_pedido.php/"

5. 'mis clientes' o 'cartera':
   "Estimado, gestione su cartera de clientes en el siguiente apartado:\n\n🔗 https://www.one4cars.com/mis_clientes.php/"

6. 'afiliar cliente':
   "Estimado, para afiliar nuevos clientes por favor ingrese al siguiente link:\n\n🔗 https://www.one4cars.com/afiliar_clientes.php/"

7. 'ficha producto' o 'tecnica':
   "Estimado cliente, consulte las especificaciones y fichas técnicas aquí:\n\n🔗 https://www.one4cars.com/consulta_productos.php/"

8. 'despacho', 'envio' o 'seguimiento':
   "Estimado cliente, realice el seguimiento en tiempo real de su despacho aquí:\n\n🔗 https://www.one4cars.com/despacho.php/"

9. 'asesor' o 'humano':
   "Entendido. En un momento uno de nuestros asesores humanos revisará su caso y le contactará de forma manual. Gracias por su paciencia."

REGLAS DE COMPORTAMIENTO:
- Si el usuario saluda (hola, buenos días), responde el saludo cortésmente y pregunta en qué puedes ayudar.
- Si el usuario pregunta algo fuera de estos temas, responde amablemente que un asesor humano lo contactará pronto.
- No inventes enlaces. Usa solo los provistos.
`;

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
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        if (!body) return;

        try {
            // Enviamos el contexto y el mensaje a Gemini
            const prompt = `${knowledgeBase}\n\nCliente dice: "${body}"\n\nRespuesta del Asistente:`;
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const textResponse = response.text();

            await sock.sendMessage(from, { text: textResponse });
        } catch (error) {
            console.error("Error IA:", error);
            // Si falla la IA, no enviamos nada o un mensaje genérico
        }
    });
}

// --- SERVIDOR HTTP (Mantiene el bot vivo en Render y muestra QR) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    // Ruta webhook (compatible con tu código anterior)
    if (path === '/enviar-pago' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            console.log("Pago recibido webhook:", body);
            res.writeHead(200); res.end('Recibido');
        });
    } else if (path === '/cobranza' && cobranza) {
         // Si tienes lógica en cobranza.js, aquí se conectaría
         res.writeHead(200); res.end('Modulo Cobranza Activo');
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:50px;"><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"><br><p>Recarga la página si expira</p></center>`);
        } else {
            res.write(`<center style="margin-top:100px;"><h1>${qrCodeData || "Iniciando..."}</h1></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
