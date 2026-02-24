const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- MEMORIA PARA CONTROL DE FLUJO ---
const historialRespuestas = new Map();
const TIEMPO_MINIMO = 2 * 60 * 1000; // 2 minutos para repetir el saludo/menú

const apiKey = process.env.GEMINI_API_KEY;
let model = null;

if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
}

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

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
            console.log('🚀 ONE4CARS Conectado');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const bodyLower = body.toLowerCase();
        
        // --- 1. RESPUESTAS INSTANTÁNEAS (SIN IA PARA VELOCIDAD) ---
        const respuestasFijas = {
            'medios de pago': 'Estimado cliente, acceda al siguiente enlace:\n🔗 https://www.one4cars.com/medios_de_pago.php/',
            'estado de cuenta': 'Consulte su estado de cuenta aquí:\n🔗 https://www.one4cars.com/estado_de_cuenta.php/',
            'lista de precio': 'Descargue nuestra lista de precios aquí:\n🔗 https://www.one4cars.com/lista_de_precios.php/',
            'tomar pedido': 'Inicie la carga de su pedido aquí:\n🔗 https://www.one4cars.com/tomar_pedido.php/',
            'mis cliente': 'Gestione su cartera de clientes aquí:\n🔗 https://www.one4cars.com/mis_clientes.php/',
            'afiliar cliente': 'Para afiliar nuevos clientes ingrese aquí:\n🔗 https://www.one4cars.com/afiliar_clientes.php/',
            'ficha producto': 'Consulte las fichas técnicas aquí:\n🔗 https://www.one4cars.com/consulta_productos.php/',
            'despacho': 'Seguimiento de despacho en tiempo real:\n🔗 https://www.one4cars.com/despacho.php/',
            'asesor': 'Un asesor revisará su caso en breve. Gracias por su paciencia.'
        };

        // Verificamos si es una palabra clave
        for (const [key, val] of Object.entries(respuestasFijas)) {
            if (bodyLower.includes(key)) {
                await sock.sendMessage(from, { text: "🚗 *SOPORTE ONE4CARS*\n________________________\n\n" + val });
                return; // Cortamos ejecución para que no entre la IA
            }
        }

        // --- 2. GESTIÓN DE SALUDOS Y MENÚ (EVITA REPETICIÓN) ---
        const ahora = Date.now();
        const ultimaVez = historialRespuestas.get(from) || 0;
        const saludos = ['hola', 'buenos dias', 'buenas tardes', 'buenas noches', 'info', 'menu', 'que haces'];

        if (saludos.some(s => bodyLower.includes(s))) {
            if (ahora - ultimaVez < TIEMPO_MINIMO) return; // Si ya se saludó, no responde nada

            const menuTexto = `¡Hola! Bienvenido a *ONE4CARS* 🚗\n\nPor favor escribe una de estas opciones para ayudarte:\n\n1. *Medios de Pago*\n2. *Estado de Cuenta*\n3. *Lista de Precios*\n4. *Tomar Pedido*\n5. *Mis Clientes*\n6. *Afiliar Cliente*\n7. *Ficha Producto*\n8. *Despacho*\n9. *Asesor*`;
            
            await sock.sendMessage(from, { text: menuTexto });
            historialRespuestas.set(from, ahora);
            return;
        }

        // --- 3. IA (SOLO PARA PREGUNTAS FUERA DEL MENÚ) ---
        if (body.length > 3 && model) {
            if (ahora - ultimaVez < TIEMPO_MINIMO) return;

            try {
                await sock.sendPresenceUpdate('composing', from);
                const prompt = `Eres el asistente de ONE4CARS (repuestos). Responde brevemente a: "${body}". Si no sabes, pide que elija una opción del menú de repuestos.`;
                const result = await model.generateContent(prompt);
                await sock.sendMessage(from, { text: result.response.text() });
                historialRespuestas.set(from, ahora);
            } catch (e) { console.log("Error IA"); }
        }
    });
}

// --- SERVIDOR WEB ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<html><head><title>ONE4CARS - Cobranza</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
        <body class="bg-light"><div class="container mt-4 bg-white p-4 shadow-sm">
        <div class="d-flex justify-content-between"><h2>📊 Panel de Cobranza</h2><a href="/" class="btn btn-outline-secondary">Volver</a></div><hr>
        <form method="GET" class="row g-2 mb-4">
            <div class="col-md-3"><label>Vendedor</label><select name="vendedor" class="form-select">${vendedores.map(v => `<option value="${v.nombre}">${v.nombre}</option>`).join('')}</select></div>
            <div class="col-md-2 d-flex align-items-end"><button type="submit" class="btn btn-primary w-100">Filtrar</button></div>
        </form>
        <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Check</th><th>Cliente</th><th>Factura</th><th>Saldo</th></tr></thead>
        <tbody>${deudores.map(d => `<tr><td><input type="checkbox" class="rowCheck" value='${JSON.stringify(d)}'></td><td>${d.nombres}</td><td>${d.nro_factura}</td><td>$${d.saldo_pendiente}</td></tr>`).join('')}</tbody></table></div>
        <button onclick="enviar()" id="btnEnviar" class="btn btn-success w-100 mt-3">🚀 Enviar WhatsApp</button>
        </div><script>async function enviar(){ /* lógica de envío */ }</script></body></html>`);
        res.end();
    } else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) { cobranza.ejecutarEnvioMasivo(socketBot, data.facturas); res.end('OK'); }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(`<center><h1>ONE4CARS BOT</h1><img src="${qrCodeData}" width="300"><br><br><a href="/cobranza">COBRANZA</a></center>`);
        res.end();
    }
}).listen(port);

startBot();
